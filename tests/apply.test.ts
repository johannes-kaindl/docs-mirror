import { describe, expect, it } from "vitest";
import { applyPlan, type ApplyIo, type ApplyOptions } from "../src/core/apply";
import type { Manifest, ManifestEntry } from "../src/core/manifest";
import { buildPlan, type Plan, type PlanClass, type PlanItem } from "../src/core/plan";
import type { ScanResult, SourceFile } from "../src/core/scan";
import { sha256Hex } from "../src/vendor/kit/sha256";
import { fakeVault, type FakeVault, type FakeVaultOptions } from "./helpers/fake-vault";

const enc = new TextEncoder();
const dec = new TextDecoder();
const hash = (s: string): string => sha256Hex(enc.encode(s));
const size = (s: string): number => enc.encode(s).byteLength;

function entry(path: string, content: string, over: Partial<ManifestEntry> = {}): ManifestEntry {
  return { path, srcSize: size(content), srcMtime: 1000, size: size(content), mtime: 2000, hash: hash(content), ...over };
}
const manifestOf = (...es: ManifestEntry[]): Manifest => Object.fromEntries(es.map((e) => [e.path, e]));
const srcFile = (path: string, content: string, mtime = 1000): SourceFile => ({ path, size: size(content), mtime });

function planOf(items: PlanItem[], over: Partial<Plan> = {}): Plan {
  const counts = { new: 0, changed: 0, unchanged: 0, delete: 0, "vault-modified": 0, conflict: 0, "vault-only": 0 } as Record<PlanClass, number>;
  for (const it of items) counts[it.cls]++;
  return {
    items, counts, totalBytes: 0, mirrorBytes: 0, skipped: { symlinks: 0, tooBig: 0, otherType: 0 },
    sourceState: "ok", unchecked: 0, forget: [], ...over,
  };
}
const newItem = (path: string, content: string): PlanItem => ({ path, cls: "new", src: srcFile(path, content) });

interface Harness {
  io: ApplyIo;
  saved: Manifest[];
  yields: { n: number };
  progress: [number, number][];
  ac: AbortController;
}
function harness(vault: FakeVault, sources: Record<string, string>, over: Partial<ApplyIo> = {}): Harness {
  const saved: Manifest[] = [];
  const yields = { n: 0 };
  const progress: [number, number][] = [];
  const ac = new AbortController();
  const io: ApplyIo = {
    vault,
    readSource: (p) => {
      const c = sources[p];
      return c === undefined ? Promise.reject(new Error(`ENOENT: ${p}`)) : Promise.resolve(enc.encode(c));
    },
    yieldToUi: () => { yields.n++; return Promise.resolve(); },
    signal: ac.signal,
    onProgress: (d, t) => progress.push([d, t]),
    saveManifest: (m) => { saved.push({ ...m }); return Promise.resolve(); },
    ...over,
  };
  return { io, saved, yields, progress, ac };
}
const OPTS: ApplyOptions = { overwrite: new Set(), saveEvery: 1000, yieldEveryMs: 0 };
const vaultOf = (o?: FakeVaultOptions): FakeVault => fakeVault(o);

