import { tn, t } from "../i18n/strings";
import type { GroupRow, ViewGroup, ViewModel } from "../core/view-model";

/** Welche Konflikte der Mensch zum Überschreiben angekreuzt hat. `all` gilt für jeden überschreibbaren Konflikt des
 *  Plans, auch für die, die die Kappung nicht zeigt; dann sind die Kästchen gesetzt und gesperrt. */
export interface OverwriteSelection {
  all: boolean;
  paths: Set<string>;
}

interface Box {
  path: string;
  input: HTMLInputElement;
}

/** Info-/Ergebnis-Karte nach der Blaupause (UI-STANDARD §8) mit einem nativen `<details>` je Gruppe. Die Funktion
 *  entscheidet nichts: alles Sichtbare kommt fertig aus dem ViewModel. */
export function renderPlan(parent: HTMLElement, vm: ViewModel, sel: OverwriteSelection): void {
  const card = parent.createDiv({ cls: "dmr-card dmr-plan" });
  card.createEl("h3", { cls: "dmr-card-heading", text: t("view.planHeading") });
  for (const reason of vm.reasons) card.createDiv({ cls: "dmr-reason", text: reason });
  for (const note of vm.notes) card.createDiv({ cls: "dmr-note", text: note });
  if (vm.unchanged > 0) card.createDiv({ cls: "dmr-note", text: tn("plan.unchanged", vm.unchanged) });

  const boxes: Box[] = [];
  const sync = (): void => {
    for (const b of boxes) {
      b.input.checked = sel.all || sel.paths.has(b.path);
      b.input.disabled = sel.all;
    }
  };
  for (const g of vm.groups) renderGroup(card, g, sel, boxes, sync);
  sync();
}

function renderGroup(card: HTMLElement, g: ViewGroup, sel: OverwriteSelection, boxes: Box[], sync: () => void): void {
  const details = card.createEl("details", {
    cls: g.separate ? "dmr-group is-separate" : "dmr-group",
    attr: g.open ? { open: "" } : {},
  });
  details.createEl("summary", { cls: "dmr-group-summary", text: g.label });
  if (g.hint !== null) details.createDiv({ cls: "dmr-hint", text: g.hint });

  if (g.rows.some((r) => r.overwritable)) {
    const bar = details.createDiv({ cls: "dmr-overwrite-bar" });
    bar.createEl("button", { text: t("view.overwriteAll") }).addEventListener("click", () => {
      sel.all = true;
      sync();
    });
    bar.createEl("button", { text: t("view.overwriteNone") }).addEventListener("click", () => {
      sel.all = false;
      sel.paths.clear();
      sync();
    });
  }

  const list = details.createDiv({ cls: "dmr-rows" });
  for (const row of g.rows) renderRow(list, row, sel, boxes);
  if (g.more !== null) details.createDiv({ cls: "dmr-more", text: g.more });
}

function renderRow(list: HTMLElement, row: GroupRow, sel: OverwriteSelection, boxes: Box[]): void {
  const el = list.createDiv({ cls: "dmr-row" });
  if (row.overwritable) {
    const input = el.createEl("input", { cls: "dmr-overwrite", attr: { type: "checkbox", "aria-label": `${t("view.overwrite")}: ${row.path}` } });
    input.addEventListener("change", () => {
      if (sel.all) return;
      if (input.checked) sel.paths.add(row.path);
      else sel.paths.delete(row.path);
    });
    boxes.push({ path: row.path, input });
  }
  el.createSpan({ cls: "dmr-path", text: row.path });
  if (row.note !== null) el.createDiv({ cls: "dmr-row-note", text: row.note });
}
