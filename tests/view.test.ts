import { afterEach, describe, expect, it, vi } from "vitest";
import { makeFakeApp, WorkspaceLeaf } from "./vendor/kit/obsidian-mock";
import { setLang } from "../src/vendor/kit/i18n";
import { activateView, DocsMirrorView, VIEW_TYPE_DOCS_MIRROR, type DocsMirrorHost } from "../src/obsidian/view";
import { buildViewModel, type ViewModelInput } from "../src/core/view-model";
import type { Plan, PlanClass, PlanItem } from "../src/core/plan";
import type { RunInfo } from "../src/core/run-info";

const src = { path: "x", size: 1, mtime: 1 };
const item = (path: string, cls: PlanClass, extra: Partial<PlanItem> = {}): PlanItem => ({ path, cls, ...extra });
function plan(items: PlanItem[]): Plan {
  const counts = { new: 0, changed: 0, unchanged: 0, delete: 0, "vault-modified": 0, conflict: 0, "vault-only": 0 } as Record<PlanClass, number>;
  for (const it of items) counts[it.cls]++;
  return { items, counts, totalBytes: 0, mirrorBytes: 0, skipped: { symlinks: 0, tooBig: 0, otherType: 0 }, sourceState: "ok", unchecked: 0, forget: [] };
}
const INFO: RunInfo = { at: 7, ok: true, counts: { created: 1, updated: 0, unchanged: 5, deleted: 0, overwritten: 0, skipped: 0, errors: 0 }, fingerprint: "f" };

function setup(initial: Partial<ViewModelInput> = {}) {
  let input: ViewModelInput = { status: "current", last: INFO, plan: null, progress: null, waiting: false, reasons: [], ...initial };
  const listeners = new Set<() => void>();
  const calls: unknown[][] = [];
  const host: DocsMirrorHost = {
    viewModel: () => buildViewModel(input, { time: (ms) => `T${ms}` }),
    syncNow: () => { calls.push(["sync"]); },
    runPlan: (o) => { calls.push(["run", o]); },
    cancel: () => { calls.push(["cancel"]); },
    openSettings: () => { calls.push(["settings"]); },
    onChange: (cb) => { listeners.add(cb); return () => { listeners.delete(cb); }; },
  };
  const view = new DocsMirrorView(new WorkspaceLeaf() as never, host);
  const set = (over: Partial<ViewModelInput>): void => { input = { ...input, ...over }; listeners.forEach((cb) => cb()); };
  return { view, set, calls, listeners, root: () => view.contentEl as any };
}
const all = (root: any, sel: string): any[] => root.querySelectorAll(sel);
/** Die Knöpfe der Aktionszeile, die der Mensch sieht (ohne die Auswahlknöpfe in den Gruppen). */
const visibleButtons = (root: any): any[] => all(all(root, ".dmr-actions")[0], "button").filter((b: any) => !b.hasClass("dmr-hidden"));

afterEach(() => setLang("en"));

