import { afterEach, describe, expect, it } from "vitest";
import { setLang } from "../src/vendor/kit/i18n";
import { DocsMirrorSettingTab, type SettingsHost } from "../src/obsidian/settings-tab";
import { DEFAULT_SETTINGS, validateRoot, type DocsMirrorSettings } from "../src/core/settings";

interface FakeHost extends SettingsHost {
  saved: Partial<DocsMirrorSettings>[];
  rootCalls: string[];
}
function fakeHost(over: Partial<DocsMirrorSettings> = {}, root = ""): FakeHost {
  const h: FakeHost = {
    settings: { ...DEFAULT_SETTINGS, ...over },
    root,
    saved: [],
    rootCalls: [],
    updateSettings(patch) {
      h.saved.push(patch);
      h.settings = { ...h.settings, ...patch };
      return Promise.resolve();
    },
    setRoot(raw) {
      h.rootCalls.push(raw);
      const r = validateRoot(raw);
      if (r.ok) h.root = r.root;
      return r;
    },
  };
  return h;
}

const MB = 1024 * 1024;
const HINT = "The source root cannot be cleared; to stop syncing, turn off the start sync and do not run it.";
const tick = (): Promise<void> => new Promise((r) => setTimeout(r, 0));

function open(h: FakeHost = fakeHost()) {
  const tab = new DocsMirrorSettingTab({} as never, {} as never, h);
  tab.display();
  const rows = (tab.containerEl as any).querySelectorAll(".setting-item").map((el: any) => el.__setting);
  const row = (name: string): any => {
    const r = rows.find((s: any) => s.nameValue === name);
    if (!r) throw new Error(`row not found: ${name} in ${rows.map((s: any) => s.nameValue).join(" | ")}`);
    return r;
  };
  const note = (name: string): any => row(name).descEl.querySelectorAll(".dmr-field-note")[0];
  /** Tippt Text ins Feld und verlässt es. */
  const type = async (name: string, text: string): Promise<void> => {
    const c = row(name).components[0];
    c.setValue(text);
    c.inputEl.dispatchEvent({ type: "blur" });
    await tick();
  };
  return { tab, h, rows, row, note, type };
}

afterEach(() => setLang("en"));

describe("Settings-Tab: Aufbau", () => {
  it("Hilfe-Zeile zuerst, deklarativ und im Fallback", () => {
    const { tab, rows } = open();
    const defs = tab.getSettingDefinitions() as unknown as { name?: string }[];
    expect(defs[0].name).toBe("Help");
    expect(rows[0].nameValue).toBe("Help");
    expect(rows[0].components.map((c: any) => c.textValue ?? c.iconName)).toEqual(["Open documentation", "bug"]);
  });

  it("die Felder in der Reihenfolge der Spec, Schalter am Ende ohne Gefährliches davor", () => {
    const { rows } = open();
    expect(rows.map((r: any) => r.nameValue)).toEqual([
      "Help", "Source root", "Folder patterns", "Excluded names", "File types", "Largest file",
      "Total size limit", "Confirmation threshold", "Dot folders", "Sync when the vault starts",
    ]);
  });

  it("zeigt die gespeicherten Werte an", () => {
    const h = fakeHost({ patterns: ["**/docs", "x/y"], excludedNames: ["a", "b"], extensions: ["md"], maxFileBytes: 2 * MB, maxTotalBytes: 512 * MB, deleteThresholdFiles: 7 }, "/data/repos");
    const { row } = open(h);
    expect(row("Source root").components[0].getValue()).toBe("/data/repos");
    expect(row("Folder patterns").components[0].getValue()).toBe("**/docs\nx/y");
    expect(row("Excluded names").components[0].getValue()).toBe("a, b");
    expect(row("File types").components[0].getValue()).toBe("md");
    expect(row("Largest file").components[0].getValue()).toBe("2");
    expect(row("Total size limit").components[0].getValue()).toBe("512");
    expect(row("Confirmation threshold").components[0].getValue()).toBe("7");
  });

  it("Schalter: Werte stehen im Host, Änderung geht über setControlValue", async () => {
    const h = fakeHost({ syncOnStart: true });
    const { tab, row } = open(h);
    expect(tab.getControlValue("syncOnStart")).toBe(true);
    expect(tab.getControlValue("includeDotFolders")).toBe(false);
    expect(row("Sync when the vault starts").components[0].getValue()).toBe(true);
    expect(row("Dot folders").components[0].getValue()).toBe(false);
    await tab.setControlValue("includeDotFolders", true);
    await tab.setControlValue("syncOnStart", false);
    await tab.setControlValue("unbekannt", true);
    expect(h.saved).toEqual([{ includeDotFolders: true }, { syncOnStart: false }]);
  });
});

