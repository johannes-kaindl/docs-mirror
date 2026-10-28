import { createBusyGuard } from "../vendor/kit/busy-guard";
import { createCooperativeYield } from "../vendor/kit/cooperative-yield";
import { applyPlan } from "./apply";
import { settingsFingerprint } from "./fingerprint";
import { checkGuards, type ConfirmReason } from "./guards";
import type { Manifest } from "./manifest";
import { buildPlan, type Plan, type PlanClass, type VaultPort } from "./plan";
import type { RunCounts, RunInfo } from "./run-info";
import { scanSource, type SourcePort } from "./scan";
import { validateRoot, type DocsMirrorSettings } from "./settings";

/** Gerätelokaler Zustand (Wurzelpfad, Manifest, Fingerabdruck, letzter Lauf). */
export interface DeviceState {
  load: () => Promise<{ root: string; manifest: Manifest | null; fingerprint: string | null; last: RunInfo | null }>;
  save: (p: Partial<{ manifest: Manifest; fingerprint: string; last: RunInfo }>) => Promise<void>;
}

export interface RunnerDeps {
  source: SourcePort;
  readSource: (path: string) => Promise<Uint8Array>;
  vault: VaultPort;
  state: DeviceState;
  settings: () => DocsMirrorSettings;
  yieldToUi: () => Promise<void>;
  now: () => number;
}

export type RunOutcome =
  | { kind: "busy" }
  | { kind: "blocked"; reason: "not-configured" | "source-unreachable" | "source-empty" }
  | { kind: "waiting"; plan: Plan; reasons: ConfirmReason[] }
  | { kind: "done"; info: RunInfo; aborted: boolean };

export interface Runner {
  run(mode: "manual" | "startup", signal: AbortSignal, onProgress?: (done: number, total: number) => void): Promise<RunOutcome>;
  execute(overwrite: ReadonlySet<string> | "all", signal: AbortSignal, onProgress?: (done: number, total: number) => void): Promise<RunOutcome>;
  pending(): Plan | null;
  isBusy(): boolean;
}

type Progress = (done: number, total: number) => void;
type Loaded = Awaited<ReturnType<DeviceState["load"]>>;

const SAVE_EVERY = 50;
const ZERO: RunCounts = { created: 0, updated: 0, unchanged: 0, deleted: 0, overwritten: 0, skipped: 0, errors: 0 };
const ABORTED = new Error("aborted");
const GUARDED: PlanClass[] = ["delete", "conflict", "vault-modified"];

/** Gleicher Plan im Sinn der Bestätigung: gleiche Zähler UND gleiche Pfade in den Klassen, die der Mensch gesehen hat. */
function samePlan(a: Plan, b: Plan): boolean {
  for (const k of Object.keys(a.counts) as PlanClass[]) if (a.counts[k] !== b.counts[k]) return false;
  for (const cls of GUARDED) {
    const pa = a.items.filter((i) => i.cls === cls).map((i) => i.path).sort();
    const pb = b.items.filter((i) => i.cls === cls).map((i) => i.path).sort();
    if (pa.length !== pb.length || pa.some((p, i) => p !== pb[i])) return false;
  }
  return true;
}

