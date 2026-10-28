import { describe, expect, it } from "vitest";
import { settingsFingerprint } from "../src/core/fingerprint";
import { DEFAULT_SETTINGS, type DocsMirrorSettings } from "../src/core/settings";

const ROOT = "/repos";
const fp = (patch: Partial<DocsMirrorSettings> = {}, root = ROOT): string =>
  settingsFingerprint({ ...DEFAULT_SETTINGS, ...patch }, root);

describe("settingsFingerprint", () => {
  it("ist 64 Zeichen Hex und deterministisch", () => {
    expect(fp()).toMatch(/^[0-9a-f]{64}$/);
    expect(fp()).toBe(fp());
  });

  it("gleich bei umsortierten Listen", () => {
    expect(fp({ extensions: [...DEFAULT_SETTINGS.extensions].reverse() })).toBe(fp());
    expect(fp({ excludedNames: [...DEFAULT_SETTINGS.excludedNames].reverse() })).toBe(fp());
    expect(fp({ patterns: ["b", "a"] })).toBe(fp({ patterns: ["a", "b"] }));
  });

  it("verschieden bei geänderter Wurzel", () => {
    expect(fp({}, "/andere")).not.toBe(fp());
  });
  it("verschieden bei geändertem Muster", () => {
    expect(fp({ patterns: ["**/doc"] })).not.toBe(fp());
  });
  it("verschieden bei geänderten ausgeschlossenen Namen", () => {
    expect(fp({ excludedNames: ["node_modules"] })).not.toBe(fp());
  });
  it("verschieden bei geänderten Dateitypen", () => {
    expect(fp({ extensions: ["md"] })).not.toBe(fp());
  });
  it("verschieden bei geändertem maxFileBytes", () => {
    expect(fp({ maxFileBytes: 1 })).not.toBe(fp());
  });
  it("verschieden bei geändertem includeDotFolders", () => {
    expect(fp({ includeDotFolders: true })).not.toBe(fp());
  });

  it("gleich bei geänderter Schwelle, Gesamtgröße und Start-Schalter (ändern den Umfang nicht)", () => {
    expect(fp({ deleteThresholdFiles: 99 })).toBe(fp());
    expect(fp({ deleteThresholdPercent: 99 })).toBe(fp());
    expect(fp({ maxTotalBytes: 1 })).toBe(fp());
    expect(fp({ syncOnStart: true })).toBe(fp());
  });

  it("Feldgrenzen sind eindeutig (kein Zusammenschieben von Listenelementen)", () => {
    expect(fp({ patterns: ["a", "b"] })).not.toBe(fp({ patterns: ["a,b"] }));
  });
});