describe("Settings-Tab: Textfelder speichern bei blur, nicht je Tastendruck", () => {
  const NAMES = ["Source root", "Folder patterns", "Excluded names", "File types", "Largest file", "Total size limit", "Confirmation threshold"];

  it("kein Textfeld hängt an onChange (das wäre ein Speichern je Zeichen)", () => {
    const { row } = open();
    for (const n of NAMES) expect(row(n).components[0].onChangeCB, n).toBeNull();
  });

  it("Tippen ohne blur ändert nichts, blur speichert genau einmal", async () => {
    const { h, row, type } = open();
    const c = row("Excluded names").components[0];
    c.setValue("dist, tmp");
    expect(h.saved).toEqual([]);
    await type("Excluded names", "dist, tmp");
    expect(h.saved).toEqual([{ excludedNames: ["dist", "tmp"] }]);
  });

  it("blur ohne Änderung schreibt nichts", async () => {
    const { h, type } = open();
    await type("Excluded names", DEFAULT_SETTINGS.excludedNames.join(", "));
    await type("Largest file", "5");
    await type("Folder patterns", "**/docs");
    expect(h.saved).toEqual([]);
  });

  it("Muster: eine Zeile je Muster", async () => {
    const { h, type } = open();
    await type("Folder patterns", "**/docs\n  apps/*/doc  \n\n**/docs");
    expect(h.saved).toEqual([{ patterns: ["**/docs", "apps/*/doc"] }]);
  });

  it("Dateitypen: ohne Punkt, klein", async () => {
    const { h, type } = open();
    await type("File types", ".MD, png");
    expect(h.saved).toEqual([{ extensions: ["md", "png"] }]);
  });

  it("eine leere Liste wird abgelehnt: das Feld springt zurück und sagt warum", async () => {
    const { h, row, note, type } = open();
    await type("Folder patterns", "  \n ");
    expect(h.saved).toEqual([]);
    expect(row("Folder patterns").components[0].getValue()).toBe("**/docs");
    expect(note("Folder patterns").textContent).toBe("Enter at least one entry.");
    expect(note("Folder patterns").hasClass("is-error")).toBe(true);
  });

  it("Größen in Megabyte werden in Bytes gespeichert", async () => {
    const { h, type } = open();
    await type("Largest file", "2,5");
    await type("Total size limit", "100");
    expect(h.saved).toEqual([{ maxFileBytes: Math.round(2.5 * MB) }, { maxTotalBytes: 100 * MB }]);
  });

  it("Schwelle: ganze Zahl von 1 bis 1e9", async () => {
    const { h, type } = open();
    await type("Confirmation threshold", "1");
    await type("Confirmation threshold", "12");
    await type("Confirmation threshold", "1000000000");
    expect(h.saved).toEqual([{ deleteThresholdFiles: 1 }, { deleteThresholdFiles: 12 }, { deleteThresholdFiles: 1e9 }]);
  });

  it.each([
    ["Confirmation threshold", "0"], ["Confirmation threshold", "1000000001"], ["Largest file", "2000000"], ["Total size limit", "0.0000001"],
    ["Largest file", "abc"], ["Largest file", "0"], ["Largest file", "-1"], ["Largest file", ""],
    ["Total size limit", "x"], ["Confirmation threshold", "-1"], ["Confirmation threshold", "2.5"], ["Confirmation threshold", "viele"],
  ])("%s lehnt %j ab: nichts gespeichert, Feld springt zurück, Grund steht da", async (name, text) => {
    const { h, row, note, type } = open();
    const before = row(name).components[0].getValue();
    await type(name, text);
    expect(h.saved).toEqual([]);
    expect(row(name).components[0].getValue()).toBe(before);
    expect(note(name).textContent).toBe("Enter a valid number.");
    expect(note(name).hasClass("is-error")).toBe(true);
  });

  it("ein gültiger Wert nach einem abgelehnten räumt den Hinweis weg", async () => {
    const { note, type } = open();
    await type("Largest file", "abc");
    expect(note("Largest file").textContent).toBe("Enter a valid number.");
    await type("Largest file", "3");
    expect(note("Largest file").textContent).toBe("");
    expect(note("Largest file").hasClass("is-error")).toBe(false);
  });

  it("ungültige Muster stehen als Hinweis am Feld, das Speichern läuft trotzdem", async () => {
    const h = fakeHost({ patterns: ["**/docs", "!"] });
    const { note, type } = open(h);
    expect(note("Folder patterns").textContent).toBe("1 line could not be read and is ignored: !");
    expect(note("Folder patterns").hasClass("is-warning")).toBe(true);
    await type("Folder patterns", "**/docs");
    expect(h.saved).toEqual([{ patterns: ["**/docs"] }]);
    expect(note("Folder patterns").textContent).toBe("");
  });

  it("DE: Beschriftungen und Hinweise deutsch", async () => {
    setLang("de");
    const h = fakeHost({ patterns: ["**/docs", "!"] });
    const { row, note } = open(h);
    expect(row("Ordnermuster")).toBeTruthy();
    expect(note("Ordnermuster").textContent).toBe("1 Zeile ließ sich nicht lesen und wird ignoriert: !");
  });
});

