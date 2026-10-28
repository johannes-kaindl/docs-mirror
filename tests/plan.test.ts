import { describe, expect, it } from "vitest";
import type { Manifest, ManifestEntry } from "../src/core/manifest";
import { buildPlan, type Plan, type PlanClass } from "../src/core/plan";
import type { ScanResult, SourceFile } from "../src/core/scan";
import { sha256Hex } from "../src/vendor/kit/sha256";
import { fakeVault, type FakeVault } from "./helpers/fake-vault";

const enc = new TextEncoder();
const hash = (s: string): string => sha256Hex(enc.encode(s));

interface Src { content: string; mtime?: number }
function scanOf(files: Record<string, Src>, over: Partial<ScanResult> = {}): ScanResult {
  const list: SourceFile[] = Object.entries(files).map(([path, f]) => ({
    path, size: enc.encode(f.content).byteLength, mtime: f.mtime ?? 1000,
  }));
  return {
    state: list.length === 0 ? "empty" : "ok", files: list,
    skipped: { symlinks: 0, tooBig: 0, otherType: 0 }, collisions: [], unreadable: [], incomplete: false,
    invalidPatterns: [], ...over,
  };
}
/** Manifest-Eintrag einer früher gespiegelten Datei (Quelle und Vault gleich, Zeiten 1000/2000). */
function entry(path: string, content: string, over: Partial<ManifestEntry> = {}): ManifestEntry {
  const size = enc.encode(content).byteLength;
  return { path, srcSize: size, srcMtime: 1000, size, mtime: 2000, hash: hash(content), ...over };
}
const manifestOf = (...es: ManifestEntry[]): Manifest => Object.fromEntries(es.map((e) => [e.path, e]));

interface Ctx { vault: FakeVault; srcReads: string[]; plan: () => Promise<Plan> }
function setup(
  files: Record<string, Src>,
  manifest: Manifest,
  scanOver: Partial<ScanResult> = {},
  vault: FakeVault = fakeVault(),
  sourceBytes: Record<string, string> = Object.fromEntries(Object.entries(files).map(([p, f]) => [p, f.content])),
): Ctx {
  const srcReads: string[] = [];
  return {
    vault, srcReads,
    plan: () => buildPlan({
      scan: scanOf(files, scanOver), manifest, vault,
      readSource: (p) => { srcReads.push(p); return Promise.resolve(enc.encode(sourceBytes[p] ?? "")); },
    }),
  };
}
const clsOf = (p: Plan, path: string): PlanClass | undefined => p.items.find((i) => i.path === path)?.cls;

