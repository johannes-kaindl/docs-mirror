import { describe, expect, it } from "vitest";
import { locateVault } from "../src/core/vault-location";

describe("locateVault", () => {
  it("Vault unterhalb der Wurzel → rel ab der Wurzel", () => {
    expect(locateVault("/data/repos", "/data/repos/mirror/vault")).toEqual({ kind: "below", rel: "mirror/vault" });
    expect(locateVault("/", "/vault")).toEqual({ kind: "below", rel: "vault" });
  });

  it("ein absoluter Basispfad gleicht keinem relativen: kein Kit-canonVaultDir (führender Schrägstrich bleibt, 2026-11-12)", () => {
    expect(locateVault("/Users/a", "Users/a/v")).toEqual({ kind: "outside" });
    expect(locateVault("/", "/Users/a/vault")).toEqual({ kind: "below", rel: "Users/a/vault" });
  });

  it("Vault gleich Wurzel (Schreibweise, Schrägstrich am Ende, Rückstrich, NFD) → same", () => {
    expect(locateVault("/data/repos", "/data/repos")).toEqual({ kind: "same" });
    expect(locateVault("/data/repos", "/DATA/Repos/")).toEqual({ kind: "same" });
    expect(locateVault("C:\\data\\repos", "c:/data/repos")).toEqual({ kind: "same" });
    expect(locateVault(`/d/${"ü".normalize("NFD")}`, "/d/ü")).toEqual({ kind: "same" });
  });

  it("Segmentgrenze: /data/repos2 liegt nicht unter /data/repos; Elternordner der Wurzel ist outside", () => {
    expect(locateVault("/data/repos", "/data/repos2/v")).toEqual({ kind: "outside" });
    expect(locateVault("/data/repos/sub", "/data/repos")).toEqual({ kind: "outside" });
  });

  it("unbekannter Basispfad → outside", () => {
    expect(locateVault("/data/repos", null)).toEqual({ kind: "outside" });
    expect(locateVault("/data/repos", "")).toEqual({ kind: "outside" });
  });

  it("eine längenverändernde Faltung (ß/ss) verschiebt rel nicht", () => {
    expect(locateVault("/d/Straße", "/d/Straße/v")).toEqual({ kind: "below", rel: "v" });
  });
});