export function createRunner(deps: RunnerDeps): Runner {
  const guard = createBusyGuard();
  let pendingPlan: Plan | null = null;

  const failed = (fingerprint: string, error: string): RunInfo => ({
    at: deps.now(), ok: false, error, counts: { ...ZERO }, fingerprint,
  });

  type Prepared =
    | { kind: "aborted" }
    | { kind: "blocked"; reason: "source-unreachable" | "source-empty" }
    | { kind: "failed"; info: RunInfo }
    | { kind: "ready"; plan: Plan; confirm: ConfirmReason[]; fingerprint: string; manifest: Manifest };

  /** Speichert best effort; false, wenn der Speicher wirft (der Aufrufer meldet dann einen Fehler statt zu werfen). */
  const trySave = async (p: Parameters<DeviceState["save"]>[0]): Promise<boolean> => {
    try { await deps.state.save(p); return true; } catch { return false; }
  };

  /** Scan, Plan, Sicherungen. Wirft nie (auch nicht, wenn das Speichern wirft); Fehler und Sperren werden gespeichert (`last`), das Manifest bleibt unberührt. */
  async function prepare(load: Loaded, root: string, signal: AbortSignal): Promise<Prepared> {
    const settings = deps.settings();
    const fingerprint = settingsFingerprint(settings, root);
    if (signal.aborted) return { kind: "aborted" };
    try {
      const pacer = createCooperativeYield({ yieldToUi: deps.yieldToUi });
      const scan = await scanSource(deps.source, settings, async () => {
        await pacer.tick();
        if (signal.aborted) throw ABORTED;
      });
      const manifest = load.manifest ?? {};
      const plan = await buildPlan({ scan, manifest, vault: deps.vault, readSource: deps.readSource });
      const g = checkGuards(plan, {
        hadManifest: load.manifest !== null,
        manifestSize: Object.keys(manifest).length,
        // Ohne gespeicherten Fingerabdruck bei vorhandenem Manifest (abgebrochener erster Lauf) gilt: geändert.
        fingerprintChanged: load.manifest !== null && load.fingerprint !== fingerprint,
      }, settings);
      if (g.blocked !== null) {
        const key = g.blocked === "source-unreachable" ? "status.unreachable" : "notice.blocked.empty";
        pendingPlan = null;
        await trySave({ last: failed(fingerprint, key) });
        return { kind: "blocked", reason: g.blocked };
      }
      return { kind: "ready", plan, confirm: g.confirm, fingerprint, manifest };
    } catch (e) {
      if (e === ABORTED) return { kind: "aborted" };
      pendingPlan = null;
      const info = failed(fingerprint, "notice.failed");
      await trySave({ last: info });
      return { kind: "failed", info };
    }
  }

  async function perform(
    plan: Plan, manifest: Manifest, fingerprint: string,
    overwrite: ReadonlySet<string> | "all", signal: AbortSignal, onProgress: Progress | undefined,
  ): Promise<RunOutcome> {
    pendingPlan = null;
    let info: RunInfo;
    let aborted = false;
    try {
      const r = await applyPlan(plan, manifest, {
        vault: deps.vault,
        readSource: deps.readSource,
        yieldToUi: deps.yieldToUi,
        signal,
        onProgress: onProgress ?? (() => {}),
        saveManifest: (m) => deps.state.save({ manifest: m }),
      }, { overwrite, saveEvery: SAVE_EVERY });
      aborted = r.aborted;
      info = { at: deps.now(), ok: r.counts.errors === 0, counts: r.counts, fingerprint };
      if (r.counts.errors > 0) info.error = "notice.partial";
    } catch {
      info = failed(fingerprint, "notice.failed");
    }
    // Der Fingerabdruck gilt erst für einen vollständig ausgeführten Plan: ein Abbruch lässt den alten stehen.
    const saved = !aborted && info.error !== "notice.failed"
      ? await trySave({ fingerprint, last: info })
      : await trySave({ last: info });
    if (!saved) info = failed(fingerprint, "notice.failed");
    return { kind: "done", info, aborted };
  }

  async function start(
    mode: "run" | "execute", overwrite: ReadonlySet<string> | "all", signal: AbortSignal, onProgress?: Progress,
  ): Promise<RunOutcome> {
    const load = await deps.state.load();
    const rootCheck = validateRoot(load.root);
    if (!rootCheck.ok) return { kind: "blocked", reason: "not-configured" };
    const prep = await prepare(load, rootCheck.root, signal);
    if (prep.kind === "blocked") return { kind: "blocked", reason: prep.reason };
    if (prep.kind === "aborted") {
      // Vor dem Scan abgebrochen: nichts gelesen, nichts gespeichert.
      return { kind: "done", info: { at: deps.now(), ok: true, counts: { ...ZERO }, fingerprint: settingsFingerprint(deps.settings(), rootCheck.root) }, aborted: true };
    }
    if (prep.kind === "failed") return { kind: "done", info: prep.info, aborted: false };
    const { plan, confirm, fingerprint, manifest } = prep;
    if (mode === "run") {
      if (confirm.length > 0) {
        pendingPlan = plan;
        return { kind: "waiting", plan, reasons: confirm };
      }
    } else if (pendingPlan === null ? confirm.length > 0 : !samePlan(pendingPlan, plan)) {
      pendingPlan = plan;
      return { kind: "waiting", plan, reasons: confirm };
    }
    return perform(plan, manifest, fingerprint, mode === "run" ? new Set() : overwrite, signal, onProgress);
  }

  async function guarded(fn: () => Promise<RunOutcome>): Promise<RunOutcome> {
    if (!guard.tryAcquire()) return { kind: "busy" };
    try {
      return await fn();
    } finally {
      guard.release();
    }
  }

  return {
    run: (_mode, signal, onProgress) => guarded(() => start("run", new Set(), signal, onProgress)),
    execute: (overwrite, signal, onProgress) => guarded(() => start("execute", overwrite, signal, onProgress)),
    pending: () => pendingPlan,
    isBusy: () => guard.isBusy(),
  };
}
