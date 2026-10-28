import { ItemView, setIcon, type App, type WorkspaceLeaf } from "obsidian";
import { t } from "../i18n/strings";
import type { ViewModel } from "../core/view-model";
import { FOCUS_ATTR, renderPlan, type OverwriteSelection } from "./plan-view";

/** Der EINE Ansichtstyp des Plugins (UI-STANDARD §1). */
export const VIEW_TYPE_DOCS_MIRROR = "docs-mirror-view";

/** Schmaler Host-Vertrag (UI-STANDARD §4): lesende Getter und `void`-Aktionen, kein Rückkanal. Die Ansicht kennt weder
 *  Plugin noch Runner. */
export interface DocsMirrorHost {
  viewModel(): ViewModel;
  syncNow(): void;
  /** `"all"`: jeder überschreibbare Konflikt; sonst genau die angekreuzten Pfade. */
  runPlan(overwrite: ReadonlySet<string> | "all"): void;
  cancel(): void;
  openSettings(): void;
  /** Meldet sich an; der Rückgabewert meldet wieder ab. */
  onChange(cb: () => void): () => void;
}

/** Seitenleisten-Ansicht: Aktionszeile und Statuszeile bleiben stehen, nur der Körper wird bei jedem Rendern neu
 *  gebaut (Aufbau nach `KuroSidebarView`). Die Entscheidungen kommen fertig aus dem ViewModel. */
export class DocsMirrorView extends ItemView {
  private vm: ViewModel | null = null;
  private primaryBtn: HTMLButtonElement | null = null;
  private secondaryBtn: HTMLButtonElement | null = null;
  private statusEl: HTMLElement | null = null;
  private statusIconEl: HTMLElement | null = null;
  private statusTextEl: HTMLElement | null = null;
  private bodyEl: HTMLElement | null = null;
  private shownIcon = "";
  private unsubscribe: (() => void) | null = null;
  private readonly openState = new Map<string, boolean>();
  private readonly overwrite: OverwriteSelection = { all: false, paths: new Set() };

  constructor(leaf: WorkspaceLeaf, private readonly host: DocsMirrorHost) {
    super(leaf);
  }

  getViewType(): string { return VIEW_TYPE_DOCS_MIRROR; }
  getDisplayText(): string { return t("view.title"); }
  getIcon(): string { return "folder-sync"; }

  onOpen(): Promise<void> {
    this.contentEl.empty();
    const root = this.contentEl.createDiv({ cls: "dmr-view" });

    // Aktionszeile: nie vom Inhalt verdeckt (Körper scrollt darunter, nicht darüber).
    const actions = root.createDiv({ cls: "dmr-actions" });
    this.primaryBtn = actions.createEl("button", { cls: "dmr-primary" });
    this.primaryBtn.addEventListener("click", () => { this.onPrimary(); });
    this.secondaryBtn = actions.createEl("button", { cls: "dmr-secondary" });
    this.secondaryBtn.addEventListener("click", () => { this.host.syncNow(); });

    this.statusEl = root.createDiv({ cls: "dmr-status", attr: { role: "status" } });
    this.statusIconEl = this.statusEl.createSpan({ cls: "dmr-status-icon" });
    this.statusTextEl = this.statusEl.createSpan({ cls: "dmr-status-text" });
    this.bodyEl = root.createDiv({ cls: "dmr-body" });

    this.unsubscribe = this.host.onChange(() => { this.render(); });
    this.render();
    return Promise.resolve();
  }

  onClose(): Promise<void> {
    this.unsubscribe?.();
    this.unsubscribe = null;
    this.contentEl.empty();
    this.primaryBtn = this.secondaryBtn = this.statusEl = this.statusIconEl = this.statusTextEl = this.bodyEl = null;
    return Promise.resolve();
  }

