import { afterEach, describe, expect, it } from "vitest";
import { Modal } from "./vendor/kit/obsidian-mock";
import { setLang } from "../src/vendor/kit/i18n";
import { confirmRun } from "../src/obsidian/confirm-run";
import type { Plan, PlanClass, PlanItem } from "../src/core/plan";

const src = { path: "x", size: 1, mtime: 1 };
const item = (path: string, cls: PlanClass, extra: Partial<PlanItem> = {}): PlanItem => ({ path, cls, ...extra });
function plan(items: PlanItem[], over: Partial<Plan> = {}): Plan {
  const counts = { new: 0, changed: 0, unchanged: 0, delete: 0, "vault-modified": 0, conflict: 0, "vault-only": 0 } as Record<PlanClass, number>;
  for (const it of items) counts[it.cls]++;
  return { items, counts, totalBytes: 0, mirrorBytes: 1500, skipped: { symlinks: 0, tooBig: 0, otherType: 0 }, sourceState: "ok", unchanged: 0, unchecked: 0, forget: [], ...over } as Plan;
}
const modal = (): any => Modal.__last;
const paragraphs = (): string[] => modal().contentEl.querySelectorAll("p").map((p: any) => p.textContent);
const buttons = (): any[] => modal().contentEl.querySelectorAll("button").map((b: any) => b.__component);

afterEach(() => setLang("en"));

describe("confirmRun", () => {
  const items = [item("a", "new", { src }), item("b", "new", { src }), item("c", "delete"), item("d", "conflict", { src })];

  it("listet die Gründe mit ihren Sätzen und die Zahlen, ohne Nullzeilen", async () => {
    void confirmRun({} as never, ["first-run", "conflicts"], plan(items));
    const lines = paragraphs();
    expect(lines).toContain("First run: check the plan before anything is written.");
    expect(lines).toContain("Some files already exist in the vault and were not created by this plugin.");
    expect(lines).toContain("2 new files");
    expect(lines).toContain("1 file to delete");
    expect(lines).toContain("1 conflict");
    expect(lines).toContain("The vault would be 1.5 KB afterwards");
    expect(lines.some((l) => /changed file/.test(l))).toBe(false);
    expect(lines.some((l) => /edited in the vault/.test(l))).toBe(false);
    expect(modal().titleEl.textContent).toBe("Run the plan?");
  });

  it("Gründe stehen in der Reihenfolge des Vertrags", () => {
    void confirmRun({} as never, ["threshold", "settings-changed", "total-size"], plan(items));
    const lines = paragraphs();
    expect(lines.indexOf("This run deletes at least as many files as the threshold.")).toBeLessThan(lines.indexOf("Settings changed since the last run, or the state of this device is unknown."));
    expect(lines.indexOf("Settings changed since the last run, or the state of this device is unknown.")).toBeLessThan(lines.indexOf("The files to mirror exceed the total size limit."));
  });

  it("nennt die Zahl der zu überschreibenden Dateien nur, wenn welche angekreuzt sind", () => {
    void confirmRun({} as never, ["conflicts"], plan(items), 1);
    expect(paragraphs()).toContain("1 file in the vault will be overwritten with the source version.");
    void confirmRun({} as never, ["conflicts"], plan(items), 3);
    expect(paragraphs()).toContain("3 files in the vault will be overwritten with the source version.");
    void confirmRun({} as never, ["conflicts"], plan(items));
    expect(paragraphs().some((l) => /overwritten/.test(l))).toBe(false);
  });

  it("Bestätigen löst mit true, Abbrechen und Schließen mit false", async () => {
    const yes = confirmRun({} as never, ["first-run"], plan(items));
    const [cancelBtn, okBtn] = buttons();
    expect(okBtn.textValue).toBe("Run plan");
    expect(cancelBtn.textValue).toBe("Cancel");
    okBtn.clickCB();
    await expect(yes).resolves.toBe(true);

    const no = confirmRun({} as never, ["first-run"], plan(items));
    buttons()[0].clickCB();
    await expect(no).resolves.toBe(false);

    const esc = confirmRun({} as never, ["first-run"], plan(items));
    modal().close();
    await expect(esc).resolves.toBe(false);
  });

  it("Bestätigungsknopf ist destruktiv, sobald gelöscht oder überschrieben wird, sonst die Hauptaktion", () => {
    void confirmRun({} as never, ["first-run"], plan(items));
    expect(buttons()[1].destructiveSet).toBe(true);
    void confirmRun({} as never, ["first-run"], plan([item("a", "new", { src })]));
    expect(buttons()[1].destructiveSet).toBe(false);
    expect(buttons()[1].ctaSet).toBe(true);
    void confirmRun({} as never, ["conflicts"], plan([item("a", "conflict", { src })]), 1);
    expect(buttons()[1].destructiveSet).toBe(true);
  });

  it("M5: eine im Vault veränderte Datei, die der Lauf mit der Quellversion ersetzt, macht den Knopf destruktiv", () => {
    void confirmRun({} as never, ["first-run"], plan([item("a", "vault-modified", { src })]));
    expect(buttons()[1].destructiveSet).toBe(true);
  });

  it("DE: Titel, Gründe und Knöpfe auf Deutsch", () => {
    setLang("de");
    void confirmRun({} as never, ["total-size"], plan(items));
    expect(modal().titleEl.textContent).toBe("Plan ausführen?");
    expect(paragraphs()).toContain("Die zu spiegelnden Dateien überschreiten die Gesamtgrößen-Grenze.");
    expect(buttons()[1].textValue).toBe("Plan ausführen");
  });
});