describe("DocsMirrorView", () => {
  it("Typ, Titel und Symbol", () => {
    const { view } = setup();
    expect(view.getViewType()).toBe(VIEW_TYPE_DOCS_MIRROR);
    expect(view.getViewType()).toBe("docs-mirror-view");
    expect(view.getDisplayText()).toBe("Docs Mirror");
    expect(view.getIcon()).toBe("folder-sync");
  });

  it("Aufbau: Aktionszeile zuerst, dann Status, dann Körper", async () => {
    const { view, root } = setup();
    await view.onOpen();
    const top = root().children[0].children.map((c: any) => c.className);
    expect(top[0]).toBe("dmr-actions");
    expect(top[1]).toContain("dmr-status");
    expect(top[2]).toBe("dmr-body");
  });

  it("nicht eingerichtet: genau ein Weg weiter, der Primärknopf öffnet die Einstellungen; Empty-State sagt es mit einem Satz", async () => {
    const { view, root, calls } = setup({ status: "not-configured", last: null });
    await view.onOpen();
    const btns = visibleButtons(root());
    expect(btns).toHaveLength(1);
    expect(btns[0].textContent).toBe("Open settings");
    // Im ganzen Baum gibt es genau einen Knopf, der die Einstellungen öffnet (ein CTA, nicht zwei).
    expect(all(root(), "button").filter((b: any) => !b.hasClass("dmr-hidden") && b.textContent === "Open settings")).toHaveLength(1);
    expect(all(root(), ".dmr-body button")).toHaveLength(0);
    expect(all(root(), ".dmr-empty")).toHaveLength(1);
    expect(all(root(), ".dmr-empty-heading")[0].textContent).toBe("Not set up");
    expect(all(root(), ".dmr-empty-desc")[0].textContent).toBe("Set the source root in the settings first, then sync.");
    btns[0].click();
    expect(calls).toEqual([["settings"]]);
    expect(all(root(), ".dmr-card")).toHaveLength(0);
  });

  it("aktuell: „Jetzt synchronisieren“ als Hauptaktion (mod-cta), Ergebnis-Karte mit Zeit und Zählern, kein zweiter Knopf", async () => {
    const { view, root, calls } = setup();
    await view.onOpen();
    const btns = visibleButtons(root());
    expect(btns).toHaveLength(1);
    expect(btns[0].textContent).toBe("Sync now");
    expect(btns[0].hasClass("mod-cta")).toBe(true);
    expect(btns[0].hasClass("mod-warning")).toBe(false);
    expect(all(all(root(), ".dmr-result")[0], "h3")[0].textContent).toBe("Last run: T7");
    expect(all(root(), ".dmr-counter")).toHaveLength(7);
    btns[0].click();
    expect(calls).toEqual([["sync"]]);
  });

  it("Status: Form (Icon), Text, Klasse und aria-label gesetzt", async () => {
    const { view, root } = setup({ status: "unreachable" });
    await view.onOpen();
    const status = all(root(), ".dmr-status")[0];
    expect(status.hasClass("is-error")).toBe(true);
    expect(status.getAttribute("aria-label")).toBe("Status: Source unreachable");
    expect(status.getAttribute("role")).toBe("status");
    expect(all(root(), ".dmr-status-icon")[0].getAttribute("data-icon")).toBe("circle-x");
    expect(all(root(), ".dmr-status-text")[0].textContent).toBe("Source unreachable");
  });

  it("Lauf: „Abbrechen“ ist der einzige Knopf (mod-warning), Fortschritt steht im Statustext, Klasse is-checking", async () => {
    const { view, root, calls } = setup({ status: "running", progress: { done: 3, total: 9 } });
    await view.onOpen();
    const btns = visibleButtons(root());
    expect(btns).toHaveLength(1);
    expect(btns[0].textContent).toBe("Cancel");
    expect(btns[0].hasClass("mod-warning")).toBe(true);
    expect(btns[0].hasClass("mod-cta")).toBe(false);
    expect(all(root(), ".dmr-status")[0].hasClass("is-checking")).toBe(true);
    expect(all(root(), ".dmr-status-icon")[0].getAttribute("data-icon")).toBe("loader");
    expect(all(root(), ".dmr-status-text")[0].textContent).toBe("Running · 3 of 9 files");
    btns[0].click();
    expect(calls).toEqual([["cancel"]]);
  });

  it("Abbrechen erscheint nur im Lauf: nach dem Lauf ist der Knopf wieder „Jetzt synchronisieren“", async () => {
    const { view, root, set } = setup({ status: "running" });
    await view.onOpen();
    expect(all(root(), "button").some((b: any) => b.textContent === "Cancel")).toBe(true);
    set({ status: "current" });
    expect(all(root(), "button").some((b: any) => b.textContent === "Cancel")).toBe(false);
    expect(visibleButtons(root())[0].textContent).toBe("Sync now");
  });

  it("wartend: „Plan ausführen“ als Hauptaktion plus „Jetzt synchronisieren“, Plan-Karte mit Gründen", async () => {
    const items = [item("a/c.md", "conflict", { src }), item("a/d.md", "delete")];
    const { view, root, calls } = setup({ status: "waiting", waiting: true, plan: plan(items), reasons: ["first-run"] });
    await view.onOpen();
    const btns = visibleButtons(root());
    expect(btns.map((b: any) => b.textContent)).toEqual(["Run plan", "Sync now"]);
    expect(all(root(), ".dmr-plan")).toHaveLength(1);
    expect(all(root(), ".dmr-reason")[0].textContent).toBe("First run: check the plan before anything is written.");
    btns[1].click();
    expect(calls).toEqual([["sync"]]);
  });

  it("Plan ausführen reicht genau die angekreuzten Pfade weiter, ohne Klick eine leere Menge", async () => {
    const items = [item("a/c1.md", "conflict", { src }), item("a/c2.md", "conflict", { src }), item("a/c3.md", "conflict", { src, reason: "type-change" })];
    const { view, root, calls } = setup({ status: "waiting", waiting: true, plan: plan(items) });
    await view.onOpen();
    visibleButtons(root())[0].click();
    expect(calls.at(-1)).toEqual(["run", new Set()]);
    const box = all(root(), "input")[1];
    box.checked = true;
    box.dispatchEvent({ type: "change" });
    visibleButtons(root())[0].click();
    expect(calls.at(-1)).toEqual(["run", new Set(["a/c2.md"])]);
  });

  it("„Alle überschreiben“ wird als \"all\" weitergereicht", async () => {
    const items = [item("a/c1.md", "conflict", { src })];
    const { view, root, calls } = setup({ status: "waiting", waiting: true, plan: plan(items) });
    await view.onOpen();
    all(all(root(), ".dmr-overwrite-bar")[0], "button")[0].click();
    visibleButtons(root())[0].click();
    expect(calls.at(-1)).toEqual(["run", "all"]);
  });

  it("die Auswahl überlebt das Rendern, solange der Plan wartet, und fällt mit ihm", async () => {
    const items = [item("a/c1.md", "conflict", { src })];
    const { view, root, set, calls } = setup({ status: "waiting", waiting: true, plan: plan(items) });
    await view.onOpen();
    const box = all(root(), "input")[0];
    box.checked = true;
    box.dispatchEvent({ type: "change" });
    set({ progress: { done: 1, total: 2 } });
    expect(all(root(), "input")[0].checked).toBe(true);
    set({ status: "current", waiting: false, plan: null });
    set({ status: "waiting", waiting: true, plan: plan(items) });
    expect(all(root(), "input")[0].checked).toBe(false);
    visibleButtons(root())[0].click();
    expect(calls.at(-1)).toEqual(["run", new Set()]);
  });

  it("„Alle überschreiben“ gilt nur für den Plan, in dem es geklickt wurde", async () => {
    const items = [item("a/c1.md", "conflict", { src })];
    const { view, root, set, calls } = setup({ status: "waiting", waiting: true, plan: plan(items) });
    await view.onOpen();
    all(all(root(), ".dmr-overwrite-bar")[0], "button")[0].click();
    set({ status: "current", waiting: false, plan: null });
    set({ status: "waiting", waiting: true, plan: plan(items) });
    visibleButtons(root())[0].click();
    expect(calls.at(-1)).toEqual(["run", new Set()]);
    expect(all(root(), "input")[0].disabled).toBe(false);
  });

  it("eine Auswahl für einen Pfad, den der neue Plan nicht mehr anbietet, fällt heraus", async () => {
    const { view, root, set, calls } = setup({ status: "waiting", waiting: true, plan: plan([item("a/c1.md", "conflict", { src }), item("a/c2.md", "conflict", { src })]) });
    await view.onOpen();
    for (const box of all(root(), "input")) { box.checked = true; box.dispatchEvent({ type: "change" }); }
    set({ plan: plan([item("a/c2.md", "conflict", { src })]) });
    visibleButtons(root())[0].click();
    expect(calls.at(-1)).toEqual(["run", new Set(["a/c2.md"])]);
  });

  it("Rendern baut den Körper neu, die Aktionszeile und die Statuszeile bleiben dieselben Knoten", async () => {
    const { view, root, set } = setup();
    await view.onOpen();
    const actions = all(root(), ".dmr-actions")[0];
    const status = all(root(), ".dmr-status")[0];
    const primary = all(root(), ".dmr-primary")[0];
    const body = all(root(), ".dmr-body")[0];
    const card = all(root(), ".dmr-card")[0];
    set({ last: { ...INFO, at: 99 } });
    expect(all(root(), ".dmr-actions")[0]).toBe(actions);
    expect(all(root(), ".dmr-status")[0]).toBe(status);
    expect(all(root(), ".dmr-primary")[0]).toBe(primary);
    expect(all(root(), ".dmr-body")[0]).toBe(body);
    expect(all(root(), ".dmr-card")[0]).not.toBe(card);
    expect(all(all(root(), ".dmr-result")[0], "h3")[0].textContent).toBe("Last run: T99");
  });

  it("fehlgeschlagener Lauf zeigt den Grund als Text mit Fehlerklasse", async () => {
    const { view, root } = setup({ status: "error", last: { ...INFO, ok: false, error: "notice.failed" } });
    await view.onOpen();
    expect(all(root(), ".dmr-error")[0].textContent).toBe("Sync failed. Nothing was deleted by the failed step.");
    expect(all(root(), ".dmr-status")[0].hasClass("is-error")).toBe(true);
  });

  it("2.400 Pfade in einer Gruppe: höchstens 200 Zeilen im DOM", async () => {
    const many = Array.from({ length: 2400 }, (_, i) => item(`r/${String(i).padStart(5, "0")}.md`, "new", { src }));
    const { view, root } = setup({ status: "waiting", waiting: true, plan: plan(many) });
    await view.onOpen();
    expect(all(root(), ".dmr-row")).toHaveLength(200);
    expect(all(root(), ".dmr-more")[0].textContent).toBe("… and 2200 more");
  });

  it("Schließen meldet sich ab; ein späteres Ereignis rendert nicht mehr", async () => {
    const { view, set, listeners, root } = setup();
    await view.onOpen();
    expect(listeners.size).toBe(1);
    await view.onClose();
    expect(listeners.size).toBe(0);
    expect(() => { set({ status: "error" }); view.render(); }).not.toThrow();
    expect(root().children).toHaveLength(0);
  });

  it("DE: Knopf und Status auf Deutsch", async () => {
    setLang("de");
    const { view, root } = setup();
    await view.onOpen();
    expect(visibleButtons(root())[0].textContent).toBe("Jetzt synchronisieren");
    expect(all(root(), ".dmr-status-text")[0].textContent).toBe("Aktuell");
  });
});

