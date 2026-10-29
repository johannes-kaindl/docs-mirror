import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { locateVault } from "../src/core/vault-location";
import { resolveRealPaths } from "../src/obsidian/real-paths";

describe("resolveRealPaths (injiziertes realpathSync)", () => {
  it("löst beide Pfade auf", () => {
    const map: Record<string, string> = { "/link/root": "/real/root", "/link/vault": "/real/root/mirror" };
    const r = resolveRealPaths("/link/root", "/link/vault", { realpathSync: (p) => map[p] ?? p });
    expect(r).toEqual({ root: "/real/root", vaultBase: "/real/root/mirror" });
  });
  it("wirft realpath (ENOENT), bleibt der Pfad unverändert und der Host wirft nicht", () => {
    const boom = (): never => { throw Object.assign(new Error("ENOENT"), { code: "ENOENT" }); };
    expect(resolveRealPaths("/gone", "/also-gone", { realpathSync: boom })).toEqual({ root: "/gone", vaultBase: "/also-gone" });
  });
  it("unbekannter Basispfad (null oder leer) wird nicht aufgelöst", () => {
    const calls: string[] = [];
    const fsLike = { realpathSync: (p: string) => { calls.push(p); return p; } };
    expect(resolveRealPaths("/r", null, fsLike).vaultBase).toBeNull();
    expect(resolveRealPaths("/r", "", fsLike).vaultBase).toBe("");
    expect(calls).toEqual(["/r", "/r"]);
  });
});

describe("resolveRealPaths mit echtem Dateisystem und Symlinks", () => {
  let tmp = "";
  let real = "";
  let vault = "";
  beforeEach(() => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), "dmr-rp-"));
    real = path.join(tmp, "repos");
    vault = path.join(real, "mirror");
    fs.mkdirSync(vault, { recursive: true });
  });
  afterEach(() => { fs.rmSync(tmp, { recursive: true, force: true }); });
  const resolve = (root: string, base: string) => {
    const r = resolveRealPaths(root, base, fs);
    return locateVault(r.root, r.vaultBase);
  };

  it("Vault-Basispfad über einen Symlink unter der Wurzel → below (Kontrolle: als Text outside)", () => {
    const link = path.join(real, "viaLink");
    fs.symlinkSync(vault, link);
    expect(locateVault(real, link)).toEqual({ kind: "below", rel: "viaLink" }); // Text: falscher Name, der Scan schließt "mirror" nicht aus
    expect(resolve(real, link)).toEqual({ kind: "below", rel: "mirror" });
    // Symlink außerhalb der Wurzel, Ziel innerhalb
    const outer = path.join(tmp, "outer-link");
    fs.symlinkSync(vault, outer);
    expect(locateVault(real, outer)).toEqual({ kind: "outside" });
    expect(resolve(real, outer)).toEqual({ kind: "below", rel: "mirror" });
  });

  it("Wurzel selbst über einen Symlink → Vault wird ausgeschlossen", () => {
    const rootLink = path.join(tmp, "root-link");
    fs.symlinkSync(real, rootLink);
    expect(locateVault(rootLink, vault)).toEqual({ kind: "outside" });
    expect(resolve(rootLink, vault)).toEqual({ kind: "below", rel: "mirror" });
  });

  it("Wurzel und Vault sind dasselbe Verzeichnis über verschiedene Symlinks → same", () => {
    const a = path.join(tmp, "a");
    const b = path.join(tmp, "b");
    fs.symlinkSync(vault, a);
    fs.symlinkSync(vault, b);
    expect(locateVault(a, b)).toEqual({ kind: "outside" });
    expect(resolve(a, b)).toEqual({ kind: "same" });
  });

  it("fehlende Wurzel → kein Wurf, Pfad bleibt", () => {
    const missing = path.join(tmp, "nope");
    expect(resolveRealPaths(missing, vault, fs).root).toBe(missing);
  });
});