describe("applyPlan — Schreiben", () => {
  it("neu und geändert werden geschrieben, das Manifest trägt Hash, Größe, Zeit der Vault-Datei und Größe/Zeit der Quelle", async () => {
    const v = vaultOf();
    v.put("r/docs/b.md", "old", 500);
    const h = harness(v, { "r/docs/a.md": "alpha", "r/docs/b.md": "beta!" });
    const plan = planOf([
      { path: "r/docs/a.md", cls: "new", src: srcFile("r/docs/a.md", "alpha", 3000) },
      { path: "r/docs/b.md", cls: "changed", src: srcFile("r/docs/b.md", "beta!", 4000), entry: entry("r/docs/b.md", "old"), vaultPath: "r/docs/b.md" },
    ]);
    const r = await applyPlan(plan, manifestOf(entry("r/docs/b.md", "old")), h.io, OPTS);
    expect(v.text("r/docs/a.md")).toBe("alpha");
    expect(v.text("r/docs/b.md")).toBe("beta!");
    expect(r.manifest["r/docs/a.md"]).toEqual({ path: "r/docs/a.md", srcSize: 5, srcMtime: 3000, size: 5, mtime: 3000, hash: hash("alpha") });
    expect(r.manifest["r/docs/b.md"]).toEqual({ path: "r/docs/b.md", srcSize: 5, srcMtime: 4000, size: 5, mtime: 4000, hash: hash("beta!") });
    expect(r.counts).toMatchObject({ created: 1, updated: 1, errors: 0 });
    expect(r.aborted).toBe(false);
    expect(h.saved.at(-1)).toEqual(r.manifest);
  });

  it("jede Datei: Eltern anlegen, Temp schreiben, bei bestehendem Ziel remove, dann replace (Schreibfolge)", async () => {
    const v = vaultOf();
    v.put("docs/a.md", "old");
    const h = harness(v, { "docs/a.md": "newer", "docs/n.md": "fresh" });
    const plan = planOf([
      { path: "docs/a.md", cls: "changed", src: srcFile("docs/a.md", "newer"), entry: entry("docs/a.md", "old"), vaultPath: "docs/a.md" },
      newItem("docs/n.md", "fresh"),
    ]);
    await applyPlan(plan, manifestOf(entry("docs/a.md", "old")), h.io, OPTS);
    const ops = v.calls.ops.filter((o) => !o.startsWith("clearTemp"));
    const temp = (o: string): string => o.split(":")[1].split(">")[0];
    expect(ops[0]).toBe("mkdirp:docs");
    expect(ops[1]).toMatch(/^writeTemp:/);
    expect(ops[2]).toBe("remove:docs/a.md");
    expect(ops[3]).toBe(`replace:${temp(ops[1])}>docs/a.md`);
    expect(ops[4]).toBe("mkdirp:docs");
    expect(ops[5]).toMatch(/^writeTemp:/);
    expect(ops[6]).toBe(`replace:${temp(ops[5])}>docs/n.md`);
    expect(ops.some((o) => o.startsWith("remove:docs/n"))).toBe(false);
    expect(v.calls.ops[0]).toBe("clearTemp");
    expect(v.tempNames()).toEqual([]);
  });

  it("die Temp-Datei wird gegen die gelesenen Bytes geprüft: abgeschnittene Temp erreicht nie das Ziel", async () => {
    const v = vaultOf({ truncateTemp: true });
    v.put("docs/a.md", "old");
    const h = harness(v, { "docs/a.md": "newer" });
    const plan = planOf([
      { path: "docs/a.md", cls: "changed", src: srcFile("docs/a.md", "newer"), entry: entry("docs/a.md", "old"), vaultPath: "docs/a.md" },
    ]);
    const r = await applyPlan(plan, manifestOf(entry("docs/a.md", "old")), h.io, OPTS);
    expect(r.errors).toHaveLength(1);
    expect(r.counts.errors).toBe(1);
    expect(v.text("docs/a.md")).toBe("old");
    expect(v.calls.ops.some((o) => o.startsWith("remove:docs/a.md"))).toBe(false);
    expect(v.calls.ops.some((o) => o.startsWith("replace:"))).toBe(false);
    expect(r.manifest["docs/a.md"]).toEqual(entry("docs/a.md", "old"));
    expect(v.tempNames()).toEqual([]);
  });

  it("vault-modified wird überschrieben; unchanged übernimmt den Eintrag ins Manifest", async () => {
    const v = vaultOf();
    v.put("docs/m.md", "edited");
    v.put("docs/u.md", "same");
    const h = harness(v, { "docs/m.md": "source" });
    const adopted = entry("docs/u.md", "same", { mtime: 1000 });
    const plan = planOf([
      { path: "docs/m.md", cls: "vault-modified", src: srcFile("docs/m.md", "source"), entry: entry("docs/m.md", "orig"), vaultPath: "docs/m.md" },
      { path: "docs/u.md", cls: "unchanged", src: srcFile("docs/u.md", "same"), entry: adopted },
    ]);
    const r = await applyPlan(plan, manifestOf(entry("docs/m.md", "orig")), h.io, OPTS);
    expect(v.text("docs/m.md")).toBe("source");
    expect(r.manifest["docs/u.md"]).toEqual(adopted);
    expect(r.counts).toMatchObject({ updated: 1, unchanged: 1, errors: 0 });
    expect(v.calls.ops.some((o) => o.includes("docs/u.md"))).toBe(false);
  });

  it("forget entfernt Einträge still aus dem Manifest, ohne etwas im Vault zu tun", async () => {
    const v = vaultOf();
    const h = harness(v, {});
    const r = await applyPlan(planOf([], { forget: ["docs/gone.md"] }), manifestOf(entry("docs/gone.md", "x"), entry("docs/keep.md", "y")), h.io, OPTS);
    expect(Object.keys(r.manifest)).toEqual(["docs/keep.md"]);
    expect(v.calls.ops.filter((o) => o !== "clearTemp")).toEqual([]);
  });

  it("der Pfad der vorgefundenen Datei (vaultPath, z. B. NFD) wird für remove und replace genutzt, der Schlüssel bleibt NFC", async () => {
    const v = vaultOf({ caseInsensitive: true, normalizationInsensitive: true });
    const nfd = "docs/Räte.md";
    const nfc = "docs/Räte.md";
    v.put(nfd, "old");
    const h = harness(v, { [nfc]: "new!!" });
    const plan = planOf([
      { path: nfc, cls: "changed", src: srcFile(nfc, "new!!"), entry: entry(nfc, "old"), vaultPath: nfd },
    ]);
    const r = await applyPlan(plan, manifestOf(entry(nfc, "old")), h.io, OPTS);
    expect(v.calls.ops).toContain(`remove:${nfd}`);
    expect(v.calls.ops.some((o) => o.endsWith(`>${nfd}`))).toBe(true);
    expect(Object.keys(r.manifest)).toEqual([nfc]);
  });

  it("saveManifest wirft am Ende: das Ergebnis kommt trotzdem zurück, errors trägt den Eintrag", async () => {
    const v = vaultOf();
    const h = harness(v, { "d/a.md": "a" }, { saveManifest: () => Promise.reject(new Error("disk full")) });
    const r = await applyPlan(planOf([newItem("d/a.md", "a")]), {}, h.io, OPTS);
    expect(r.errors).toEqual([{ path: "", message: "disk full" }]);
    expect(r.counts).toMatchObject({ created: 1, errors: 1 });
    expect(r.manifest["d/a.md"]).toBeDefined();
  });

  it("saveEvery speichert das Manifest zwischendurch", async () => {
    const v = vaultOf();
    const files: Record<string, string> = {};
    const items: PlanItem[] = [];
    for (let i = 0; i < 5; i++) { files[`d/f${i}.md`] = `c${i}`; items.push(newItem(`d/f${i}.md`, `c${i}`)); }
    const h = harness(v, files);
    await applyPlan(planOf(items), {}, h.io, { ...OPTS, saveEvery: 2 });
    // nach Datei 2 und 4, dazu der Abschluss
    expect(h.saved.map((m) => Object.keys(m).length)).toEqual([2, 4, 5]);
  });
});

