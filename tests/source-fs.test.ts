import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync, utimesSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createSourcePort } from "../src/obsidian/source-fs";

let root: string;
beforeAll(() => {
  // Im Renderer hängt `require` am Fenster; im Test stellen wir es bereit.
  (globalThis as unknown as { window: { require: NodeRequire } }).window = { require: createRequire(import.meta.url) };
  root = mkdtempSync(join(tmpdir(), "dmr-src-"));
  mkdirSync(join(root, "sub"));
  writeFileSync(join(root, "a.md"), "hallo");
  utimesSync(join(root, "a.md"), 1700000000, 1700000000);
  writeFileSync(join(root, "sub", "b.md"), "bb");
  symlinkSync(join(root, "sub"), join(root, "link"));
});
afterAll(() => { rmSync(root, { recursive: true, force: true }); });

describe("createSourcePort (Struktur, echtes Dateisystem)", () => {
  it("readdir meldet Datei, Ordner und Symlink als solche (lstat)", async () => {
    const port = createSourcePort(root);
    const byName = Object.fromEntries((await port.readdir("")).map((e) => [e.name, e]));
    expect(byName["a.md"]).toMatchObject({ kind: "file", size: 5, mtime: 1700000000000 });
    expect(byName["sub"].kind).toBe("dir");
    expect(byName["link"].kind).toBe("symlink");
  });

  it("readdir mit relativem Unterordner; fehlender Ordner wirft", async () => {
    const port = createSourcePort(root);
    expect((await port.readdir("sub")).map((e) => e.name)).toEqual(["b.md"]);
    await expect(port.readdir("gibts-nicht")).rejects.toThrow();
  });

  it("readFile liest die Bytes relativ zur Wurzel", async () => {
    const port = createSourcePort(root);
    expect(new TextDecoder().decode(await port.readFile("sub/b.md"))).toBe("bb");
  });
});
