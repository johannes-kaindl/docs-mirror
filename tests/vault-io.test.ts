import { describe, expect, it } from "vitest";
import type { App } from "obsidian";
import { createVaultPort } from "../src/obsidian/vault-io";
import { fakeAdapter } from "./helpers/fake-adapter";

const TEMP = ".obsidian/plugins/docs-mirror/tmp";
const enc = (s: string): Uint8Array => new TextEncoder().encode(s);
const dec = (b: Uint8Array): string => new TextDecoder().decode(b);

function setup(seed: Parameters<typeof fakeAdapter>[0] = {}) {
  const adapter = fakeAdapter(seed);
  const app = { vault: { adapter, configDir: ".obsidian" } } as unknown as App;
  return { adapter, port: createVaultPort(app, TEMP) };
}

describe("createVaultPort", () => {
  it("list: rekursiv, ohne configDir (der Ordner wird gar nicht erst betreten)", async () => {
    const { adapter, port } = setup({
      files: { "a/b/c.md": "c", "a/x.md": "x", "top.md": "t", ".obsidian/app.json": "{}", ".obsidian/plugins/p/main.js": "j" },
    });
    expect(await port.list()).toEqual(["a/b/c.md", "a/x.md", "top.md"]);
    expect(adapter.calls.filter((c) => c.startsWith("list:.obsidian"))).toEqual([]);
  });

  it("configDir wird gefaltet verglichen: `.OBSIDIAN/x` wird abgelehnt, list zeigt auch `.Obsidian/...` nicht", async () => {
    const { port } = setup({ files: { "a.md": "a", ".Obsidian/app.json": "{}" } });
    await port.writeTemp(".dmr-tmp-0", enc("x"), 1);
    await expect(port.replace(".dmr-tmp-0", ".OBSIDIAN/x")).rejects.toThrow(/inside/);
    await expect(port.mkdirp(".OBSIDIAN/sub")).rejects.toThrow();
    expect(await port.list()).toEqual(["a.md"]);
  });

  it("writeTemp legt das Temp-Verzeichnis an, übergibt mtime und Bytes; read/stat lösen den Temp-Namen auf", async () => {
    const { adapter, port } = setup({ folders: [".obsidian/plugins/docs-mirror"] });
    await port.writeTemp(".dmr-tmp-0", enc("hallo"), 1700000000123);
    const rec = adapter.files.get(`${TEMP}/.dmr-tmp-0`);
    expect(rec?.mtime).toBe(1700000000123);
    expect(dec(await port.read(".dmr-tmp-0"))).toBe("hallo");
    expect(await port.stat(".dmr-tmp-0")).toEqual({ kind: "file", size: 5, mtime: 1700000000123 });
  });

  it("writeTemp kopiert nur den Ausschnitt eines Uint8Array-Views", async () => {
    const { adapter, port } = setup();
    const big = enc("xxhalloxx");
    await port.writeTemp(".dmr-tmp-1", big.subarray(2, 7), 1);
    expect(dec(new Uint8Array(adapter.files.get(`${TEMP}/.dmr-tmp-1`)!.data))).toBe("hallo");
  });

  it("replace auf ein bestehendes Ziel wirft, das Ziel bleibt unverändert und es wird nie entfernt", async () => {
    const { adapter, port } = setup({ files: { "docs/a.md": "alt" } });
    await port.writeTemp(".dmr-tmp-0", enc("neu"), 2000);
    adapter.calls.length = 0;
    await expect(port.replace(".dmr-tmp-0", "docs/a.md")).rejects.toThrow();
    expect(adapter.calls.some((c) => c.startsWith("remove:"))).toBe(false);
    expect(dec(new Uint8Array(adapter.files.get("docs/a.md")!.data))).toBe("alt");
    expect(adapter.files.has(`${TEMP}/.dmr-tmp-0`)).toBe(true);
  });

  it("replace auf ein fehlendes Ziel: nur rename, kein remove, mtime bleibt", async () => {
    const { adapter, port } = setup({ folders: ["docs"] });
    await port.writeTemp(".dmr-tmp-0", enc("neu"), 2000);
    adapter.calls.length = 0;
    await port.replace(".dmr-tmp-0", "docs/n.md");
    expect(adapter.calls.some((c) => c.startsWith("remove:"))).toBe(false);
    expect(adapter.files.has("docs/n.md")).toBe(true);
  });

  it("replace auf einen Ordner wirft und lässt die Temp-Datei stehen", async () => {
    const { adapter, port } = setup({ folders: ["docs/a.md"] });
    await port.writeTemp(".dmr-tmp-0", enc("neu"), 2000);
    await expect(port.replace(".dmr-tmp-0", "docs/a.md")).rejects.toThrow();
    expect(adapter.files.has(`${TEMP}/.dmr-tmp-0`)).toBe(true);
  });

  it("M3: Zielpfade unter configDir werden abgelehnt (replace, mkdirp), nichts wird angefasst", async () => {
    const { adapter, port } = setup({ files: { ".obsidian/app.json": "{}" } });
    await port.writeTemp(".dmr-tmp-0", enc("x"), 1);
    adapter.calls.length = 0;
    for (const bad of [".obsidian", ".obsidian/app.json", ".obsidian/plugins/x/main.js"]) {
      await expect(port.replace(".dmr-tmp-0", bad), `replace ${bad}`).rejects.toThrow(/refusing|configDir|\.obsidian/);
      await expect(port.mkdirp(bad), `mkdirp ${bad}`).rejects.toThrow();
    }
    expect(adapter.calls).toEqual([]);
    expect(dec(new Uint8Array(adapter.files.get(".obsidian/app.json")!.data))).toBe("{}");
    // Ein Name, der nur mit dem Präfix beginnt, ist kein Unterpfad von configDir.
    await expect(port.mkdirp(".obsidianX/docs")).resolves.toBeUndefined();
  });

  it("remove: fehlende Datei ist kein Fehler, vorhandene geht; Temp-Namen werden aufgelöst", async () => {
    const { adapter, port } = setup({ files: { "a.md": "a" } });
    await port.remove("gibts-nicht.md");
    await port.remove("a.md");
    expect(adapter.files.has("a.md")).toBe(false);
    await port.writeTemp(".dmr-tmp-3", enc("t"), 1);
    await port.remove(".dmr-tmp-3");
    expect(adapter.files.has(`${TEMP}/.dmr-tmp-3`)).toBe(false);
  });

  it("stat: null bei fehlendem Pfad, folder bei Ordner", async () => {
    const { port } = setup({ files: { "d/a.md": "abc" } });
    expect(await port.stat("nix.md")).toBeNull();
    expect((await port.stat("d"))?.kind).toBe("folder");
    expect(await port.stat("d/a.md")).toMatchObject({ kind: "file", size: 3 });
  });

  it("mkdirp legt tief an", async () => {
    const { adapter, port } = setup();
    await port.mkdirp("a/b/c");
    expect(adapter.folders.has("a/b/c")).toBe(true);
  });

  it("removeIfEmpty: leeren Ordner entfernen (rmdir mit recursive, weil rmdir(…, false) auch leere Ordner ablehnt), nicht leeren stehen lassen", async () => {
    const { adapter, port } = setup({ files: { "voll/x.md": "x" }, folders: ["leer", "voll/unter"] });
    await port.removeIfEmpty("leer");
    expect(adapter.folders.has("leer")).toBe(false);
    await port.removeIfEmpty("voll");
    expect(adapter.folders.has("voll")).toBe(true);
    expect(adapter.files.has("voll/x.md")).toBe(true);
    await port.removeIfEmpty("gibts-nicht");
    // Ordner mit nur einem leeren Unterordner zählt als nicht leer (von innen nach außen räumt der Aufrufer)
    expect(adapter.folders.has("voll/unter")).toBe(true);
  });

  it("clearTemp räumt nur das Temp-Verzeichnis", async () => {
    const { adapter, port } = setup({
      files: { "a.md": "a", [`${TEMP}/.dmr-tmp-0`]: "t0", [`${TEMP}/.dmr-tmp-1`]: "t1", ".obsidian/plugins/docs-mirror/data.json": "{}" },
    });
    await port.clearTemp();
    expect([...adapter.files.keys()].sort()).toEqual([".obsidian/plugins/docs-mirror/data.json", "a.md"]);
  });

  it("clearTemp ohne Temp-Verzeichnis wirft nicht", async () => {
    const { port } = setup();
    await expect(port.clearTemp()).resolves.toBeUndefined();
  });

  it("tempDir: leer, ., .., absolut, mit ..-Segment oder außerhalb configDir wirft sofort", () => {
    const app = { vault: { adapter: fakeAdapter(), configDir: ".obsidian" } } as unknown as App;
    for (const bad of ["", ".", "..", "/x", "a/../b", ".obsidian/../x", "docs", ".obsidian", ".obsidianX/tmp", ".obsidian/./tmp"]) {
      expect(() => createVaultPort(app, bad), JSON.stringify(bad)).toThrow();
    }
    expect(() => createVaultPort(app, ".obsidian/plugins/x/tmp")).not.toThrow();
  });

  it("clearTemp löscht nur Dateien mit dem Temp-Präfix, Fremddateien im Temp-Ordner bleiben", async () => {
    const { adapter, port } = setup({ files: { [`${TEMP}/.dmr-tmp-0`]: "t", [`${TEMP}/fremd.md`]: "f", [`${TEMP}/notiz.dmr-tmp-1`]: "n" } });
    await port.clearTemp();
    expect([...adapter.files.keys()].sort()).toEqual([`${TEMP}/fremd.md`, `${TEMP}/notiz.dmr-tmp-1`]);
  });

  it("Pfadschranke: remove, stat, read, mkdirp, replace, removeIfEmpty, writeTemp lehnen unsichere Pfade ab", async () => {
    const { adapter, port } = setup({ files: { "a.md": "a" }, folders: ["leer"] });
    await port.writeTemp(".dmr-tmp-0", enc("x"), 1);
    const bad = ["../a.md", "/etc/x", "a\\b.md", "a\0b", "", "a/../../b", "./a.md", "a//b"];
    adapter.calls.length = 0;
    for (const b of bad) {
      const label = JSON.stringify(b);
      await expect(port.remove(b), `remove ${label}`).rejects.toThrow(/unsafe vault path/);
      await expect(port.stat(b), `stat ${label}`).rejects.toThrow();
      await expect(port.read(b), `read ${label}`).rejects.toThrow();
      await expect(port.mkdirp(b), `mkdirp ${label}`).rejects.toThrow();
      await expect(port.replace(".dmr-tmp-0", b), `replace ${label}`).rejects.toThrow();
      await expect(port.removeIfEmpty(b), `removeIfEmpty ${label}`).rejects.toThrow();
    }
    await expect(port.writeTemp("../x", enc("x"), 1)).rejects.toThrow();
    await expect(port.writeTemp("a/.dmr-tmp-0", enc("x"), 1)).rejects.toThrow();
    await expect(port.writeTemp("normal.md", enc("x"), 1)).rejects.toThrow();
    expect(adapter.calls).toEqual([]);
    expect(adapter.files.has("a.md")).toBe(true);
  });

  it("Wurzelpfad im Temp-Schema ist als Ziel abgelehnt (replace, mkdirp, removeIfEmpty)", async () => {
    const { port } = setup();
    await port.writeTemp(".dmr-tmp-0", enc("x"), 1);
    await expect(port.replace(".dmr-tmp-0", ".dmr-tmp-5")).rejects.toThrow(/reserved/);
    await expect(port.mkdirp(".dmr-tmp-5")).rejects.toThrow(/reserved/);
    await expect(port.removeIfEmpty(".dmr-tmp-5")).rejects.toThrow(/reserved/);
  });

  it("removeIfEmpty: Vault-Wurzel, configDir und alles darunter werden nie entfernt", async () => {
    const { adapter, port } = setup({ folders: [".obsidian/plugins/leer"] });
    for (const d of ["", ".", ".obsidian", ".obsidian/plugins/leer"]) {
      await expect(port.removeIfEmpty(d), JSON.stringify(d)).rejects.toThrow();
    }
    expect(adapter.calls.some((c) => c.startsWith("rmdir:"))).toBe(false);
  });

  it("removeIfEmpty: legt zwischen erstem und zweitem list jemand eine Datei an, bleibt Ordner und Datei", async () => {
    const { adapter, port } = setup({ folders: ["d"] });
    adapter.onList = (p, n) => { if (p === "d" && n === 1) adapter.files.set("d/neu.md", { data: new Uint8Array([1]), mtime: 1 }); };
    await port.removeIfEmpty("d");
    expect(adapter.folders.has("d")).toBe(true);
    expect(adapter.files.has("d/neu.md")).toBe(true);
    expect(adapter.calls.some((c) => c.startsWith("rmdir:"))).toBe(false);
  });

  it("removeIfEmpty: ein leerer Ordner kostet genau zwei list-Aufrufe und wird dann entfernt", async () => {
    const { adapter, port } = setup({ folders: ["d"] });
    await port.removeIfEmpty("d");
    expect(adapter.calls.filter((c) => c === "list:d")).toHaveLength(2);
    expect(adapter.folders.has("d")).toBe(false);
  });
});