describe("applyPlan — Löschen", () => {
  it("zu löschen entfernt nur Manifest-Dateien und danach leere Ordner, nie einen Ordner mit fremder Datei", async () => {
    const v = vaultOf();
    v.put("r/docs/a.md", "a");
    v.put("s/docs/b.md", "b");
    v.put("s/docs/foreign.md", "mine");
    const h = harness(v, {});
    const plan = planOf([
      { path: "r/docs/a.md", cls: "delete", entry: entry("r/docs/a.md", "a"), vaultPath: "r/docs/a.md" },
      { path: "s/docs/b.md", cls: "delete", entry: entry("s/docs/b.md", "b"), vaultPath: "s/docs/b.md" },
    ]);
    const r = await applyPlan(plan, manifestOf(entry("r/docs/a.md", "a"), entry("s/docs/b.md", "b")), h.io, OPTS);
    expect(v.has("r/docs/a.md")).toBe(false);
    expect(v.has("s/docs/b.md")).toBe(false);
    expect(v.has("s/docs/foreign.md")).toBe(true);
    expect(Object.keys(r.manifest)).toEqual([]);
    expect(r.counts.deleted).toBe(2);
    // Aufräumen läuft von innen nach außen und über removeIfEmpty (nie ein Löschen des Ordners mit Inhalt)
    expect(v.calls.ops).toContain("removeIfEmpty:r/docs");
    expect(v.calls.ops).toContain("removeIfEmpty:r");
    expect(v.calls.ops).not.toContain("remove:s/docs");
    expect((await v.stat("s/docs"))?.kind).toBe("folder");
    expect(await v.stat("r/docs")).toBeNull();
  });

  it("gelöscht wird unter dem echten Namen der vorgefundenen Datei (vaultPath, NFD), der Manifest-Schlüssel ist NFC", async () => {
    const v = vaultOf(); // Dateisystem unterscheidet NFC und NFD hier
    const nfd = "docs/Ra\u0308te.md";
    const nfc = "docs/R\u00e4te.md";
    v.put(nfd, "x");
    const h = harness(v, {});
    const plan = planOf([{ path: nfc, cls: "delete", entry: entry(nfc, "x"), vaultPath: nfd }]);
    const r = await applyPlan(plan, manifestOf(entry(nfc, "x")), h.io, OPTS);
    expect(v.has(nfd)).toBe(false);
    expect(r.manifest[nfc]).toBeUndefined();
    expect(r.counts.deleted).toBe(1);
  });

  it("ein delete-Eintrag, der nicht im Manifest steht, wird nie gelöscht", async () => {
    const v = vaultOf();
    v.put("docs/x.md", "stranger");
    const h = harness(v, {});
    const plan = planOf([{ path: "docs/x.md", cls: "delete", entry: entry("docs/x.md", "stranger"), vaultPath: "docs/x.md" }]);
    const r = await applyPlan(plan, {}, h.io, OPTS);
    expect(v.text("docs/x.md")).toBe("stranger");
    expect(r.counts.deleted).toBe(0);
    expect(v.calls.ops.some((o) => o.startsWith("remove:"))).toBe(false);
  });

  it("alle Löschungen laufen vor allen Schreibungen", async () => {
    const v = vaultOf();
    v.put("docs/z.md", "z");
    const h = harness(v, { "docs/a.md": "a" });
    // sortiert nach Pfad stünde a.md (neu) vor z.md (löschen)
    const plan = planOf([
      newItem("docs/a.md", "a"),
      { path: "docs/z.md", cls: "delete", entry: entry("docs/z.md", "z"), vaultPath: "docs/z.md" },
    ]);
    await applyPlan(plan, manifestOf(entry("docs/z.md", "z")), h.io, OPTS);
    const ops = v.calls.ops;
    const lastRemove = ops.map((o, i) => (o.startsWith("remove:") ? i : -1)).reduce((a, b) => Math.max(a, b), -1);
    const firstWrite = ops.findIndex((o) => o.startsWith("writeTemp:"));
    expect(lastRemove).toBeGreaterThanOrEqual(0);
    expect(lastRemove).toBeLessThan(firstWrite);
  });

  it("schlägt remove fehl, bleibt der Eintrag im Manifest und der Fehler wird gezählt", async () => {
    const v = vaultOf();
    v.put("docs/a.md", "a");
    v.failOn("remove", "docs/a.md");
    const h = harness(v, {});
    const plan = planOf([{ path: "docs/a.md", cls: "delete", entry: entry("docs/a.md", "a"), vaultPath: "docs/a.md" }]);
    const r = await applyPlan(plan, manifestOf(entry("docs/a.md", "a")), h.io, OPTS);
    expect(r.manifest["docs/a.md"]).toBeDefined();
    expect(r.counts).toMatchObject({ deleted: 0, errors: 1 });
  });
});