describe("buildPlan", () => {
  it("neu: Quelle ja, Manifest nein, Vault nein", async () => {
    const c = setup({ "a/docs/x.md": { content: "x" } }, {});
    const p = await c.plan();
    expect(p.items).toEqual([expect.objectContaining({ path: "a/docs/x.md", cls: "new" })]);
    expect(p.counts.new).toBe(1);
    expect(p.totalBytes).toBe(1);
    expect(p.sourceState).toBe("ok");
  });

  it("unverändert: Größe und Zeit gleich, nichts wird gelesen", async () => {
    const v = fakeVault();
    v.put("a/x.md", "abc", 2000);
    const c = setup({ "a/x.md": { content: "abc" } }, manifestOf(entry("a/x.md", "abc")), {}, v);
    v.resetCalls();
    const p = await c.plan();
    expect(clsOf(p, "a/x.md")).toBe("unchanged");
    expect(v.calls.read).toEqual([]);
    expect(c.srcReads).toEqual([]);
    expect(p.totalBytes).toBe(0);
  });

  it("geändert: Quellgröße verschieden, ohne Quelle zu lesen", async () => {
    const v = fakeVault();
    v.put("a/x.md", "abc", 2000);
    const c = setup({ "a/x.md": { content: "abcd" } }, manifestOf(entry("a/x.md", "abc")), {}, v);
    const p = await c.plan();
    expect(clsOf(p, "a/x.md")).toBe("changed");
    expect(p.totalBytes).toBe(4);
    expect(c.srcReads).toEqual([]);
  });

  it("geändert: Größe gleich, Zeit anders, Inhalt verschieden", async () => {
    const v = fakeVault();
    v.put("a/x.md", "abc", 2000);
    const c = setup({ "a/x.md": { content: "abd", mtime: 1500 } }, manifestOf(entry("a/x.md", "abc")), {}, v);
    const p = await c.plan();
    expect(clsOf(p, "a/x.md")).toBe("changed");
    expect(c.srcReads).toEqual(["a/x.md"]);
  });

  it("unverändert: Größe gleich, Zeit anders, Inhalt gleich; Zeit wird nachgezogen", async () => {
    const v = fakeVault();
    v.put("a/x.md", "abc", 2000);
    const c = setup({ "a/x.md": { content: "abc", mtime: 1500 } }, manifestOf(entry("a/x.md", "abc")), {}, v);
    const p = await c.plan();
    const it = p.items[0];
    expect(it.cls).toBe("unchanged");
    expect(it.entry?.srcMtime).toBe(1500);
    expect(p.totalBytes).toBe(0);
  });

  it("im Vault verändert: Vault-Größe weicht ab und der Hash auch", async () => {
    const v = fakeVault();
    v.put("a/x.md", "abcXYZ", 2000);
    const c = setup({ "a/x.md": { content: "abc" } }, manifestOf(entry("a/x.md", "abc")), {}, v);
    const p = await c.plan();
    expect(clsOf(p, "a/x.md")).toBe("vault-modified");
    expect(v.calls.read).toEqual(["a/x.md"]);
    expect(p.totalBytes).toBe(3);
  });

  it("im Vault verändert: gleiche Größe, andere Zeit, anderer Inhalt", async () => {
    const v = fakeVault();
    v.put("a/x.md", "abX", 2500);
    const c = setup({ "a/x.md": { content: "abc" } }, manifestOf(entry("a/x.md", "abc")), {}, v);
    expect(clsOf(await c.plan(), "a/x.md")).toBe("vault-modified");
  });

  it("nur die Vault-Zeit weicht ab, der Hash stimmt: unverändert mit nachgezogenem Eintrag", async () => {
    const v = fakeVault();
    v.put("a/x.md", "abc", 2500);
    const c = setup({ "a/x.md": { content: "abc" } }, manifestOf(entry("a/x.md", "abc")), {}, v);
    const p = await c.plan();
    expect(p.items[0].cls).toBe("unchanged");
    expect(p.items[0].entry?.mtime).toBe(2500);
    expect(v.calls.read).toEqual(["a/x.md"]);
  });

  it("zu löschen: Manifest ja, Quelle nein, Vault-Datei da", async () => {
    const v = fakeVault();
    v.put("a/old.md", "o", 2000);
    const c = setup({ "a/keep.md": { content: "k" } }, manifestOf(entry("a/old.md", "o")), {}, v);
    const p = await c.plan();
    expect(clsOf(p, "a/old.md")).toBe("delete");
    expect(p.items.find((i) => i.cls === "delete")?.entry?.path).toBe("a/old.md");
  });

  it("Manifest ja, Quelle nein, Vault-Datei fehlt: kein delete, Eintrag wird vergessen", async () => {
    const c = setup({ "a/keep.md": { content: "k" } }, manifestOf(entry("a/gone.md", "g")));
    const p = await c.plan();
    expect(p.counts.delete).toBe(0);
    expect(p.items.some((i) => i.path === "a/gone.md")).toBe(false);
    expect(p.forget).toEqual(["a/gone.md"]);
  });

  it("im Vault fehlt: Manifest ja, Quelle ja, Vault-Datei fehlt gibt new/vault-missing", async () => {
    const c = setup({ "a/x.md": { content: "abc" } }, manifestOf(entry("a/x.md", "abc")));
    const p = await c.plan();
    expect(p.items[0]).toMatchObject({ cls: "new", reason: "vault-missing" });
    expect(p.totalBytes).toBe(3);
  });

  it("Konflikt: Datei am Zielpfad, nicht im Manifest, Inhalt abweichend", async () => {
    const v = fakeVault();
    v.put("a/x.md", "fremd", 3000);
    const c = setup({ "a/x.md": { content: "meinsmehr" } }, {}, {}, v);
    const p = await c.plan();
    expect(clsOf(p, "a/x.md")).toBe("conflict");
    expect(p.totalBytes).toBe(0);
    expect(p.counts.conflict).toBe(1);
    expect(v.calls.read).toEqual([]);
    expect(c.srcReads).toEqual([]);
  });

  it("Konflikt mit gleicher Größe, anderem Inhalt: wird gelesen und erkannt", async () => {
    const v = fakeVault();
    v.put("a/x.md", "abd", 3000);
    const c = setup({ "a/x.md": { content: "abc" } }, {}, {}, v);
    expect(clsOf(await c.plan(), "a/x.md")).toBe("conflict");
  });

  it("Konflikt-Gleichheit: Inhalt gleich nimmt die Datei ohne Schreiben ins Manifest auf", async () => {
    const v = fakeVault();
    v.put("a/x.md", "abc", 3000);
    const c = setup({ "a/x.md": { content: "abc", mtime: 1200 } }, {}, {}, v);
    const p = await c.plan();
    expect(p.items[0].cls).toBe("unchanged");
    expect(p.items[0].entry).toEqual({
      path: "a/x.md", srcSize: 3, srcMtime: 1200, size: 3, mtime: 3000, hash: hash("abc"),
    });
    expect(p.totalBytes).toBe(0);
  });

  it("nur im Vault: nie delete", async () => {
    const v = fakeVault();
    v.put("a/mine.md", "m", 1);
    v.put("eigenes/notiz.md", "n", 1);
    const c = setup({ "a/mine.md": { content: "m" } }, {}, {}, v);
    const p = await c.plan();
    expect(clsOf(p, "eigenes/notiz.md")).toBe("vault-only");
    expect(p.counts["vault-only"]).toBe(1);
    expect(p.counts.delete).toBe(0);
  });

  it("Typwechsel: Ordner am Zielpfad gibt conflict/type-change", async () => {
    const v = fakeVault();
    v.putFolder("a/x.md");
    const c = setup({ "a/x.md": { content: "x" } }, {}, {}, v);
    const p = await c.plan();
    expect(p.items[0]).toMatchObject({ cls: "conflict", reason: "type-change" });
  });

  it("Kollision aus dem Scan: je Mitglied conflict/case-collision, mit Originalnamen", async () => {
    const c = setup({ "a/other.md": { content: "o" } }, {}, { collisions: [["a/Foo.md", "a/foo.md"]] });
    const p = await c.plan();
    const members = p.items.filter((i) => i.reason === "case-collision");
    expect(members.map((m) => [m.path, m.cls])).toEqual([["a/Foo.md", "conflict"], ["a/foo.md", "conflict"]]);
  });

  it("Kollision NFC/NFD im selben Ordner: zwei unterscheidbare Pfade", async () => {
    const nfd = "a/Café.md";
    const nfcName = "a/Café.md";
    const c = setup({ "a/x.md": { content: "x" } }, {}, { collisions: [[nfd, nfcName]] });
    const p = await c.plan();
    const paths = p.items.filter((i) => i.reason === "case-collision").map((i) => i.path);
    expect(new Set(paths).size).toBe(2);
  });

  it("zuvor gespiegeltes Foo.md, dann kommt foo.md dazu: kein delete, beide conflict", async () => {
    const v = fakeVault({ caseInsensitive: true });
    v.put("a/Foo.md", "f", 2000);
    const c = setup(
      { "a/other.md": { content: "o" } },
      manifestOf(entry("a/Foo.md", "f")),
      { collisions: [["a/Foo.md", "a/foo.md"]] },
      v,
    );
    const p = await c.plan();
    expect(p.counts.delete).toBe(0);
    expect(p.items.filter((i) => i.cls === "conflict").map((i) => i.path).sort()).toEqual(["a/Foo.md", "a/foo.md"]);
    expect(p.counts["vault-only"]).toBe(0);
  });

  it("APFS: andere Schreibweise im Vault am Zielpfad gibt conflict/case-collision statt new", async () => {
    const v = fakeVault({ caseInsensitive: true });
    v.put("a/README.md", "fremd", 5);
    const c = setup({ "a/readme.md": { content: "meins" } }, {}, {}, v);
    const p = await c.plan();
    expect(p.items.find((i) => i.path === "a/readme.md")).toMatchObject({ cls: "conflict", reason: "case-collision" });
    expect(p.counts["vault-only"]).toBe(0);
  });

  it("APFS: NFD-Name im Vault ist derselbe Pfad wie der NFC-Zielpfad", async () => {
    const v = fakeVault({ normalizationInsensitive: true });
    v.put("a/Café.md", "abc", 2000);
    const c = setup({ "a/Café.md": { content: "abc" } }, manifestOf(entry("a/Café.md", "abc")), {}, v);
    const p = await c.plan();
    expect(clsOf(p, "a/Café.md")).toBe("unchanged");
    expect(p.counts["vault-only"]).toBe(0);
  });

  it.each(["unreachable", "empty"] as const)("Quelle %s: keine delete-Einträge, auch bei vollem Manifest", async (state) => {
    const v = fakeVault();
    const es: ManifestEntry[] = [];
    for (let i = 0; i < 30; i++) {
      v.put(`a/f${i}.md`, "x", 2000);
      es.push(entry(`a/f${i}.md`, "x"));
    }
    const c = setup({}, manifestOf(...es), { state }, v);
    const p = await c.plan();
    expect(p.counts.delete).toBe(0);
    expect(p.forget).toEqual([]);
    expect(p.sourceState).toBe(state);
  });

  it("incomplete: Einträge unter einem unreadable-Präfix bleiben unangetastet und zählen als nicht geprüft", async () => {
    const v = fakeVault();
    v.put("r/docs/sub/a.md", "a", 2000);
    v.put("r/docs/b.md", "b", 2000);
    v.put("r/docs2/c.md", "c", 2000);
    const c = setup(
      { "z/docs/z.md": { content: "z" } },
      manifestOf(entry("r/docs/sub/a.md", "a"), entry("r/docs/b.md", "b"), entry("r/docs2/c.md", "c")),
      { unreadable: ["r/docs"], incomplete: true },
      v,
    );
    const p = await c.plan();
    expect(p.unchecked).toBe(2);
    expect(p.items.map((i) => i.path)).not.toContain("r/docs/sub/a.md");
    expect(p.items.map((i) => i.path)).not.toContain("r/docs/b.md");
    // Geschwister mit gleichem Namenspräfix ("docs2") liegt nicht unter dem Präfix und wird gelöscht.
    expect(clsOf(p, "r/docs2/c.md")).toBe("delete");
    expect(p.counts.delete).toBe(1);
    expect(p.forget).toEqual([]);
    expect(p.counts["vault-only"]).toBe(0);
  });

  it("incomplete: Quelldatei unter dem Präfix wird nicht überschrieben, wenn sie fehlt, bleibt sie im Manifest", async () => {
    const c = setup({ "z/z.md": { content: "z" } }, manifestOf(entry("r/gone.md", "g")), { unreadable: ["r"], incomplete: true });
    const p = await c.plan();
    expect(p.unchecked).toBe(1);
    expect(p.forget).toEqual([]);
  });

  it("zählt Klassen und totalBytes (nur new + changed + vault-modified, nie Konflikte)", async () => {
    const v = fakeVault();
    v.put("a/changed.md", "aa", 2000);
    v.put("a/vm.md", "XX", 2500);
    v.put("a/conf.md", "fremd", 1);
    const c = setup(
      {
        "a/new.md": { content: "12345" },
        "a/changed.md": { content: "aaaa" },
        "a/vm.md": { content: "bb" },
        "a/conf.md": { content: "ganzanders" },
      },
      manifestOf(entry("a/changed.md", "aa"), entry("a/vm.md", "bb")),
      {},
      v,
    );
    const p = await c.plan();
    expect(p.counts).toMatchObject({ new: 1, changed: 1, "vault-modified": 1, conflict: 1 });
    expect(p.totalBytes).toBe(5 + 4 + 2);
  });

  it("reicht skipped durch", async () => {
    const c = setup({ "a/x.md": { content: "x" } }, {}, { skipped: { symlinks: 2, tooBig: 1, otherType: 0 } });
    expect((await c.plan()).skipped).toEqual({ symlinks: 2, tooBig: 1, otherType: 0 });
  });
});