  /** Zeichnet aus dem ViewModel neu: Aktionszeile und Status werden an Ort und Stelle nachgezogen, der Körper ist neu. */
  render(): void {
    if (!this.primaryBtn || !this.secondaryBtn || !this.statusEl || !this.statusIconEl || !this.statusTextEl || !this.bodyEl) return;
    const vm = this.host.viewModel();
    this.vm = vm;
    if (!vm.hasPlan) this.resetOverwrite();
    else this.pruneOverwrite(vm);

    this.primaryBtn.setText(vm.primaryLabel);
    this.primaryBtn.toggleClass("mod-warning", vm.primary === "cancel");
    this.primaryBtn.toggleClass("mod-cta", vm.primary !== "cancel");
    this.secondaryBtn.setText(t("view.syncNow"));
    this.secondaryBtn.toggleClass("dmr-hidden", vm.secondary === null);

    // Zweiter Kanal neben Farbe: Icon-Form UND Text; der Zustand steht zusätzlich als Klasse und aria-label.
    this.statusEl.className = `dmr-status ${vm.statusClass}`;
    this.statusEl.setAttribute("aria-label", vm.statusAria);
    if (this.shownIcon !== vm.statusIcon) {
      this.statusIconEl.empty();
      setIcon(this.statusIconEl, vm.statusIcon);
      this.shownIcon = vm.statusIcon;
    }
    this.statusTextEl.setText(vm.progressText === null ? vm.statusText : `${vm.statusText} · ${vm.progressText}`);

    // Der Neuaufbau zerstört das fokussierte Element: Schlüssel merken, danach das neue Gegenstück fokussieren.
    // Nur wenn der Fokus vorher im Körper lag; wer woanders tippt, wird nie hierher gezogen.
    const focusKey = this.focusKeyIn(this.bodyEl);
    this.bodyEl.empty();
    this.renderBody(this.bodyEl, vm);
    if (focusKey !== null) {
      const next = Array.from(this.bodyEl.querySelectorAll<HTMLElement>(".dmr-focusable")).find((el) => el.getAttribute(FOCUS_ATTR) === focusKey);
      next?.focus({ preventScroll: true });
    }
  }

  private focusKeyIn(body: HTMLElement): string | null {
    const active = (body.ownerDocument as Document | undefined)?.activeElement ?? null;
    if (active === null) return null;
    const hit = Array.from(body.querySelectorAll(".dmr-focusable")).find((el) => el === active);
    return hit?.getAttribute(FOCUS_ATTR) ?? null;
  }

  private onPrimary(): void {
    switch (this.vm?.primary) {
      case "sync": this.host.syncNow(); break;
      case "cancel": this.host.cancel(); break;
      case "settings": this.host.openSettings(); break;
      case "execute": this.host.runPlan(this.overwrite.all ? "all" : new Set(this.overwrite.paths)); break;
      default: break;
    }
  }

  private resetOverwrite(): void {
    this.overwrite.all = false;
    this.overwrite.paths.clear();
    this.openState.clear();
  }

  /** Eine Auswahl überlebt das Rendern, aber nur für Zeilen, die der aktuelle Plan noch als überschreibbar zeigt. */
  private pruneOverwrite(vm: ViewModel): void {
    const live = new Set(vm.groups.flatMap((g) => g.rows.filter((r) => r.overwritable).map((r) => r.path)));
    for (const p of [...this.overwrite.paths]) if (!live.has(p)) this.overwrite.paths.delete(p);
  }

  private renderBody(body: HTMLElement, vm: ViewModel): void {
    if (vm.status === "not-configured") {
      // Genau ein Weg weiter: der Primärknopf der Aktionszeile öffnet die Einstellungen.
      const empty = body.createDiv({ cls: "dmr-empty" });
      empty.createEl("h3", { cls: "dmr-empty-heading", text: t("view.notConfigured") });
      empty.createDiv({ cls: "dmr-empty-desc", text: t("view.notConfiguredDesc") });
      return;
    }
    if (vm.hasPlan) renderPlan(body, vm, this.overwrite, this.openState);
    if (vm.lastRun !== null) this.renderResult(body, vm);
  }

  private renderResult(body: HTMLElement, vm: ViewModel): void {
    const card = body.createDiv({ cls: "dmr-card dmr-result" });
    card.createEl("h3", { cls: "dmr-card-heading", text: vm.lastRun ?? "" });
    if (vm.lastError !== null) card.createDiv({ cls: "dmr-error", text: vm.lastError });
    const list = card.createDiv({ cls: "dmr-counters" });
    for (const row of vm.counterRows) {
      const el = list.createDiv({ cls: "dmr-counter" });
      el.createSpan({ cls: "dmr-counter-label", text: row.label });
      el.createSpan({ cls: "dmr-counter-value", text: String(row.value) });
    }
  }
}

/** Öffnet die Ansicht und macht sie SICHTBAR. `revealLeaf` ist kein Beiwerk: ohne den Aufruf entsteht die Ansicht bei
 *  eingeklappter Seitenleiste mit 0×0 Pixeln, der Befehl meldet Erfolg, und der Klick tut sichtbar nichts. */
export async function activateView(app: App): Promise<void> {
  const existing = app.workspace.getLeavesOfType(VIEW_TYPE_DOCS_MIRROR)[0];
  if (existing) {
    await app.workspace.revealLeaf(existing);
    return;
  }
  const leaf = app.workspace.getRightLeaf(false);
  if (!leaf) return;
  await leaf.setViewState({ type: VIEW_TYPE_DOCS_MIRROR, active: true });
  await app.workspace.revealLeaf(leaf);
}
