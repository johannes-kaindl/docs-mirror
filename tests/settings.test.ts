import { describe, expect, it } from "vitest";
import { DEFAULT_SETTINGS, loadSettings, parseList, validateRoot } from "../src/core/settings";

describe("DEFAULT_SETTINGS", () => {
  it("trägt die Standardwerte aus der Spec", () => {
    expect(DEFAULT_SETTINGS).toEqual({
      patterns: ["**/docs"],
      excludedNames: ["node_modules", ".git", "dist", "build", "__pycache__", ".venv"],
      extensions: ["md", "canvas", "base", "png", "jpg", "jpeg", "gif", "svg", "webp", "pdf"],
      includeDotFolders: false,
      maxFileBytes: 5 * 1024 * 1024,
      maxTotalBytes: 1024 * 1024 * 1024,
      deleteThresholdFiles: 20,
      deleteThresholdPercent: 20,
      syncOnStart: false,
    });
  });
});

describe("loadSettings", () => {
  it("undefined liefert die Standardwerte", () => {
    expect(loadSettings(undefined)).toEqual(DEFAULT_SETTINGS);
  });

  it("falscher Typ setzt nur dieses Feld zurück", () => {
    const s = loadSettings({ maxFileBytes: "5", syncOnStart: true });
    expect(s.maxFileBytes).toBe(DEFAULT_SETTINGS.maxFileBytes);
    expect(s.syncOnStart).toBe(true);
  });

  it("leere Liste fällt auf den Standard zurück", () => {
    expect(loadSettings({ extensions: [] }).extensions).toEqual(DEFAULT_SETTINGS.extensions);
    expect(loadSettings({ patterns: ["", "  "] }).patterns).toEqual(DEFAULT_SETTINGS.patterns);
  });

  it("negative und nicht endliche Zahlen fallen auf den Standard zurück", () => {
    const s = loadSettings({ maxFileBytes: -1, maxTotalBytes: Number.NaN, deleteThresholdFiles: -3, deleteThresholdPercent: 250 });
    expect(s.maxFileBytes).toBe(DEFAULT_SETTINGS.maxFileBytes);
    expect(s.maxTotalBytes).toBe(DEFAULT_SETTINGS.maxTotalBytes);
    expect(s.deleteThresholdFiles).toBe(DEFAULT_SETTINGS.deleteThresholdFiles);
    expect(s.deleteThresholdPercent).toBe(DEFAULT_SETTINGS.deleteThresholdPercent);
  });

  it("gültige eigene Werte bleiben", () => {
    const s = loadSettings({ patterns: ["a/docs"], maxFileBytes: 10, includeDotFolders: true, deleteThresholdFiles: 0 });
    expect(s.patterns).toEqual(["a/docs"]);
    expect(s.maxFileBytes).toBe(10);
    expect(s.includeDotFolders).toBe(true);
    expect(s.deleteThresholdFiles).toBe(0);
  });

  it("Listen mit Nicht-Strings werden gefiltert", () => {
    expect(loadSettings({ extensions: ["md", 3, null, " pdf "] }).extensions).toEqual(["md", "pdf"]);
  });

  it("teilt keine Referenzen mit den Standardwerten", () => {
    const s = loadSettings(undefined);
    s.patterns.push("x");
    expect(DEFAULT_SETTINGS.patterns).toEqual(["**/docs"]);
  });
});

describe("parseList", () => {
  it("trennt an Zeilen und Kommas, trimmt, entfernt Leeres und Doppeltes", () => {
    expect(parseList(" a, b\n\nc ,a\r\n d ")).toEqual(["a", "b", "c", "d"]);
  });
  it("leerer Text liefert eine leere Liste", () => {
    expect(parseList("  \n ,")).toEqual([]);
  });
});

describe("validateRoot", () => {
  it("leer", () => {
    expect(validateRoot("")).toEqual({ ok: false, problem: "empty" });
    expect(validateRoot("   ")).toEqual({ ok: false, problem: "empty" });
  });
  it("relativ", () => {
    expect(validateRoot("repos")).toEqual({ ok: false, problem: "relative" });
    expect(validateRoot("./repos")).toEqual({ ok: false, problem: "relative" });
  });
  it("Tilde", () => {
    expect(validateRoot("~/x")).toEqual({ ok: false, problem: "tilde" });
    expect(validateRoot("~")).toEqual({ ok: false, problem: "tilde" });
  });
  it("absolut: trimmt und entfernt den Schrägstrich am Ende", () => {
    expect(validateRoot("/a/b/")).toEqual({ ok: true, root: "/a/b" });
    expect(validateRoot("  /a/b//  ")).toEqual({ ok: true, root: "/a/b" });
  });
  it("Leerzeichen im Pfad sind erlaubt", () => {
    expect(validateRoot("/a b")).toEqual({ ok: true, root: "/a b" });
  });
  it("Laufwerksbuchstabe gilt als absolut", () => {
    expect(validateRoot("C:\\Users\\x\\")).toEqual({ ok: true, root: "C:\\Users\\x" });
    expect(validateRoot("D:/repos/")).toEqual({ ok: true, root: "D:/repos" });
  });
});