describe("applyPlan — Konflikte und Fremdes", () => {
  const conflictPlan = (reason?: PlanItem["reason"]): Plan =>
    planOf([{ path: "docs/c.md", cls: "conflict", src: srcFile("docs/c.md", "source"), reason, vaultPath: "docs/c.md" }]);

  it("Konflikt wird nur überschrieben, wenn opts.overwrite ihn nennt", async () => {
    const v = vaultOf();
    v.put("docs/c.md", "theirs");
    const h = harness(v, { "docs/c.md": "source" });
    const r1 = await applyPlan(conflictPlan(), {}, h.io, { ...OPTS, overwrite: new Set() });
    expect(v.text("docs/c.md")).toBe("theirs");
    expect(r1.manifest["docs/c.md"]).toBeUndefined();
    expect(r1.counts.overwritten).toBe(0);
    const r2 = await applyPlan(conflictPlan(), {}, h.io, { ...OPTS, overwrite: new Set(["docs/other.md"]) });
    expect(v.text("docs/c.md")).toBe("theirs");
    expect(r2.counts.overwritten).toBe(0);
    const r3 = await applyPlan(conflictPlan(), {}, h.io, { ...OPTS, overwrite: new Set(["docs/c.md"]) });
    expect(v.text("docs/c.md")).toBe("source");
    expect(r3.manifest["docs/c.md"]?.hash).toBe(hash("source"));
    expect(r3.counts.overwritten).toBe(1);
  });

  it('overwrite: "all" überschreibt Inhaltskonflikte', async () => {
    const v = vaultOf();
    v.put("docs/c.md", "theirs");
    const h = harness(v, { "docs/c.md": "source" });
    const r = await applyPlan(conflictPlan(), {}, h.io, { ...OPTS, overwrite: "all" });
    expect(v.text("docs/c.md")).toBe("source");
    expect(r.counts.overwritten).toBe(1);
  });

  it.each(["case-collision", "type-change"] as const)("Konflikt mit %s ist nie überschreibbar, auch nicht mit overwrite all", async (reason) => {
    const v = vaultOf();
    v.put("docs/c.md", "theirs");
    const h = harness(v, { "docs/c.md": "source" });
    const r = await applyPlan(conflictPlan(reason), {}, h.io, { ...OPTS, overwrite: "all" });
    expect(v.text("docs/c.md")).toBe("theirs");
    expect(r.counts.overwritten).toBe(0);
    expect(v.calls.ops.filter((o) => o !== "clearTemp")).toEqual([]);
    const r2 = await applyPlan(conflictPlan(reason), {}, h.io, { ...OPTS, overwrite: new Set(["docs/c.md"]) });
    expect(r2.counts.overwritten).toBe(0);
  });

  it("Kollisionsmitglieder ohne Quelle werden nie geschrieben", async () => {
    const v = vaultOf();
    const h = harness(v, { "docs/A.md": "x" });
    const plan = planOf([{ path: "docs/A.md", cls: "conflict", reason: "case-collision" }]);
    const r = await applyPlan(plan, {}, h.io, { ...OPTS, overwrite: "all" });
    expect(v.calls.ops.filter((o) => o !== "clearTemp")).toEqual([]);
    expect(r.counts.errors).toBe(0);
  });

  it("vault-only und orphan-modified werden nie angefasst", async () => {
    const v = vaultOf();
    v.put("docs/mine.md", "private");
    v.put("docs/orphan.md", "edited");
    const h = harness(v, {});
    const plan = planOf([
      { path: "docs/mine.md", cls: "vault-only" },
      { path: "docs/orphan.md", cls: "vault-only", reason: "orphan-modified", entry: entry("docs/orphan.md", "orig"), vaultPath: "docs/orphan.md" },
    ], { forget: ["docs/orphan.md"] });
    const r = await applyPlan(plan, manifestOf(entry("docs/orphan.md", "orig")), h.io, { ...OPTS, overwrite: "all" });
    expect(v.text("docs/mine.md")).toBe("private");
    expect(v.text("docs/orphan.md")).toBe("edited");
    expect(v.calls.ops.filter((o) => o !== "clearTemp")).toEqual([]);
    expect(r.manifest["docs/orphan.md"]).toBeUndefined();
  });
});

