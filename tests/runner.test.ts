import { describe, expect, it } from "vitest";
import type { Manifest } from "../src/core/manifest";
import { createRunner, type DeviceState, type RunnerDeps, type RunOutcome } from "../src/core/runner";
import type { RunInfo } from "../src/core/run-info";
import { settingsFingerprint } from "../src/core/fingerprint";
import { DEFAULT_SETTINGS, type DocsMirrorSettings } from "../src/core/settings";
import type { SourcePort } from "../src/core/scan";
import { fakeSource } from "./helpers/fake-source";
import { fakeVault, type FakeVault } from "./helpers/fake-vault";

const enc = new TextEncoder();
const ROOT = "/data/repos";
const TREE = { "repoA/docs/a.md": "alpha", "repoA/docs/b.md": "beta", "repoB/docs/c.md": "gamma" };

interface MemState extends DeviceState {
  data: { root: string; manifest: Manifest | null; fingerprint: string | null; last: RunInfo | null };
  saves: string[];
  gate?: Promise<void>;
}
function memState(root = ROOT): MemState {
  const st: MemState = {
    data: { root, manifest: null, fingerprint: null, last: null },
    saves: [],
    async load() {
      if (st.gate) await st.gate;
      return { ...st.data };
    },
    save(p) {
      st.saves.push(Object.keys(p).sort().join("+"));
      Object.assign(st.data, p);
      return Promise.resolve();
    },
  };
  return st;
}

interface Ctx {
  runner: ReturnType<typeof createRunner>;
  state: MemState;
  vault: FakeVault;
  tree: Record<string, string | number | null>;
  settings: DocsMirrorSettings;
  setSource(t: Record<string, string | number | null>, opts?: { missingRoot?: boolean }): void;
  reads: string[];
  scans: { n: number; onScan?: () => void };
  onRead?: (path: string) => void;
}
function ctx(over: { settings?: Partial<DocsMirrorSettings>; root?: string } = {}): Ctx {
  const c = {} as Ctx;
  c.state = memState(over.root);
  c.vault = fakeVault();
  c.tree = { ...TREE };
  c.settings = { ...DEFAULT_SETTINGS, ...over.settings };
  c.reads = [];
  c.scans = { n: 0 };
  let current: SourcePort = fakeSource(c.tree);
  c.setSource = (t, opts) => { c.tree = t; current = fakeSource(t, opts); };
  const deps: RunnerDeps = {
    source: { readdir: (rel) => { c.scans.n++; c.scans.onScan?.(); return current.readdir(rel); } },
    readSource: (p) => {
      c.reads.push(p);
      c.onRead?.(p);
      const v = c.tree[p];
      return typeof v === "string" ? Promise.resolve(enc.encode(v)) : Promise.reject(new Error(`ENOENT: ${p}`));
    },
    vault: c.vault,
    state: c.state,
    settings: () => c.settings,
    yieldToUi: () => Promise.resolve(),
    now: () => 5000,
  };
  c.runner = createRunner(deps);
  return c;
}
const fp = (c: Ctx): string => settingsFingerprint(c.settings, ROOT);
const sig = (): AbortSignal => new AbortController().signal;
/** Erster Lauf samt Bestätigung: danach ist der Vault gespiegelt und das Manifest gespeichert. */
async function mirrored(c: Ctx): Promise<void> {
  const w = await c.runner.run("manual", sig());
  expect(w.kind).toBe("waiting");
  const d = await c.runner.execute(new Set(), sig());
  expect(d.kind).toBe("done");
}
const ops = (c: Ctx): string[] => c.vault.calls.ops.filter((o) => o !== "clearTemp");