describe("Settings-Tab: Wurzelfeld", () => {
  it("lehnt relativ ab und zeigt den Grund; die Wurzel bleibt, wie sie war", async () => {
    const { h, row, note, type } = open(fakeHost({}, "/alt"));
    await type("Source root", "repos/docs");
    expect(h.root).toBe("/alt");
    expect(note("Source root").textContent).toBe("The path must be absolute: it has to start with / or a drive letter.");
    expect(note("Source root").hasClass("is-error")).toBe(true);
    expect(row("Source root").components[0].getValue()).toBe("repos/docs");
  });

  it("lehnt ~ ab und zeigt den Grund", async () => {
    const { h, note, type } = open(fakeHost({}, "/alt"));
    await type("Source root", "~/repos");
    expect(h.root).toBe("/alt");
    expect(note("Source root").textContent).toBe("A path with ~ is not supported: write out the full path.");
    expect(note("Source root").hasClass("is-error")).toBe(true);
  });

  it("lehnt leer ab und zeigt den Grund", async () => {
    const { h, note, type } = open(fakeHost({}, "/alt"));
    await type("Source root", "   ");
    expect(h.root).toBe("/alt");
    expect(note("Source root").textContent).toBe("Enter the absolute path of the source folder.");
  });

  it("nimmt einen absoluten Pfad an, zeigt ihn bereinigt und räumt den Hinweis weg", async () => {
    const { h, row, note, type } = open();
    await type("Source root", "relativ");
    expect(note("Source root").textContent).not.toBe("");
    await type("Source root", "  /data/repos/  ");
    expect(h.root).toBe("/data/repos");
    expect(h.rootCalls).toEqual(["relativ", "  /data/repos/  "]);
    expect(row("Source root").components[0].getValue()).toBe("/data/repos");
    expect(note("Source root").textContent).toBe(HINT);
    expect(note("Source root").hasClass("is-error")).toBe(false);
  });

  it("sagt unter dem Feld, dass sich die Wurzel nicht leeren lässt", () => {
    const { note } = open(fakeHost({}, "/data/repos"));
    expect(note("Source root").textContent).toBe(HINT);
    expect(note("Source root").hasClass("is-error")).toBe(false);
    expect(note("Source root").hasClass("is-warning")).toBe(false);
  });

  it("warnt bei der Wurzel des Dateisystems, nimmt sie aber an", async () => {
    const { h, note, type } = open();
    await type("Source root", "/");
    expect(h.root).toBe("/");
    expect(note("Source root").textContent).toBe("This is the file system root: every folder on the disk is scanned.");
    expect(note("Source root").hasClass("is-warning")).toBe(true);
    expect(note("Source root").hasClass("is-error")).toBe(false);
  });

  it("zeigt die Warnung schon beim Öffnen, wenn die Wurzel „/“ ist", () => {
    const { note } = open(fakeHost({}, "/"));
    expect(note("Source root").textContent).toContain("file system root");
  });

  it("blur ohne Änderung ruft setRoot nicht auf", async () => {
    const { h, type } = open(fakeHost({}, "/data/repos"));
    await type("Source root", "/data/repos");
    expect(h.rootCalls).toEqual([]);
  });

  it("DE: Gründe auf Deutsch", async () => {
    setLang("de");
    const { note, type } = open();
    await type("Quellordner", "~/x");
    expect(note("Quellordner").textContent).toBe("Ein Pfad mit ~ wird nicht unterstützt: schreibe den vollständigen Pfad aus.");
  });
});