describe("applyPlan — Abbruch und Fehler", () => {
  it("Abbruch nach Datei 3 von 10: aborted, Teil-Manifest mit drei Dateien, keine Temp, nie ein unvollständiger Inhalt am Ziel", async () => {
    const v = vaultOf();
    const files: Record<string, string> = {};
    const items: PlanItem[] = [];
    for (let i = 0; i < 10; i++) { files[`d/f${i}.md`] = `content-${i}-${"x".repeat(i)}`; items.push(newItem(`d/f${i}.md`, files[`d/f${i}.md`])); }
    let done = 0;
    const h = harness(v, files, {
      onProgress: () => {},
    });
    const origRead = h.io.readSource;
    h.io.readSource = async (p) => { const b = await origRead(p); done++; if (done === 3) h.ac.abort(); return b; };
    const r = await applyPlan(planOf(items), {}, h.io, OPTS);
    expect(r.aborted).toBe(true);
    expect(Object.keys(r.manifest).sort()).toEqual(["d/f0.md", "d/f1.md", "d/f2.md"]);
    expect(h.saved.at(-1)).toEqual(r.manifest);
    expect(v.tempNames()).toEqual([]);
    expect(v.has("d/f3.md")).toBe(false);
    // jede Änderung am Ziel trägt den vollständigen Quellinhalt
    for (const w of v.writes) expect(dec.decode(w.data)).toBe(files[w.path]);
    expect(v.writes).toHaveLength(3);
  });

  it("jede Änderung am Ziel ist ein replace mit dem vollständigen Quellinhalt (kein direktes Schreiben)", async () => {
    const v = vaultOf();
    const h = harness(v, { "d/a.md": "complete content" });
    await applyPlan(planOf([newItem("d/a.md", "complete content")]), {}, h.io, OPTS);
    expect(v.writes).toHaveLength(1);
    expect(dec.decode(v.writes[0].data)).toBe("complete content");
    expect(v.calls.ops.filter((o) => o.startsWith("replace:"))).toHaveLength(1);
  });

  it("readSource wirft ENOENT: Fehler gezählt, Lauf geht weiter, bestehender Eintrag bleibt", async () => {
    const v = vaultOf();
    v.put("d/a.md", "old");
    const h = harness(v, { "d/b.md": "bee" });
    const plan = planOf([
      { path: "d/a.md", cls: "changed", src: srcFile("d/a.md", "gone-now"), entry: entry("d/a.md", "old"), vaultPath: "d/a.md" },
      newItem("d/b.md", "bee"),
    ]);
    const r = await applyPlan(plan, manifestOf(entry("d/a.md", "old")), h.io, OPTS);
    expect(r.counts).toMatchObject({ errors: 1, created: 1 });
    expect(r.errors[0].path).toBe("d/a.md");
    expect(r.manifest["d/a.md"]).toEqual(entry("d/a.md", "old"));
    expect(v.text("d/a.md")).toBe("old");
    expect(v.text("d/b.md")).toBe("bee");
  });

  it("gelesene Bytes weichen in der Länge vom Scan ab: überspringen, Fehler, kein neuer Eintrag", async () => {
    const v = vaultOf();
    const h = harness(v, { "d/a.md": "grew since the scan" });
    const plan = planOf([{ path: "d/a.md", cls: "new", src: srcFile("d/a.md", "short") }]);
    const r = await applyPlan(plan, {}, h.io, OPTS);
    expect(r.counts.errors).toBe(1);
    expect(v.has("d/a.md")).toBe(false);
    expect(r.manifest["d/a.md"]).toBeUndefined();
    expect(v.calls.ops.some((o) => o.startsWith("writeTemp"))).toBe(false);
  });

  it("replace schlägt nach erfolgtem remove fehl: Fehler gezählt, Eintrag entfällt, der nächste buildPlan meldet vault-missing", async () => {
    const v = vaultOf();
    v.put("d/a.md", "old", 2000);
    v.failOn("replace", "d/a.md");
    const h = harness(v, { "d/a.md": "newer" });
    const old = entry("d/a.md", "old");
    const plan = planOf([{ path: "d/a.md", cls: "changed", src: srcFile("d/a.md", "newer"), entry: old, vaultPath: "d/a.md" }]);
    const r = await applyPlan(plan, manifestOf(old), h.io, OPTS);
    expect(r.counts.errors).toBe(1);
    expect(r.manifest["d/a.md"]).toBeUndefined();
    expect(v.has("d/a.md")).toBe(false);
    v.clearFailures();
    // Eine Quelle, die nur noch als Manifest-Altlast existiert, heilt als new/vault-missing, wenn der Eintrag noch stünde:
    const scan: ScanResult = {
      state: "ok", files: [srcFile("d/a.md", "newer")], skipped: { symlinks: 0, tooBig: 0, otherType: 0 },
      collisions: [], unreadable: [], incomplete: false, invalidPatterns: [],
    };
    const next = await buildPlan({ scan, manifest: r.manifest, vault: v, readSource: h.io.readSource });
    expect(next.items).toMatchObject([{ path: "d/a.md", cls: "new" }]);
    const withEntry = await buildPlan({ scan, manifest: manifestOf(old), vault: v, readSource: h.io.readSource });
    expect(withEntry.items[0].reason).toBe("vault-missing");
  });

  it("B1: Ziel entsteht nach dem Planen (new) → replace wirft, Fehler gezählt, fremde Datei unverändert, Temp aufgeräumt, kein Eintrag", async () => {
    const v = vaultOf();
    const h = harness(v, { "d/n.md": "quelle" });
    const racing = Object.assign(Object.create(v) as FakeVault, {
      writeTemp: async (name: string, data: Uint8Array, mtime: number) => {
        await v.writeTemp(name, data, mtime);
        v.put("d/n.md", "fremd", 5);
      },
    });
    const plan = planOf([newItem("d/n.md", "quelle")]);
    const r = await applyPlan(plan, {}, { ...h.io, vault: racing }, OPTS);
    expect(r.counts.errors).toBe(1);
    expect(r.counts.created).toBe(0);
    expect(v.text("d/n.md")).toBe("fremd");
    expect(v.tempNames()).toEqual([]);
    expect(r.manifest["d/n.md"]).toBeUndefined();
    expect(v.calls.ops.some((o) => o === "remove:d/n.md")).toBe(false);
  });

  it("tick() steht am Ende jeder Iteration, auch nach Fehlern", async () => {
    const v = vaultOf();
    v.put("d/gone.md", "g");
    v.failOn("remove", "d/gone.md");
    const h = harness(v, { "d/ok.md": "fine" });
    const plan = planOf([
      { path: "d/gone.md", cls: "delete", entry: entry("d/gone.md", "g"), vaultPath: "d/gone.md" }, // Fehler
      newItem("d/missing.md", "zzz"), // ENOENT
      newItem("d/ok.md", "fine"), // Erfolg
      { path: "d/mine.md", cls: "conflict", src: srcFile("d/mine.md", "q") }, // übersprungen (continue-Pfad)
    ]);
    await applyPlan(plan, manifestOf(entry("d/gone.md", "g")), h.io, OPTS);
    expect(h.yields.n).toBe(4);
  });

  it("onProgress meldet erledigt/gesamt", async () => {
    const v = vaultOf();
    const h = harness(v, { "d/a.md": "a", "d/b.md": "b" });
    await applyPlan(planOf([newItem("d/a.md", "a"), newItem("d/b.md", "b")]), {}, h.io, OPTS);
    expect(h.progress.at(-1)).toEqual([2, 2]);
  });
});
