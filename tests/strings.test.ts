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
});
