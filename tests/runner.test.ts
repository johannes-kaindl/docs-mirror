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
  /** Basispfad des Vaults, wie ihn der Plugin-Host liefert (`null` = unbekannt). */
  vaultBase: string | null;
  /** Ersatz für die Auflösung über das Dateisystem (Symlinks); fehlt er, bleiben die Pfade Text. */
  resolve?: (root: string, vaultBase: string | null) => { root: string; vaultBase: string | null };
}
function ctx(over: { settings?: Partial<DocsMirrorSettings>; root?: string; pace?: number } = {}): Ctx {
  const c = {} as Ctx;
  c.state = memState(over.root);
  c.vault = fakeVault();
  c.tree = { ...TREE };
  c.settings = { ...DEFAULT_SETTINGS, ...over.settings };
  c.reads = [];
  c.vaultBase = null;
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
    paceEveryMs: over.pace,
    vaultBasePath: () => c.vaultBase,
    resolvePaths: (root, vaultBase) => (c.resolve ? c.resolve(root, vaultBase) : { root, vaultBase }),
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
  it("Befund 2026-10-31: der Scan meldet gelesene Einträge mit total null, danach zählt das Schreiben mit endlicher Gesamtzahl", async () => {
    const c = ctx({ pace: 0 });
    const scan: [number, number | null][] = [];
    const w = await c.runner.run("manual", sig(), (d, t) => scan.push([d, t]));
    expect(w.kind).toBe("waiting");
    expect(scan.length).toBeGreaterThan(0);
    expect(scan.every(([, t]) => t === null)).toBe(true);
    expect(scan.map(([d]) => d)).toEqual([...scan.map(([d]) => d)].sort((a, b) => a - b));
    expect(scan.at(-1)![0]).toBe(7);
    const run: [number, number | null][] = [];
    const d = await c.runner.execute(new Set(), sig(), (n, t) => run.push([n, t]));
    expect(d.kind).toBe("done");
    expect(run.some(([, t]) => t === null)).toBe(true);
    expect(run.at(-1)).toEqual([3, 3]);
  });

  it("Scan-Fortschritt kommt nur im Takt des Zeittors (Standard 250 ms), nicht je Eintrag", async () => {
    const c = ctx();
    const scan: [number, number | null][] = [];
    await c.runner.run("manual", sig(), (d, t) => scan.push([d, t]));
    expect(scan.filter(([, t]) => t === null)).toEqual([]);
  });

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
  it("I1: Wurzel gleich Vault → blocked/vault-is-root, nichts gelesen, nichts geschrieben, nichts gespeichert", async () => {
    const c = ctx();
    c.vaultBase = `${ROOT}/`;
    const r = await c.runner.run("manual", sig());
    expect(r).toEqual({ kind: "blocked", reason: "vault-is-root" });
    expect(c.scans.n).toBe(0);
    expect(ops(c)).toEqual([]);
    expect(c.state.saves).toEqual([]);
    expect(await c.runner.execute("all", sig())).toEqual({ kind: "blocked", reason: "vault-is-root" });
  });

  it("I1: Vault unterhalb der Wurzel → die Spiegelkopien werden nie als Quelle gelesen (zweiter Lauf: 0 neu)", async () => {
    const c = ctx();
    c.vaultBase = `${ROOT}/mirror`;
    await mirrored(c);
    // Der Vault liegt unter der Wurzel: seine Dateien erscheinen im Quellbaum.
    c.setSource({ ...TREE, ...Object.fromEntries(Object.keys(TREE).map((k) => [`mirror/${k}`, "kopie"])) });
    const r = await c.runner.run("manual", sig());
    expect(r).toMatchObject({ kind: "done", info: { ok: true, counts: { created: 0, updated: 0, deleted: 0, unchanged: 3 } } });
    expect(c.reads.some((p) => p.startsWith("mirror/"))).toBe(false);
    // Segmentgrenze: ein Geschwister `mirror2` bleibt Quelle.
    c.setSource({ ...TREE, "mirror2/docs/z.md": "zett" });
    const w = await c.runner.run("manual", sig());
    expect(w.kind === "done" ? w.info.counts.created : -1).toBe(1);
  });

  it("Symlink: der Host löst den Vault-Basispfad auf, der Runner schließt den Vault als Quelle aus (Kontrolle ohne Auflösung: er liest die Kopien)", async () => {
    for (const resolved of [true, false]) {
      const c = ctx();
      c.vaultBase = "/links/vault-link";
      if (resolved) c.resolve = (root) => ({ root, vaultBase: `${root}/mirror` });
      await mirrored(c);
      c.setSource({ ...TREE, ...Object.fromEntries(Object.keys(TREE).map((k) => [`mirror/${k}`, "kopie"])) });
      c.reads.length = 0;
      await c.runner.run("manual", sig());
      expect(c.reads.some((p) => p.startsWith("mirror/")), `resolved=${resolved}`).toBe(!resolved);
    }
  });

  it("Symlink: Wurzel und Vault lösen auf dasselbe Verzeichnis auf → blocked/vault-is-root", async () => {
    const c = ctx();
    c.vaultBase = "/links/other-name";
    c.resolve = () => ({ root: "/real", vaultBase: "/real" });
    expect(await c.runner.run("manual", sig())).toEqual({ kind: "blocked", reason: "vault-is-root" });
    expect(c.scans.n).toBe(0);
  });

  it("neu ausgeschlossener Vault-Teilbaum: Manifest-Kopien darunter werden zu delete und laufen durch die Schwelle, vault-only bleibt unangetastet", async () => {
    const c = ctx({ settings: { deleteThresholdFiles: 1, deleteThresholdPercent: 0 } });
    c.setSource({ ...TREE, "mirror/docs/k.md": "kopie" });
    await mirrored(c);
    expect(c.vault.has("mirror/docs/k.md")).toBe(true);
    c.vault.put("mirror/eigen.md", "nur im vault");
    // Ab jetzt liegt der Vault unter `mirror`: der Teilbaum gehört nicht mehr zur Quelle.
    c.vaultBase = `${ROOT}/mirror`;
    const w = await c.runner.run("manual", sig());
    expect(w.kind).toBe("waiting");
    if (w.kind !== "waiting") return;
    expect(w.plan.items.filter((i) => i.cls === "delete").map((i) => i.path)).toEqual(["mirror/docs/k.md"]);
    expect(w.plan.items.some((i) => i.path === "mirror/eigen.md" && i.cls === "delete")).toBe(false);
    expect(w.reasons.length).toBeGreaterThan(0);
    expect(c.vault.has("mirror/docs/k.md")).toBe(true);
    const d = await c.runner.execute(new Set(), sig());
    expect(d).toMatchObject({ kind: "done", info: { counts: { deleted: 1 } } });
    expect(c.vault.has("mirror/docs/k.md")).toBe(false);
    expect(c.vault.text("mirror/eigen.md")).toBe("nur im vault");
  });

  it("M1: erscheint nach dem Warten ein neuer Bestätigungsgrund bei gleichem Plan, wartet der Lauf erneut", async () => {
    const c = ctx();
    const w = await c.runner.run("manual", sig());
    expect(w).toMatchObject({ kind: "waiting", reasons: ["first-run"] });
    c.settings = { ...c.settings, maxTotalBytes: 1 };
    const again = await c.runner.execute(new Set(), sig());
    expect(again).toMatchObject({ kind: "waiting" });
    expect((again as Extract<RunOutcome, { kind: "waiting" }>).reasons).toContain("total-size");
    expect(ops(c)).toEqual([]);
    expect(c.runner.pending()).not.toBeNull();
    // Mit dem Grund bestätigt (derselbe Plan, derselbe Grund) läuft er.
    expect((await c.runner.execute(new Set(), sig())).kind).toBe("done");
  });
});
