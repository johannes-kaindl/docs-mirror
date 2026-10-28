import { describe, expect, it } from "vitest";
import { parseManifest } from "../src/core/manifest";

const good = { path: "a/docs/x.md", srcSize: 10, srcMtime: 5, size: 10, mtime: 6, hash: "abc" };

describe("parseManifest", () => {
  it("übernimmt gültige Einträge", () => {
    expect(parseManifest({ "a/docs/x.md": good })).toEqual({ manifest: { "a/docs/x.md": good }, dropped: 0 });
  });

  it("verwirft Einträge ohne Hash oder mit negativer Größe, zählt sie, behält den Rest", () => {
    const { hash: _h, ...noHash } = good;
    const r = parseManifest({
      "ok.md": { ...good, path: "ok.md" },
      "nohash.md": { ...noHash, path: "nohash.md" },
      "neg.md": { ...good, path: "neg.md", size: -1 },
      "nan.md": { ...good, path: "nan.md", srcMtime: Number.NaN },
      "str.md": "kaputt",
    });
    expect(Object.keys(r.manifest)).toEqual(["ok.md"]);
    expect(r.dropped).toBe(4);
  });

  it("verwirft einen Eintrag, dessen Pfad nicht zum Schlüssel passt", () => {
    const r = parseManifest({ "b.md": good });
    expect(r.manifest).toEqual({});
    expect(r.dropped).toBe(1);
  });

  it("liefert für Nicht-Objekte ein leeres Manifest ohne Wurf", () => {
    for (const raw of ["x", null, undefined, 3, []]) {
      expect(parseManifest(raw)).toEqual({ manifest: {}, dropped: 0 });
    }
  });

  it("verwirft unsichere oder nicht-NFC-Pfade und zählt sie", () => {
    const bad = ["../x.md", "/abs/x.md", "a\\b.md", "a/./b.md", "Ü.md".normalize("NFD"), "__proto__"];
    const raw: Record<string, unknown> = { "ok.md": { ...good, path: "ok.md" } };
    for (const p of bad) Object.defineProperty(raw, p, { value: { ...good, path: p }, enumerable: true });
    const r = parseManifest(raw);
    expect(Object.keys(r.manifest)).toEqual(["ok.md"]);
    expect(r.dropped).toBe(bad.length);
  });
});