describe("activateView", () => {
  it("bestehendes Blatt: nur aufdecken", async () => {
    const app = makeFakeApp();
    const leaf = new WorkspaceLeaf();
    app.workspace.getLeavesOfType.mockReturnValue([leaf]);
    await activateView(app);
    expect(app.workspace.revealLeaf).toHaveBeenCalledWith(leaf);
    expect(app.workspace.getRightLeaf).not.toHaveBeenCalled();
  });
  it("kein Blatt: rechts anlegen UND aufdecken (ohne revealLeaf bleibt die Ansicht bei eingeklappter Seitenleiste 0×0)", async () => {
    const app = makeFakeApp();
    const setViewState = vi.fn();
    const leaf = { setViewState };
    app.workspace.getRightLeaf.mockReturnValue(leaf);
    await activateView(app);
    expect(app.workspace.getRightLeaf).toHaveBeenCalledWith(false);
    expect(setViewState).toHaveBeenCalledWith({ type: "docs-mirror-view", active: true });
    expect(app.workspace.revealLeaf).toHaveBeenCalledWith(leaf);
  });
  it("kein Blatt zu bekommen: nichts passiert", async () => {
    const app = makeFakeApp();
    app.workspace.getRightLeaf.mockReturnValue(null);
    await activateView(app);
    expect(app.workspace.revealLeaf).not.toHaveBeenCalled();
  });
});
