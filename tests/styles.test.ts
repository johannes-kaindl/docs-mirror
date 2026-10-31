import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

/** Prüft die FORM von `styles.css` (Regel und Eigenschaft stehen da), nicht die Wirkung im Layout: die Wirkung braucht
 *  ein Obsidian-Fenster und steht in `docs/SMOKE.md` als ungemessen (CORE-TEST-10). */
const CSS = readFileSync(new URL("../styles.css", import.meta.url), "utf8").replace(/\/\*[\s\S]*?\*\//g, "");

function rule(selector: string): string {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\~]/g, "\\$&");
  const m = new RegExp(`(?:^|})\\s*${escaped}\\s*\\{([^}]*)\\}`).exec(CSS);
  if (m === null) throw new Error(`Regel nicht gefunden: ${selector}`);
  return m[1];
}

describe("styles.css (Form)", () => {
  it("Kosmetik 1: das Statuswort bricht an Wortgrenzen, nicht mitten im Wort; die Zeile darf umbrechen", () => {
    const text = rule(".dmr-status-text");
    expect(text).toContain("overflow-wrap: break-word");
    expect(text).not.toContain("anywhere");
    expect(text).toContain("min-width: 0");
    expect(rule(".dmr-status")).toContain("flex-wrap: wrap");
  });

  it("Kosmetik 2: Zeilen stehen auf einer Linie (Mitte, nicht Grundlinie); die Notiz unter einem Kästchen ist eingerückt", () => {
    const row = rule(".dmr-row");
    expect(row).toContain("align-items: center");
    expect(row).not.toContain("baseline");
    expect(rule(".dmr-overwrite ~ .dmr-row-note")).toMatch(/margin-left:\s*calc\(var\(--checkbox-size\)/);
    expect(rule(".dmr-row-note")).toContain("flex: 1 1 100%");
  });

  it("Kosmetik 4: die Zeitangabe der Ergebniskarte bricht nicht mitten in der Angabe", () => {
    const time = rule(".dmr-last-time");
    expect(time).toContain("white-space: nowrap");
    expect(time).toContain("display: inline-block");
  });

  it("Regeln des Repos: kein !important, kein :has()", () => {
    expect(CSS).not.toContain("!important");
    expect(CSS).not.toContain(":has(");
  });
});