describe("createRunner", () => {
  it("zweiter run während des ersten → busy, schreibt nicht, und die Sperre wird danach frei", async () => {
    const c = ctx();
    let release!: () => void;
    c.state.gate = new Promise<void>((r) => { release = r; });
    const first = c.runner.run("manual", sig());
    expect(c.runner.isBusy()).toBe(true);
    const second = await c.runner.run("manual", sig());
    expect(second).toEqual({ kind: "busy" });
    expect(c.state.saves).toEqual([]);
    expect(ops(c)).toEqual([]);
    // auch execute sieht die Sperre
    expect(await c.runner.execute("all", sig())).toEqual({ kind: "busy" });
    c.state.gate = undefined;
    release();
    expect((await first).kind).toBe("waiting");
    expect(c.runner.isBusy()).toBe(false);
  });

  it("ein Fehler im Lauf gibt die Sperre frei (try/finally)", async () => {
    const c = ctx();
    c.state.load = () => Promise.reject(new Error("disk"));
    await expect(c.runner.run("manual", sig())).rejects.toThrow("disk");
    expect(c.runner.isBusy()).toBe(false);
  });

  it("Wurzel leer → blocked/not-configured, nichts gespeichert", async () => {
    const c = ctx({ root: "" });
    const r = await c.runner.run("manual", sig());
    expect(r).toEqual({ kind: "blocked", reason: "not-configured" });
    expect(c.state.saves).toEqual([]);
    expect(ops(c)).toEqual([]);
  });

  it("Quelle unerreichbar → blocked, Manifest und Fingerabdruck unverändert, nichts gelöscht (voller Vault)", async () => {
    const c = ctx();
    await mirrored(c);
    const manifestBefore = JSON.stringify(c.state.data.manifest);
    const fpBefore = c.state.data.fingerprint;
    expect(Object.keys(c.state.data.manifest ?? {})).toHaveLength(3);
    c.vault.resetCalls();
    c.setSource({}, { missingRoot: true });
    const r = await c.runner.run("manual", sig());
    expect(r).toEqual({ kind: "blocked", reason: "source-unreachable" });
    expect(JSON.stringify(c.state.data.manifest)).toBe(manifestBefore);
    expect(c.state.data.fingerprint).toBe(fpBefore);
    expect(ops(c)).toEqual([]);
    for (const p of Object.keys(TREE)) expect(c.vault.has(p)).toBe(true);
    expect(c.state.data.last).toMatchObject({ ok: false, error: "status.unreachable" });
  });

  it("Quelle leer → blocked/source-empty, nichts gelöscht (voller Vault)", async () => {
    const c = ctx();
    await mirrored(c);
    c.vault.resetCalls();
    c.setSource({ "repoA/readme.md": "x" });
    const r = await c.runner.run("manual", sig());
    expect(r).toEqual({ kind: "blocked", reason: "source-empty" });
    expect(ops(c)).toEqual([]);
    expect(Object.keys(c.state.data.manifest ?? {})).toHaveLength(3);
    expect(c.state.data.last).toMatchObject({ ok: false, error: "notice.blocked.empty" });
  });

  it("erster Lauf → waiting (Vault unberührt), dann execute → done mit Manifest, Fingerabdruck und last", async () => {
    const c = ctx();
    const w = await c.runner.run("manual", sig());
    expect(w).toMatchObject({ kind: "waiting", reasons: ["first-run"] });
    expect(c.runner.pending()?.counts.new).toBe(3);
    expect(ops(c)).toEqual([]);
    expect(c.state.data.manifest).toBeNull();
    const d = await c.runner.execute(new Set(), sig());
    expect(d).toMatchObject({ kind: "done", aborted: false });
    expect((d as Extract<RunOutcome, { kind: "done" }>).info.counts.created).toBe(3);
    expect(c.vault.text("repoA/docs/a.md")).toBe("alpha");
    expect(Object.keys(c.state.data.manifest ?? {})).toHaveLength(3);
    expect(c.state.data.fingerprint).toBe(fp(c));
    expect(c.state.data.last).toMatchObject({ at: 5000, ok: true, fingerprint: fp(c) });
    expect(c.runner.pending()).toBeNull();
  });

  it("ohne Bestätigungsgrund läuft run sofort durch (auch beim Start)", async () => {
    const c = ctx();
    await mirrored(c);
    c.setSource({ ...TREE, "repoB/docs/d.md": "delta" });
    const r = await c.runner.run("startup", sig());
    expect(r).toMatchObject({ kind: "done", aborted: false });
    expect(c.vault.text("repoB/docs/d.md")).toBe("delta");
    expect(c.runner.pending()).toBeNull();
  });

  it("Fingerabdruck geändert → waiting trotz null Löschungen; nach done ist der neue gespeichert", async () => {
    const c = ctx();
    await mirrored(c);
    c.state.data.fingerprint = "old-fingerprint";
    const w = await c.runner.run("manual", sig());
    expect(w).toMatchObject({ kind: "waiting", reasons: ["settings-changed"] });
    expect((w as Extract<RunOutcome, { kind: "waiting" }>).plan.counts.delete).toBe(0);
    expect(c.state.data.fingerprint).toBe("old-fingerprint");
    await c.runner.execute(new Set(), sig());
    expect(c.state.data.fingerprint).toBe(fp(c));
  });

  it("execute mit veraltetem Plan (Quelle zwischenzeitlich geändert) → waiting mit neuem Plan, nichts geschrieben", async () => {
    const c = ctx();
    const w = await c.runner.run("manual", sig());
    expect(w.kind).toBe("waiting");
    c.setSource({ ...TREE, "repoB/docs/d.md": "delta" });
    const r = await c.runner.execute(new Set(), sig());
    expect(r.kind).toBe("waiting");
    expect((r as Extract<RunOutcome, { kind: "waiting" }>).plan.counts.new).toBe(4);
    expect(c.runner.pending()?.counts.new).toBe(4);
    expect(ops(c)).toEqual([]);
    // ein zweiter execute mit nun passendem Plan läuft
    const d = await c.runner.execute(new Set(), sig());
    expect(d.kind).toBe("done");
    expect(c.vault.has("repoB/docs/d.md")).toBe(true);
  });

  it("execute mit gleichen Zählern, aber anderen Löschpfaden → waiting", async () => {
    const c = ctx();
    await mirrored(c);
    c.setSource({ "repoA/docs/b.md": "beta", "repoB/docs/c.md": "gamma" }); // a.md entfällt
    c.state.data.fingerprint = "old-fingerprint"; // erzwingt waiting
    const w = await c.runner.run("manual", sig());
    expect(w.kind).toBe("waiting");
    expect(c.runner.pending()?.counts.delete).toBe(1);
    c.setSource({ "repoA/docs/a.md": "alpha", "repoB/docs/c.md": "gamma" }); // jetzt entfällt b.md, Zähler gleich
    const r = await c.runner.execute(new Set(), sig());
    expect(r.kind).toBe("waiting");
    expect(c.vault.has("repoA/docs/a.md")).toBe(true);
    expect(c.vault.has("repoA/docs/b.md")).toBe(true);
    expect((r as Extract<RunOutcome, { kind: "waiting" }>).plan.items.find((i) => i.cls === "delete")?.path).toBe("repoA/docs/b.md");
  });

  it("execute mit gleichen Zählern, aber anderen Konfliktpfaden → waiting", async () => {
    const c = ctx();
    c.setSource({ "repoA/docs/x.md": "ex", "repoA/docs/y.md": "why" });
    c.vault.put("repoA/docs/x.md", "foreign");
    const w = await c.runner.run("manual", sig());
    expect(w).toMatchObject({ kind: "waiting" });
    expect(c.runner.pending()?.counts).toMatchObject({ conflict: 1, new: 1 });
    c.vault.resetCalls();
    await c.vault.remove("repoA/docs/x.md");
    c.vault.put("repoA/docs/y.md", "foreign");
    c.vault.resetCalls();
    const r = await c.runner.execute("all", sig());
    expect(r.kind).toBe("waiting");
    expect(ops(c)).toEqual([]);
    expect((r as Extract<RunOutcome, { kind: "waiting" }>).plan.items.find((i) => i.cls === "conflict")?.path).toBe("repoA/docs/y.md");
  });

  it("execute mit gleichen Zählern, aber anderen Pfaden im Vault verändert → waiting", async () => {
    const c = ctx();
    await mirrored(c);
    c.state.data.fingerprint = "old-fingerprint"; // erzwingt waiting
    c.vault.put("repoA/docs/a.md", "edited-a!", 9999);
    const w = await c.runner.run("manual", sig());
    expect(w.kind).toBe("waiting");
    expect(c.runner.pending()?.counts["vault-modified"]).toBe(1);
    c.vault.put("repoA/docs/a.md", "alpha", 2000);
    c.vault.put("repoA/docs/b.md", "edited-b!", 9999);
    c.vault.resetCalls();
    const r = await c.runner.execute(new Set(), sig());
    expect(r.kind).toBe("waiting");
    expect(ops(c)).toEqual([]);
    expect((r as Extract<RunOutcome, { kind: "waiting" }>).plan.items.find((i) => i.cls === "vault-modified")?.path).toBe("repoA/docs/b.md");
  });

  it("execute ohne vorherigen Plan schreibt nicht, wenn ein Bestätigungsgrund besteht", async () => {
    const c = ctx();
    const r = await c.runner.execute("all", sig());
    expect(r).toMatchObject({ kind: "waiting", reasons: ["first-run"] });
    expect(ops(c)).toEqual([]);
  });

  it("Abbruch → done mit aborted, last.ok bleibt true mit counts, Manifest teilweise gespeichert, Fingerabdruck unberührt", async () => {
    const c = ctx();
    await c.runner.run("manual", sig());
    const ac = new AbortController();
    let n = 0;
    c.onRead = () => { n++; if (n === 2) ac.abort(); };
    const d = await c.runner.execute(new Set(), ac.signal);
    expect(d).toMatchObject({ kind: "done", aborted: true });
    expect(c.state.data.last).toMatchObject({ ok: true, counts: { created: 2 } });
    expect(Object.keys(c.state.data.manifest ?? {})).toHaveLength(2);
    expect(c.state.data.fingerprint).toBeNull();
    expect(c.vault.tempNames()).toEqual([]);
    // der nächste Lauf bleibt bestätigungspflichtig
    c.onRead = undefined;
    const next = await c.runner.run("manual", sig());
    expect(next).toMatchObject({ kind: "waiting", reasons: ["settings-changed"] });
  });

  it("schon abgebrochen vor dem Scan → nichts geschieht", async () => {
    const c = ctx();
    const ac = new AbortController();
    ac.abort();
    const r = await c.runner.run("manual", ac.signal);
    expect(r).toMatchObject({ kind: "done", aborted: true });
    expect(c.state.saves).toEqual([]);
    expect(ops(c)).toEqual([]);
    expect(c.scans.n).toBe(0);
  });

  it("Abbruch während des Scans → aborted, nichts gespeichert, nichts geschrieben", async () => {
    const c = ctx();
    const ac = new AbortController();
    c.scans.onScan = () => ac.abort();
    const r = await c.runner.run("manual", ac.signal);
    expect(r).toMatchObject({ kind: "done", aborted: true });
    expect(c.state.saves).toEqual([]);
    expect(ops(c)).toEqual([]);
    expect(c.runner.pending()).toBeNull();
  });

  it("Fehler bei der Planung → last.ok false, error trägt den Schlüssel der Notice, Manifest unverändert", async () => {
    const c = ctx();
    await mirrored(c);
    const before = JSON.stringify(c.state.data.manifest);
    c.vault.failOn("list");
    const r = await c.runner.run("manual", sig());
    expect(r).toMatchObject({ kind: "done", aborted: false });
    expect(c.state.data.last).toMatchObject({ ok: false, error: "notice.failed" });
    expect((r as Extract<RunOutcome, { kind: "done" }>).info.error).toBe("notice.failed");
    expect(JSON.stringify(c.state.data.manifest)).toBe(before);
    expect(c.runner.isBusy()).toBe(false);
  });

  it("state.save wirft nach dem Lauf → done mit ok false und notice.failed, Sperre frei", async () => {
    const c = ctx();
    await c.runner.run("manual", sig());
    c.state.save = (p) => ("last" in p ? Promise.reject(new Error("disk")) : Promise.resolve());
    const d = await c.runner.execute(new Set(), sig());
    expect(d).toMatchObject({ kind: "done", info: { ok: false, error: "notice.failed" } });
    expect(c.runner.isBusy()).toBe(false);
  });

  it("state.save wirft beim blocked-Pfad → blocked statt Wurf, Sperre frei", async () => {
    const c = ctx();
    c.setSource({}, { missingRoot: true });
    c.state.save = () => Promise.reject(new Error("disk"));
    expect(await c.runner.run("manual", sig())).toEqual({ kind: "blocked", reason: "source-unreachable" });
    expect(c.runner.isBusy()).toBe(false);
  });

  it("state.save wirft beim Planungsfehler → done mit notice.failed statt Wurf", async () => {
    const c = ctx();
    c.vault.failOn("list");
    c.state.save = () => Promise.reject(new Error("disk"));
    const r = await c.runner.run("manual", sig());
    expect(r).toMatchObject({ kind: "done", info: { ok: false, error: "notice.failed" } });
    expect(c.runner.isBusy()).toBe(false);
  });

  it("Dateifehler im Lauf → last.ok false mit notice.partial, Zähler tragen die Fehler", async () => {
    const c = ctx();
    await c.runner.run("manual", sig());
    c.vault.failOn("writeTemp");
    const d = await c.runner.execute(new Set(), sig());
    const info = (d as Extract<RunOutcome, { kind: "done" }>).info;
    expect(info).toMatchObject({ ok: false, error: "notice.partial" });
    expect(info.counts.errors).toBe(3);
  });
});
