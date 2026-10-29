import { tn, t } from "../i18n/strings";
import type { GroupRow, ViewGroup, ViewModel } from "../core/view-model";

/** Welche Konflikte der Mensch zum Überschreiben angekreuzt hat. `all` gilt für jeden überschreibbaren Konflikt des
 *  Plans, auch für die, die die Kappung nicht zeigt; dann sind die Kästchen gesetzt und gesperrt. */
export interface OverwriteSelection {
  all: boolean;
  paths: Set<string>;
}

/** Stabiler Schlüssel jedes Bedienelements im Körper (Klasse `dmr-focusable`): so findet die Ansicht den Fokus nach dem Neuaufbau wieder. */
export const FOCUS_ATTR = "data-dmr-focus";
/** Klasse der Gruppe, in der ein fokussierbares Element steht: Rückfall des Fokus, wenn das Element nach dem Neuaufbau fehlt. */
export const GROUP_ATTR = "data-dmr-group";

interface Box {
  path: string;
  input: HTMLInputElement;
}

/** Info-/Ergebnis-Karte nach der Blaupause (UI-STANDARD §8) mit einem nativen `<details>` je Gruppe. Die Funktion
 *  entscheidet nichts: alles Sichtbare kommt fertig aus dem ViewModel. */
export function renderPlan(parent: HTMLElement, vm: ViewModel, sel: OverwriteSelection, openState: Map<string, boolean> = new Map()): void {
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
  for (const g of vm.groups) renderGroup(card, g, sel, boxes, sync, openState);
  sync();
}

function renderGroup(card: HTMLElement, g: ViewGroup, sel: OverwriteSelection, boxes: Box[], sync: () => void, openState: Map<string, boolean>): void {
  const open = openState.get(g.cls) ?? g.open;
  const details = card.createEl("details", {
    cls: g.separate ? "dmr-group is-separate" : "dmr-group",
    attr: open ? { open: "" } : {},
  });
  // Was der Mensch auf- oder zuklappt, bleibt beim nächsten Rendern so.
  details.addEventListener("toggle", () => { openState.set(g.cls, details.open); });
  details.createEl("summary", { cls: "dmr-group-summary dmr-focusable", text: g.label, attr: { [FOCUS_ATTR]: `summary:${g.cls}`, [GROUP_ATTR]: g.cls } });
  if (g.hint !== null) details.createDiv({ cls: "dmr-hint", text: g.hint });

  if (g.rows.some((r) => r.overwritable)) {
    const bar = details.createDiv({ cls: "dmr-overwrite-bar" });
    bar.createEl("button", { cls: "dmr-focusable", text: t("view.overwriteAll"), attr: { [FOCUS_ATTR]: `all:${g.cls}`, [GROUP_ATTR]: g.cls } }).addEventListener("click", () => {
      sel.all = true;
      sync();
    });
    bar.createEl("button", { cls: "dmr-focusable", text: t("view.overwriteNone"), attr: { [FOCUS_ATTR]: `none:${g.cls}`, [GROUP_ATTR]: g.cls } }).addEventListener("click", () => {
      sel.all = false;
      sel.paths.clear();
      sync();
    });
  }

  const list = details.createDiv({ cls: "dmr-rows" });
  for (const row of g.rows) renderRow(list, row, sel, boxes, g.cls);
  if (g.more !== null) details.createDiv({ cls: "dmr-more", text: g.more });
}

function renderRow(list: HTMLElement, row: GroupRow, sel: OverwriteSelection, boxes: Box[], groupCls: string): void {
  const el = list.createDiv({ cls: "dmr-row" });
  if (row.overwritable) {
    const input = el.createEl("input", { cls: "dmr-overwrite dmr-focusable", attr: { type: "checkbox", "aria-label": `${t("view.overwrite")}: ${row.path}`, [FOCUS_ATTR]: `overwrite:${row.path}`, [GROUP_ATTR]: groupCls } });
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
