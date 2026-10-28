import { describe, expect, it } from "vitest";
import { DEFAULT_SETTINGS, type DocsMirrorSettings } from "../src/core/settings";
import { scanSource } from "../src/core/scan";
import { fakeSource } from "./helpers/fake-source";

const MB = 1024 * 1024;
const tree = {
  "a/repo1/docs/x.md": "x",
  "a/repo1/node_modules/docs/y.md": "y",
  ".claude/docs/z.md": "z",
  "b/docs/docs/w.md": "w",
  "c/repo2/docs/big.png": 6 * MB,
  "c/repo2/docs/clip.mp4": 100,
  "c/repo2/docs/link@": null,
};
const settings = (over: Partial<DocsMirrorSettings> = {}): DocsMirrorSettings => ({ ...DEFAULT_SETTINGS, ...over });
const paths = async (t: Record<string, string | number | null>, s = settings()) =>
  (await scanSource(fakeSource(t), s)).files.map((f) => f.path).sort();

describe("scanSource", () => {
  it("trifft docs auf Tiefe 2 bis 4", async () => {
    expect(await paths(tree)).toEqual(["a/repo1/docs/x.md", "b/docs/docs/w.md"].sort());
    const r = await scanSource(fakeSource(tree), settings());
    expect(r.state).toBe("ok");
  });

  it("trifft docs auch auf Tiefe 0", async () => {
    expect(await paths({ "docs/a.md": "a" })).toEqual(["docs/a.md"]);
  });

  it("betritt node_modules nie, auch nicht unter einem Treffer", async () => {
    const t = { "r/docs/node_modules/q.md": "q", "r/docs/ok.md": "o", "r/node_modules/docs/y.md": "y" };
    expect(await paths(t)).toEqual(["r/docs/ok.md"]);
  });

  it("betritt Punkt-Ordner nicht, mit includeDotFolders schon", async () => {
    const t = { ".claude/docs/z.md": "z", "r/docs/.hidden/h.md": "h", "r/docs/v.md": "v" };
    expect(await paths(t)).toEqual(["r/docs/v.md"]);
    expect(await paths(t, settings({ includeDotFolders: true }))).toEqual([".claude/docs/z.md", "r/docs/.hidden/h.md", "r/docs/v.md"]);
  });

  it("schachtelt nicht: docs/docs wird als Teil von docs kopiert, nicht doppelt", async () => {
    const t = { "b/docs/docs/w.md": "w", "b/docs/v.md": "v" };
    expect(await paths(t)).toEqual(["b/docs/docs/w.md", "b/docs/v.md"]);
  });

  it("überspringt Symlinks und zählt sie", async () => {
    const r = await scanSource(fakeSource(tree), settings({ patterns: ["**/docs"] }));
    expect(r.skipped.symlinks).toBe(1);
    expect(r.files.some((f) => f.path.endsWith("link"))).toBe(false);
  });

  it("folgt einem Symlink auf einen Ordner nicht", async () => {
    const t = { "r/docs/ok.md": "o", "r/docs/ziel@": null, "r/docs/ziel/geheim.md": "g" };
    const r = await scanSource(fakeSource(t), settings());
    expect(r.files.map((f) => f.path)).toEqual(["r/docs/ok.md"]);
    expect(r.skipped.symlinks).toBe(1);
    expect(r.unreadable).toEqual([]);
  });

  it("zählt Dateityp außerhalb der Liste", async () => {
    const r = await scanSource(fakeSource(tree), settings());
    expect(r.skipped.otherType).toBe(1);
  });

  it("vergleicht Endungen klein geschrieben", async () => {
    expect(await paths({ "r/docs/A.MD": "a" })).toEqual(["r/docs/A.MD"]);
  });

  it("zählt Dateien größer als maxFileBytes", async () => {
    const r = await scanSource(fakeSource(tree), settings());
    expect(r.skipped.tooBig).toBe(1);
    expect(r.files.some((f) => f.path.endsWith("big.png"))).toBe(false);
  });

  it("Wurzel fehlt → state unreachable", async () => {
    const r = await scanSource(fakeSource(tree, { missingRoot: true }), settings());
    expect(r.state).toBe("unreachable");
    expect(r.files).toEqual([]);
  });

  it("Wurzel ohne Treffer → state empty (Gegenprobe zum Löschschutz)", async () => {
    const r = await scanSource(fakeSource({ "a/readme.md": "r" }), settings());
    expect(r.state).toBe("empty");
    expect((await scanSource(fakeSource({}), settings())).state).toBe("empty");
  });

  it("NFD-Name wird zu NFC", async () => {
    const nfd = "Ü".normalize("NFD");
    const r = await scanSource(fakeSource({ [`r/docs/${nfd}.md`]: "u" }), settings());
    expect(r.files[0].path).toBe("r/docs/Ü.md");
    expect(r.files[0].path).toBe(r.files[0].path.normalize("NFC"));
  });

  it("NFD- und NFC-Schreibweise desselben Namens kollidieren", async () => {
    const t = { [`r/docs/${"Ü".normalize("NFD")}.md`]: "1", "r/docs/Ü.md": "2" };
    const r = await scanSource(fakeSource(t), settings());
    expect(r.collisions).toHaveLength(1);
    expect(r.files).toEqual([]);
  });

  it("Der Name Foo.md und foo.md in einem Ordner → collisions, keiner gewinnt", async () => {
    const t = { "r/docs/Foo.md": "1", "r/docs/foo.md": "2", "r/docs/bar.md": "3" };
    const r = await scanSource(fakeSource(t), settings());
    expect(r.collisions).toEqual([["r/docs/Foo.md", "r/docs/foo.md"]]);
    expect(r.files.map((f) => f.path)).toEqual(["r/docs/bar.md"]);
  });

  it("Ordner-Kollision mit Docs darunter beidseitig → Konflikt auf Dateiebene", async () => {
    const t = { "r/Foo/docs/x.md": "1", "r/foo/docs/x.md": "2", "r/ok/docs/y.md": "3" };
    const r = await scanSource(fakeSource(t), settings());
    expect(r.collisions).toEqual([["r/Foo/docs/x.md", "r/foo/docs/x.md"]]);
    expect(r.files.map((f) => f.path)).toEqual(["r/ok/docs/y.md"]);
  });

  it("Ordner-Kollision ohne Docs unter einem der beiden → keine Kollision", async () => {
    const t = { "r/Foo/docs/x.md": "1", "r/foo/readme.md": "2", "r/foo/src/a.ts": "3" };
    const r = await scanSource(fakeSource(t), settings());
    expect(r.collisions).toEqual([]);
    expect(r.files.map((f) => f.path)).toEqual(["r/Foo/docs/x.md"]);
  });

  it("ein readdir-Fehler in einem Unterordner landet in unreadable, der Scan läuft weiter", async () => {
    const t = { "a/docs/x.md": "x", "b/docs/y.md": "y", "b/docs/sub/z.md": "z" };
    const r = await scanSource(fakeSource(t, { failing: ["a/docs"] }), settings());
    expect(r.unreadable).toEqual(["a/docs"]);
    expect(r.files.map((f) => f.path).sort()).toEqual(["b/docs/sub/z.md", "b/docs/y.md"]);
    expect(r.state).toBe("ok");
  });

  it("Ordner Docs ohne Muster-Treffer neben docs meldet keine Kollision", async () => {
    const r = await scanSource(fakeSource({ "r/Docs/a.md": "1", "r/docs/b.md": "2" }), settings());
    expect(r.collisions).toEqual([]);
    expect(r.files.map((f) => f.path)).toEqual(["r/docs/b.md"]);
  });

  it("ungültige Muster stoppen den Scan nicht und werden gemeldet", async () => {
    const r = await scanSource(fakeSource({ "r/docs/a.md": "a" }), settings({ patterns: ["**", "**/docs"] }));
    expect(r.invalidPatterns).toEqual(["**"]);
    expect(r.files).toHaveLength(1);
  });

  it("ruft tick in jeder Iteration, auch bei übersprungenen Einträgen", async () => {
    let n = 0;
    await scanSource(fakeSource(tree), settings(), () => { n++; return Promise.resolve(); });
    // genau ein tick je gelesenem Eintrag, auch für node_modules und .claude (nie betreten)
    expect(n).toBe(16);
  });
});
