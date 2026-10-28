import { afterEach, describe, expect, it } from "vitest";
import { setLang } from "../src/vendor/kit/i18n";
import { STRINGS, t, tn } from "../src/i18n/strings";

const placeholders = (s: string): string[] => (s.match(/\{\w+\}/g) ?? []).sort();

describe("strings", () => {
  afterEach(() => setLang("en"));

  it("EN und DE haben dieselben Schlüssel", () => {
    expect(Object.keys(STRINGS.de).sort()).toEqual(Object.keys(STRINGS.en).sort());
  });

  it("kein DE-Wert ist leer", () => {
    for (const [key, value] of Object.entries(STRINGS.de)) {
      expect(value.trim(), key).not.toBe("");
    }
  });

  it("kein EN-Wert ist leer", () => {
    for (const [key, value] of Object.entries(STRINGS.en)) {
      expect(value.trim(), key).not.toBe("");
    }
  });

  it("jede Zählform .one hat ein .many in beiden Sprachen", () => {
    for (const lang of ["en", "de"] as const) {
      for (const key of Object.keys(STRINGS[lang])) {
        if (key.endsWith(".one")) {
          const many = key.replace(/\.one$/, ".many");
          expect(STRINGS[lang], `${lang}: ${many}`).toHaveProperty([many]);
        }
      }
    }
  });

  it("Platzhalter stimmen zwischen EN und DE überein", () => {
    for (const [key, en] of Object.entries(STRINGS.en)) {
      expect(placeholders(STRINGS.de[key as keyof typeof STRINGS.de]), key).toEqual(placeholders(en));
    }
  });

  it("kein Text nennt 'Obsidian plugin'", () => {
    for (const en of Object.values(STRINGS.en)) {
      expect(en).not.toMatch(/obsidian plugin/i);
    }
  });

  it("DE nutzt echte Umlaute, keine ASCII-Ersatzschreibung", () => {
    const ascii = /\b(fuer|ueber|waehl|Aender|Loesch|koenn|gross|Groess|Schluessel|Bestaetig|laeuft|gemaess|waere|Ueber)/i;
    for (const [key, de] of Object.entries(STRINGS.de)) {
      expect(de, key).not.toMatch(ascii);
    }
  });

  it("t liest die Sprache aus dem Kit und fällt auf EN zurück", () => {
    expect(t("view.syncNow")).toBe("Sync now");
    setLang("de");
    expect(t("view.syncNow")).toBe("Jetzt synchronisieren");
  });

  it("t ersetzt benannte Platzhalter", () => {
    expect(t("plan.more", { n: 4 })).toBe("… and 4 more");
    setLang("de");
    expect(t("plan.more", { n: 4 })).toBe("… und 4 weitere");
  });

  it("tn wählt .one bei genau 1 und sonst .many", () => {
    expect(tn("plan.new", 1)).toBe("1 new file");
    expect(tn("plan.new", 0)).toBe("0 new files");
    expect(tn("plan.new", 3)).toBe("3 new files");
    setLang("de");
    expect(tn("plan.new", 1)).toBe("1 neue Datei");
    expect(tn("plan.new", 3)).toBe("3 neue Dateien");
  });
  it("Begründungen je Plan-Grund gibt es in EN und DE, jede eigen", () => {
    const reasons = ["vault-missing", "type-change", "case-collision", "unreadable", "orphan-modified", "foreign"] as const;
    for (const lang of ["en", "de"] as const) {
      setLang(lang);
      const texts = reasons.map((r) => t(`plan.reason.${r}`));
      expect(new Set(texts).size, lang).toBe(reasons.length);
      for (const text of texts) expect(text.endsWith("."), `${lang}: ${text}`).toBe(true);
    }
    setLang("de");
    expect(t("plan.reason.orphan-modified")).toBe("Quelle gelöscht, im Vault verändert: bleibt liegen.");
  });

  it("nicht geprüft: Zählform mit Hinweis auf unlesbare Ordner", () => {
    expect(tn("plan.unchecked", 1)).toBe("Not checked: 1 file in an unreadable folder");
    expect(tn("plan.unchecked", 2)).toBe("Not checked: 2 files in unreadable folders");
    setLang("de");
    expect(tn("plan.unchecked", 3)).toBe("Nicht geprüft: 3 Dateien in unlesbaren Ordnern");
  });

  it("DE-Feinschliff aus dem Review: Gesamtgrößen-Grenze, vollständiger Einstellungs-Satz, glatte Vault-Zeile", () => {
    setLang("de");
    expect(t("guard.total-size")).toBe("Die zu spiegelnden Dateien überschreiten die Gesamtgrößen-Grenze.");
    expect(t("plan.hint.settings-changed")).toMatch(/^Die Einstellungen haben sich .*\.$/);
    expect(tn("plan.vault-modified", 1)).toBe("1 Datei im Vault verändert");
    expect(tn("plan.vault-modified", 4)).toBe("4 Dateien im Vault verändert");
  });

  it("Ordnermuster werden als Muster erklärt, nicht als Ausschluss", () => {
    expect(t("settings.patterns")).toBe("Folder patterns");
    expect(t("settings.patternsDesc")).not.toMatch(/skipped|ignore/i);
    setLang("de");
    expect(t("settings.patterns")).toBe("Ordnermuster");
  });
});
