import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { makeFakeApp, Modal, Notice, Platform, WorkspaceLeaf } from "./vendor/kit/obsidian-mock";
import { setLang } from "../src/vendor/kit/i18n";
import DocsMirrorPlugin from "../src/main";
import { createRunner, type Runner, type RunnerDeps, type RunOutcome } from "../src/core/runner";
import type { Plan, PlanClass, PlanItem } from "../src/core/plan";
import type { RunInfo } from "../src/core/run-info";
import { settingsFingerprint } from "../src/core/fingerprint";
import { DocsMirrorSettingTab } from "../src/obsidian/settings-tab";
import { DocsMirrorView } from "../src/obsidian/view";
import { fakeSource } from "./helpers/fake-source";
import { fakeVault } from "./helpers/fake-vault";

const enc = new TextEncoder();
const ROOT = "/data/repos";
const TREE = { "repoA/docs/a.md": "alpha", "repoB/docs/b.md": "beta" };
const src = { path: "x", size: 1, mtime: 1 };
const item = (path: string, cls: PlanClass, extra: Partial<PlanItem> = {}): PlanItem => ({ path, cls, ...extra });
function plan(items: PlanItem[]): Plan {
  const counts = { new: 0, changed: 0, unchanged: 0, delete: 0, "vault-modified": 0, conflict: 0, "vault-only": 0 } as Record<PlanClass, number>;
  for (const it of items) counts[it.cls]++;
  return { items, counts, totalBytes: 0, mirrorBytes: 0, skipped: { symlinks: 0, tooBig: 0, otherType: 0 }, sourceState: "ok", unchecked: 0, forget: [] };
}
const INFO: RunInfo = { at: 5, ok: true, counts: { created: 2, updated: 1, unchanged: 0, deleted: 3, overwritten: 1, skipped: 0, errors: 0 }, fingerprint: "f" };

interface FakeRunner extends Runner {
  calls: { kind: "run" | "execute"; mode?: string; overwrite?: ReadonlySet<string> | "all"; signal: AbortSignal; onProgress?: (d: number, t: number) => void }[];
  next: () => Promise<RunOutcome>;
  pendingPlan: Plan | null;
}
function fakeRunner(): FakeRunner {
  const r: FakeRunner = {
    calls: [],
    pendingPlan: null,
    next: () => Promise.resolve({ kind: "done", info: INFO, aborted: false }),
    run(mode, signal, onProgress) { r.calls.push({ kind: "run", mode, signal, onProgress }); return r.next(); },
    execute(overwrite, signal, onProgress) { r.calls.push({ kind: "execute", overwrite, signal, onProgress }); return r.next(); },
    pending: () => r.pendingPlan,
    isBusy: () => false,
  };
  return r;
}

type Setup = ReturnType<typeof setup>;
function setup(opts: { data?: unknown; root?: string; last?: RunInfo; runner?: FakeRunner | "real"; tree?: Record<string, string> } = {}) {
  const app = makeFakeApp();
  app.vault.configDir = ".obsidian";
  const store = new Map<string, unknown>();
  if (opts.root !== undefined) store.set("docs-mirror:root", opts.root);
  if (opts.last) store.set("docs-mirror:last", JSON.stringify(opts.last));
  app.loadLocalStorage = (k: string) => (store.has(k) ? store.get(k) : null);
  app.saveLocalStorage = (k: string, v: unknown) => { if (v === null) store.delete(k); else store.set(k, v); };
  const layout: (() => void)[] = [];
  app.workspace.onLayoutReady = (cb: () => void) => { layout.push(cb); };
  const plugin = new DocsMirrorPlugin(app as never, { id: "docs-mirror", name: "Docs Mirror", version: "0.0.0" } as never);
  const saves: unknown[] = [];
  const realSave = plugin.saveData.bind(plugin);
  plugin.saveData = (d: unknown) => { saves.push(structuredClone(d)); return realSave(d); };
  if (opts.data !== undefined) void realSave(opts.data);
  const timers: (() => void)[] = [];
  const cleared: number[] = [];
  plugin.timers = { set: (cb) => { timers.push(cb); return timers.length; }, clear: (id) => { cleared.push(id); } };
  const runner: FakeRunner | null = opts.runner === "real" ? null : (opts.runner ?? fakeRunner());
  let deps: RunnerDeps | null = null;
  const tree = opts.tree ?? { ...TREE };
  const vault = fakeVault();
  const sourceCalls = { n: 0 };
  plugin.makeRunner = (d) => {
    deps = d;
    if (runner) return runner;
    return createRunner({
      ...d,
      source: { readdir: (rel) => { sourceCalls.n++; return fakeSource(tree).readdir(rel); } },
      readSource: (p) => Promise.resolve(enc.encode(tree[p] ?? "")),
      vault,
      yieldToUi: () => Promise.resolve(),
    });
  };
  const flushTimers = (): void => { for (const cb of timers.splice(0)) cb(); };
  const layoutReady = (): void => { for (const cb of layout.splice(0)) cb(); };
  return { app, plugin, store, saves, timers, cleared, runner, deps: () => deps as RunnerDeps, flushTimers, layoutReady, vault, sourceCalls, tree };
}
const settle = async (): Promise<void> => { for (let i = 0; i < 20; i++) await Promise.resolve(); await new Promise((r) => setTimeout(r, 0)); };
const notices = (): string[] => Notice.instances.map((n) => String(n.message));

beforeEach(() => { Notice.instances.length = 0; Platform.isDesktopApp = true; });
afterEach(() => { setLang("en"); Platform.isDesktopApp = true; vi.unstubAllGlobals(); });

describe("DocsMirrorPlugin: Registrierung", () => {
  it("registriert Ansicht, drei Befehle (Verb plus Gegenstand), Ribbon und Einstellungs-Tab", async () => {
    const { plugin } = setup();
    let ribbon: { icon: string; title: string } | null = null;
    plugin.addRibbonIcon = (icon: string, title: string) => { ribbon = { icon, title }; return {} as never; };
    await plugin.onload();
    expect(Object.keys((plugin as any).views)).toEqual(["docs-mirror-view"]);
    expect((plugin as any).commands.map((c: any) => [c.id, c.name])).toEqual([
      ["open", "Open Docs Mirror"], ["sync-now", "Sync docs now"], ["show-plan", "Show sync plan"],
    ]);
    expect(ribbon).toEqual({ icon: "folder-sync", title: "Open Docs Mirror" });
    expect((plugin as any).settingTabs[0]).toBeInstanceOf(DocsMirrorSettingTab);
  });

  it("die Ansichts-Fabrik baut die Ansicht, die sich beim Plugin anmeldet", async () => {
    const { plugin } = setup();
    await plugin.onload();
    const view = (plugin as any).views["docs-mirror-view"](new WorkspaceLeaf()) as DocsMirrorView;
    expect(view).toBeInstanceOf(DocsMirrorView);
    await view.onOpen();
    expect((view.contentEl as any).querySelectorAll(".dmr-actions")).toHaveLength(1);
    let renders = 0;
    const off = plugin.onChange(() => { renders++; });
    await plugin.updateSettings({ excludedNames: ["x"] });
    expect(renders).toBe(1);
    off();
    await plugin.updateSettings({ excludedNames: ["y"] });
    expect(renders).toBe(1);
  });

  it("Befehle: open öffnet die Ansicht rechts mit revealLeaf", async () => {
    const { plugin, app } = setup();
    const setViewState = vi.fn();
    app.workspace.getRightLeaf.mockReturnValue({ setViewState });
    await plugin.onload();
    (plugin as any).commands.find((c: any) => c.id === "open").callback();
    await settle();
    expect(setViewState).toHaveBeenCalledWith({ type: "docs-mirror-view", active: true });
    expect(app.workspace.revealLeaf).toHaveBeenCalled();
  });

  it("Befehl show-plan: ohne wartenden Plan eine Notice, mit Plan keine", async () => {
    const { plugin, runner, app } = setup();
    app.workspace.getLeavesOfType.mockReturnValue([new WorkspaceLeaf()]);
    await plugin.onload();
    const cmd = (plugin as any).commands.find((c: any) => c.id === "show-plan");
    cmd.callback();
    await settle();
    expect(notices()).toEqual(["No plan is waiting for confirmation."]);
    Notice.instances.length = 0;
    runner!.pendingPlan = plan([item("a", "new", { src })]);
    cmd.callback();
    await settle();
    expect(notices()).toEqual([]);
    expect(app.workspace.revealLeaf).toHaveBeenCalledTimes(2);
  });
});

describe("DocsMirrorPlugin: Start", () => {
  it("onload startet keinen Lauf ohne syncOnStart, auch nicht nach onLayoutReady und Timern", async () => {
    const { plugin, runner, layoutReady, flushTimers, timers } = setup({ data: { syncOnStart: false }, root: ROOT });
    await plugin.onload();
    layoutReady();
    flushTimers();
    await settle();
    expect(runner!.calls).toEqual([]);
    expect(timers).toHaveLength(0);
  });

  it("onload selbst startet nie einen Lauf; mit syncOnStart erst nach onLayoutReady und dem Timer", async () => {
    const { plugin, runner, layoutReady, flushTimers, timers } = setup({ data: { syncOnStart: true }, root: ROOT });
    await plugin.onload();
    await settle();
    expect(runner!.calls).toEqual([]);
    expect(timers).toHaveLength(0);
    layoutReady();
    await settle();
    expect(runner!.calls).toEqual([]);
    expect(timers).toHaveLength(1);
    flushTimers();
    await settle();
    expect(runner!.calls.map((c) => [c.kind, c.mode])).toEqual([["run", "startup"]]);
  });

  it("wartet der Startlauf auf Bestätigung: kein Modal, eine Notice mit Zeiger auf die Seitenleiste", async () => {
    const { plugin, runner, layoutReady, flushTimers } = setup({ data: { syncOnStart: true }, root: ROOT });
    const p = plan([item("a", "new", { src })]);
    runner!.next = () => { runner!.pendingPlan = p; return Promise.resolve({ kind: "waiting", plan: p, reasons: ["first-run"] }); };
    await plugin.onload();
    const modalBefore = Modal.__last;
    layoutReady();
    flushTimers();
    await settle();
    expect(Modal.__last).toBe(modalBefore);
    expect(notices()).toEqual(["Sync needs confirmation: open the Docs Mirror sidebar."]);
    expect(plugin.viewModel().status).toBe("waiting");
    expect(plugin.viewModel().primary).toBe("execute");
  });

  it("Startlauf, der glatt durchläuft, bleibt still; ein blockierter oder fehlgeschlagener meldet sich", async () => {
    const quiet = setup({ data: { syncOnStart: true }, root: ROOT });
    await quiet.plugin.onload();
    quiet.layoutReady(); quiet.flushTimers(); await settle();
    expect(notices()).toEqual([]);

    const blocked = setup({ data: { syncOnStart: true }, root: ROOT });
    blocked.runner!.next = () => Promise.resolve({ kind: "blocked", reason: "source-unreachable" });
    await blocked.plugin.onload();
    blocked.layoutReady(); blocked.flushTimers(); await settle();
    expect(notices()).toEqual(["Sync blocked: the source is unreachable. Nothing was deleted."]);

    Notice.instances.length = 0;
    const failed = setup({ data: { syncOnStart: true }, root: ROOT });
    failed.runner!.next = () => Promise.resolve({ kind: "done", info: { ...INFO, ok: false, error: "notice.failed" }, aborted: false });
    await failed.plugin.onload();
    failed.layoutReady(); failed.flushTimers(); await settle();
    expect(notices()).toEqual(["Sync failed. Nothing was deleted by the failed step."]);
  });

  it("Startlauf ohne Wurzel (zweites Gerät) bleibt still", async () => {
    const { plugin, runner, layoutReady, flushTimers } = setup({ data: { syncOnStart: true } });
    runner!.next = () => Promise.resolve({ kind: "blocked", reason: "not-configured" });
    await plugin.onload();
    layoutReady(); flushTimers(); await settle();
    expect(notices()).toEqual([]);
  });

  it("onunload vor dem Timer: der Startlauf findet nicht mehr statt, der Timer wird geräumt", async () => {
    const { plugin, runner, layoutReady, flushTimers, cleared } = setup({ data: { syncOnStart: true }, root: ROOT });
    await plugin.onload();
    layoutReady();
    plugin.onunload();
    expect(cleared).toEqual([1]);
    flushTimers();
    await settle();
    expect(runner!.calls).toEqual([]);
  });

  it("onLayoutReady nach onunload startet keinen Timer", async () => {
    const { plugin, layoutReady, timers } = setup({ data: { syncOnStart: true }, root: ROOT });
    await plugin.onload();
    plugin.onunload();
    layoutReady();
    expect(timers).toHaveLength(0);
  });
});

describe("DocsMirrorPlugin: Abbruch", () => {
  it("onunload setzt das Abbruchsignal des laufenden Laufs", async () => {
    const { plugin, runner } = setup({ root: ROOT });
    let release!: () => void;
    runner!.next = () => new Promise<RunOutcome>((r) => { release = () => { r({ kind: "done", info: INFO, aborted: true }); }; });
    await plugin.onload();
    const running = plugin.sync();
    await settle();
    const signal = runner!.calls[0].signal;
    expect(signal.aborted).toBe(false);
    plugin.onunload();
    expect(signal.aborted).toBe(true);
    release();
    await running;
  });

  it("cancel() setzt das Signal nur des laufenden Laufs; ohne Lauf passiert nichts", async () => {
    const { plugin, runner } = setup({ root: ROOT });
    let release!: () => void;
    runner!.next = () => new Promise<RunOutcome>((r) => { release = () => { r({ kind: "done", info: INFO, aborted: true }); }; });
    await plugin.onload();
    expect(() => { plugin.cancel(); }).not.toThrow();
    const running = plugin.sync();
    await settle();
    expect(plugin.viewModel().status).toBe("running");
    expect(plugin.viewModel().primary).toBe("cancel");
    plugin.cancel();
    expect(runner!.calls[0].signal.aborted).toBe(true);
    release();
    await running;
    expect(notices()).toEqual(["Sync cancelled. Files already written stay in place."]);
    expect(plugin.viewModel().status).not.toBe("running");
  });

  it("der nächste Lauf bekommt ein frisches Signal", async () => {
    const { plugin, runner } = setup({ root: ROOT });
    await plugin.onload();
    await plugin.sync();
    plugin.cancel();
    await plugin.sync();
    expect(runner!.calls[1].signal.aborted).toBe(false);
    expect(runner!.calls[1].signal).not.toBe(runner!.calls[0].signal);
  });
});

describe("DocsMirrorPlugin: Zustand und Empty-State", () => {
  it("zweites Gerät ohne Wurzel: Empty-State („Nicht eingerichtet“), nie „Quelle nicht erreichbar“", async () => {
    // data.json kam per Sync vom ersten Gerät, die Wurzel nicht (sie liegt gerätelokal).
    const { plugin } = setup({ data: { patterns: ["**/docs"], syncOnStart: false } });
    await plugin.onload();
    const vm = plugin.viewModel();
    expect(vm.status).toBe("not-configured");
    expect(vm.statusText).toBe("Not set up");
    expect(vm.primary).toBe("settings");
    expect(vm.statusText).not.toBe("Source unreachable");
  });

  it("auch mit einem letzten Lauf „Quelle nicht erreichbar“ aus einer früheren Wurzel bleibt ohne Wurzel der Empty-State", async () => {
    const { plugin } = setup({ last: { ...INFO, ok: false, error: "status.unreachable" } });
    await plugin.onload();
    expect(plugin.viewModel().status).toBe("not-configured");
  });

  it("mit Wurzel und gescheitertem letzten Lauf „unreachable“ gilt „Quelle nicht erreichbar“", async () => {
    const { plugin } = setup({ root: ROOT, last: { ...INFO, ok: false, error: "status.unreachable" } });
    await plugin.onload();
    expect(plugin.viewModel().status).toBe("unreachable");
    expect(plugin.viewModel().statusText).toBe("Source unreachable");
  });

  it("mit Wurzel und ohne Lauf: nie gelaufen; mit Lauf: aktuell, mit Zeit und Zählern", async () => {
    const never = setup({ root: ROOT });
    await never.plugin.onload();
    expect(never.plugin.viewModel().status).toBe("never");
    const ran = setup({ root: ROOT, last: INFO });
    await ran.plugin.onload();
    const vm = ran.plugin.viewModel();
    expect(vm.status).toBe("current");
    expect(vm.lastRun).toMatch(/^Last run: /);
    expect(vm.counters).toEqual(INFO.counts);
  });

  it("Fortschritt kommt aus dem Lauf in die Ansicht, und die Ansicht wird benachrichtigt", async () => {
    const { plugin, runner } = setup({ root: ROOT });
    await plugin.onload();
    let release!: () => void;
    runner!.next = () => new Promise<RunOutcome>((r) => { release = () => { r({ kind: "done", info: INFO, aborted: false }); }; });
    let renders = 0;
    plugin.onChange(() => { renders++; });
    const running = plugin.sync();
    await settle();
    const before = renders;
    runner!.calls[0].onProgress!(3, 10);
    expect(plugin.viewModel().progress).toEqual({ done: 3, total: 10 });
    expect(renders).toBeGreaterThan(before);
    release();
    await running;
    expect(plugin.viewModel().progress).toBeNull();
  });
});

describe("DocsMirrorPlugin: data.json nur bei Änderung", () => {
  it("onload schreibt nichts, auch nicht mit Altdaten, die normalisiert werden", async () => {
    const { plugin, saves } = setup({ data: { patterns: ["**/docs"], bogus: 1 } });
    await plugin.onload();
    expect(saves).toEqual([]);
  });

  it("updateSettings schreibt bei einer Änderung genau einmal, bei gleichem Wert nie", async () => {
    const { plugin, saves } = setup();
    await plugin.onload();
    await plugin.updateSettings({ excludedNames: ["a"] });
    expect(saves).toHaveLength(1);
    expect(saves[0]).toMatchObject({ excludedNames: ["a"] });
    await plugin.updateSettings({ excludedNames: ["a"] });
    await plugin.updateSettings({});
    await plugin.saveSettings();
    expect(saves).toHaveLength(1);
    await plugin.updateSettings({ syncOnStart: true });
    expect(saves).toHaveLength(2);
  });

  it("die Wurzel steht nie in data.json, sondern gerätelokal", async () => {
    const { plugin, saves, store } = setup();
    await plugin.onload();
    const r = plugin.setRoot("/data/neu/");
    expect(r).toEqual({ ok: true, root: "/data/neu" });
    expect(store.get("docs-mirror:root")).toBe("/data/neu");
    expect(plugin.root).toBe("/data/neu");
    expect(saves).toEqual([]);
    await plugin.updateSettings({ syncOnStart: true });
    expect(JSON.stringify(saves)).not.toContain("data/neu");
  });

  it("eine ungültige Wurzel ändert nichts", async () => {
    const { plugin, store } = setup({ root: ROOT });
    await plugin.onload();
    expect(plugin.setRoot("relativ")).toEqual({ ok: false, problem: "relative" });
    expect(plugin.setRoot("~/x")).toEqual({ ok: false, problem: "tilde" });
    expect(plugin.setRoot("")).toEqual({ ok: false, problem: "empty" });
    expect(plugin.root).toBe(ROOT);
    expect(store.get("docs-mirror:root")).toBe(ROOT);
  });

  it("lädt gespeicherte Einstellungen und prüft jedes Feld einzeln", async () => {
    const { plugin } = setup({ data: { maxFileBytes: "kaputt", deleteThresholdFiles: 3 } });
    await plugin.onload();
    expect(plugin.settings.deleteThresholdFiles).toBe(3);
    expect(plugin.settings.maxFileBytes).toBe(5 * 1024 * 1024);
  });
});

describe("DocsMirrorPlugin: Änderungen lösen keinen Lauf aus, sie ändern den Fingerabdruck", () => {
  async function mirrored(s: Setup): Promise<void> {
    await s.plugin.sync();
    expect(s.plugin.viewModel().status).toBe("waiting");
    const done = s.plugin.executePlan(new Set());
    await settle();
    (Modal.__last as any).contentEl.querySelectorAll("button")[1].__component.clickCB();
    await done;
    expect(s.plugin.viewModel().status).toBe("current");
  }

  it("Wurzelwechsel: kein Lauf, kein Quellzugriff; der Fingerabdruck wechselt, der nächste Lauf wartet auf Bestätigung", async () => {
    const s = setup({ runner: "real", root: ROOT });
    await s.plugin.onload();
    await mirrored(s);
    const fpBefore = settingsFingerprint(s.plugin.settings, s.plugin.root);
    const scans = s.sourceCalls.n;
    const writes = s.vault.calls.ops.length;
    expect(s.plugin.setRoot("/data/anders").ok).toBe(true);
    await settle();
    expect(s.sourceCalls.n).toBe(scans);
    expect(s.vault.calls.ops).toHaveLength(writes);
    expect(settingsFingerprint(s.plugin.settings, s.plugin.root)).not.toBe(fpBefore);
    expect(s.plugin.viewModel().status).toBe("current");

    await s.plugin.sync();
    expect(s.plugin.viewModel().status).toBe("waiting");
    expect(s.plugin.viewModel().reasons).toContain("Settings changed since the last run, or the state of this device is unknown.");
  });

  it("Musterwechsel: kein Lauf, kein Quellzugriff; der nächste Lauf wartet auf Bestätigung", async () => {
    const s = setup({ runner: "real", root: ROOT });
    await s.plugin.onload();
    await mirrored(s);
    const scans = s.sourceCalls.n;
    await s.plugin.updateSettings({ patterns: ["repoA/docs"] });
    await settle();
    expect(s.sourceCalls.n).toBe(scans);
    expect(s.plugin.viewModel().status).toBe("current");

    await s.plugin.sync();
    expect(s.plugin.viewModel().status).toBe("waiting");
    expect(s.plugin.viewModel().reasons).toContain("Settings changed since the last run, or the state of this device is unknown.");
    // repoB fällt aus dem Umfang und steht unter „zu löschen“, wie jede andere Löschung.
    expect(s.plugin.viewModel().groups.find((g) => g.cls === "delete")?.paths).toEqual(["repoB/docs/b.md"]);
  });

  it("ohne Änderung des Umfangs (Schwelle, Start-Schalter) bleibt der Fingerabdruck und der Lauf braucht keine Bestätigung", async () => {
    const s = setup({ runner: "real", root: ROOT });
    await s.plugin.onload();
    await mirrored(s);
    await s.plugin.updateSettings({ deleteThresholdFiles: 3, syncOnStart: true });
    await s.plugin.sync();
    expect(s.plugin.viewModel().status).toBe("current");
    expect(notices().at(-1)).toBe("Sync finished: 0 changed, 0 deleted.");
  });
});

describe("DocsMirrorPlugin: Läufe von Hand", () => {
  it("Jetzt synchronisieren: fertig → Notice mit Zahlen, Zustand aus dem Ergebnis", async () => {
    const { plugin, runner } = setup({ root: ROOT });
    await plugin.onload();
    await plugin.sync();
    expect(runner!.calls.map((c) => [c.kind, c.mode])).toEqual([["run", "manual"]]);
    expect(notices()).toEqual(["Sync finished: 4 changed, 3 deleted."]);
    expect(plugin.viewModel().status).toBe("current");
  });

  it("Teilerfolg und Fehlschlag haben eigene Notices", async () => {
    const { plugin, runner } = setup({ root: ROOT });
    await plugin.onload();
    runner!.next = () => Promise.resolve({ kind: "done", info: { ...INFO, ok: false, error: "notice.partial" }, aborted: false });
    await plugin.sync();
    runner!.next = () => Promise.resolve({ kind: "done", info: { ...INFO, ok: false, error: "notice.failed" }, aborted: false });
    await plugin.sync();
    expect(notices()).toEqual(["Sync finished with errors: some files were skipped.", "Sync failed. Nothing was deleted by the failed step."]);
  });

  it("busy → „läuft bereits“", async () => {
    const { plugin, runner } = setup({ root: ROOT });
    await plugin.onload();
    runner!.next = () => Promise.resolve({ kind: "busy" });
    await plugin.sync();
    expect(notices()).toEqual(["A sync is already running."]);
  });

  it("ein zweiter Aufruf während eines Laufs startet keinen zweiten", async () => {
    const { plugin, runner } = setup({ root: ROOT });
    await plugin.onload();
    let release!: () => void;
    runner!.next = () => new Promise<RunOutcome>((r) => { release = () => { r({ kind: "done", info: INFO, aborted: false }); }; });
    const first = plugin.sync();
    await settle();
    await plugin.sync();
    expect(runner!.calls).toHaveLength(1);
    expect(notices()).toEqual(["A sync is already running."]);
    release();
    await first;
  });

  it("blockiert: Notice je Grund, der Stand des Geräts wird nachgeladen", async () => {
    const { plugin, runner, store } = setup({ root: ROOT });
    await plugin.onload();
    runner!.next = () => {
      store.set("docs-mirror:last", JSON.stringify({ ...INFO, ok: false, error: "status.unreachable" }));
      return Promise.resolve({ kind: "blocked", reason: "source-unreachable" });
    };
    await plugin.sync();
    expect(notices()).toEqual(["Sync blocked: the source is unreachable. Nothing was deleted."]);
    expect(plugin.viewModel().status).toBe("unreachable");
    runner!.next = () => Promise.resolve({ kind: "blocked", reason: "source-empty" });
    await plugin.sync();
    runner!.next = () => Promise.resolve({ kind: "blocked", reason: "not-configured" });
    await plugin.sync();
    expect(notices().slice(1)).toEqual(["Sync blocked: the source is empty. Nothing was deleted.", "Sync blocked: Docs Mirror is not set up yet."]);
  });

  it("ein Fehler des Zustands-Speichers wird zur Notice statt zum Absturz, und der Lauf gilt wieder als frei", async () => {
    const { plugin, runner } = setup({ root: ROOT });
    await plugin.onload();
    runner!.next = () => Promise.reject(new Error("disk"));
    await expect(plugin.sync()).resolves.toBeUndefined();
    expect(notices()).toEqual(["Sync failed. Nothing was deleted by the failed step."]);
    expect(plugin.viewModel().status).not.toBe("running");
  });

  it("ohne Desktop läuft nichts: eine klare Meldung", async () => {
    const { plugin, runner } = setup({ root: ROOT });
    await plugin.onload();
    Platform.isDesktopApp = false;
    await plugin.sync();
    expect(runner!.calls).toEqual([]);
    expect(notices()).toEqual(["Docs Mirror reads the source folder with Node.js and works on desktop only."]);
  });

  it("der Befehl sync-now startet einen Lauf von Hand", async () => {
    const { plugin, runner } = setup({ root: ROOT });
    await plugin.onload();
    (plugin as any).commands.find((c: any) => c.id === "sync-now").callback();
    await settle();
    expect(runner!.calls.map((c) => c.mode)).toEqual(["manual"]);
  });
});

describe("DocsMirrorPlugin: Plan ausführen", () => {
  const items = [
    item("a/c1.md", "conflict", { src }), item("a/c2.md", "conflict", { src }),
    item("a/c3.md", "conflict", { src, reason: "case-collision" }), item("a/d.md", "delete"),
  ];
  const confirmBtn = (): any => (Modal.__last as any).contentEl.querySelectorAll("button")[1].__component;
  const cancelBtn = (): any => (Modal.__last as any).contentEl.querySelectorAll("button")[0].__component;
  const paragraphs = (): string[] => (Modal.__last as any).contentEl.querySelectorAll("p").map((p: any) => p.textContent);

  async function waiting() {
    const s = setup({ root: ROOT });
    const p = plan(items);
    s.runner!.next = () => { s.runner!.pendingPlan = p; return Promise.resolve({ kind: "waiting", plan: p, reasons: ["first-run", "conflicts"] }); };
    await s.plugin.onload();
    await s.plugin.sync();
    s.runner!.calls.length = 0;
    Notice.instances.length = 0;
    s.runner!.next = () => { s.runner!.pendingPlan = null; return Promise.resolve({ kind: "done", info: INFO, aborted: false }); };
    return s;
  }

  it("zeigt die Bestätigung mit Gründen und Zahlen; Abbrechen führt nichts aus und der Plan wartet weiter", async () => {
    const s = await waiting();
    const run = s.plugin.executePlan(new Set());
    await settle();
    expect(paragraphs()).toContain("First run: check the plan before anything is written.");
    expect(paragraphs()).toContain("3 conflicts");
    cancelBtn().clickCB();
    await run;
    expect(s.runner!.calls).toEqual([]);
    expect(s.plugin.viewModel().status).toBe("waiting");
  });

  it("Bestätigen führt mit genau den überschreibbaren, angekreuzten Pfaden aus", async () => {
    const s = await waiting();
    // c3 hat einen Grund (case-collision) und c9 gibt es nicht: beide fallen heraus, auch wenn jemand sie weiterreicht.
    const run = s.plugin.executePlan(new Set(["a/c2.md", "a/c3.md", "a/c9.md"]));
    await settle();
    expect(paragraphs()).toContain("1 file in the vault will be overwritten with the source version.");
    confirmBtn().clickCB();
    await run;
    expect(s.runner!.calls.map((c) => [c.kind, c.overwrite])).toEqual([["execute", new Set(["a/c2.md"])]]);
    expect(notices()).toEqual(["Sync finished: 4 changed, 3 deleted."]);
    expect(s.plugin.viewModel().status).toBe("current");
  });

  it("„alle“ geht als \"all\" durch und nennt die Zahl der überschreibbaren Konflikte, nicht die der Konflikte", async () => {
    const s = await waiting();
    const run = s.plugin.executePlan("all");
    await settle();
    expect(paragraphs()).toContain("2 files in the vault will be overwritten with the source version.");
    confirmBtn().clickCB();
    await run;
    expect(s.runner!.calls[0].overwrite).toBe("all");
  });

  it("ohne wartenden Plan passiert nichts", async () => {
    const { plugin, runner } = setup({ root: ROOT });
    await plugin.onload();
    const before = Modal.__last;
    await plugin.executePlan(new Set());
    expect(Modal.__last).toBe(before);
    expect(runner!.calls).toEqual([]);
  });

  it("ein zweiter Klick, während die Bestätigung offen ist, öffnet kein zweites Fenster", async () => {
    const s = await waiting();
    const first = s.plugin.executePlan(new Set());
    await settle();
    const modal = Modal.__last;
    await s.plugin.executePlan(new Set());
    expect(Modal.__last).toBe(modal);
    confirmBtn().clickCB();
    await first;
    expect(s.runner!.calls).toHaveLength(1);
  });

  it("während ein Lauf läuft, öffnet „Plan ausführen“ nichts, und die Ansicht zeigt den alten Plan nicht mehr", async () => {
    const s = await waiting();
    let release!: () => void;
    s.runner!.next = () => new Promise<RunOutcome>((r) => { release = () => { r({ kind: "done", info: INFO, aborted: false }); }; });
    const running = s.plugin.sync();
    await settle();
    expect(s.runner!.pending()).not.toBeNull();
    expect(s.plugin.viewModel().status).toBe("running");
    expect(s.plugin.viewModel().hasPlan).toBe(false);
    const modal = Modal.__last;
    await s.plugin.executePlan(new Set());
    expect(Modal.__last).toBe(modal);
    release();
    await running;
  });

  it("ändert sich der Plan zwischen Vorschau und Ausführen, wartet er erneut mit einer Notice", async () => {
    const s = await waiting();
    s.runner!.next = () => Promise.resolve({ kind: "waiting", plan: plan(items), reasons: ["conflicts"] });
    const run = s.plugin.executePlan(new Set());
    await settle();
    confirmBtn().clickCB();
    await run;
    expect(notices()).toEqual(["Sync needs confirmation: open the Docs Mirror sidebar."]);
    expect(s.plugin.viewModel().reasons).toEqual(["Some files already exist in the vault and were not created by this plugin."]);
  });
});

describe("DocsMirrorPlugin: Verdrahtung", () => {
  it("die Host-Aktionen der Ansicht sind void und lösen Lauf und Ausführung aus", async () => {
    const s = setup({ root: ROOT });
    const p = plan([item("a/c1.md", "conflict", { src })]);
    s.runner!.next = () => { s.runner!.pendingPlan = p; return Promise.resolve({ kind: "waiting", plan: p, reasons: ["conflicts"] }); };
    await s.plugin.onload();
    expect(s.plugin.syncNow()).toBeUndefined();
    await settle();
    expect(s.runner!.calls.map((c) => c.kind)).toEqual(["run"]);
    s.runner!.next = () => Promise.resolve({ kind: "done", info: INFO, aborted: false });
    expect(s.plugin.runPlan(new Set(["a/c1.md"]))).toBeUndefined();
    await settle();
    (Modal.__last as any).contentEl.querySelectorAll("button")[1].__component.clickCB();
    await settle();
    expect(s.runner!.calls.map((c) => [c.kind, c.overwrite])).toEqual([["run", undefined], ["execute", new Set(["a/c1.md"])]]);
  });

  it("der Speicher meldet ein zu großes Manifest einmal je Sitzung", async () => {
    const s = setup({ runner: "real", root: ROOT });
    await s.plugin.onload();
    const state = s.deps().state;
    const big = Object.fromEntries(Array.from({ length: 20000 }, (_, i) => [`r/${i}.md`, { path: `r/${i}.md`, srcSize: 1, srcMtime: 1, size: 1, mtime: 1, hash: "h".repeat(64) }]));
    await state.save({ manifest: big });
    await state.save({ manifest: big });
    expect(notices()).toHaveLength(1);
    expect(notices()[0]).toMatch(/^The sync state of this device has grown to \d/);
  });

  it("yieldToUi gibt über den Timer des Plugins ab", async () => {
    const s = setup();
    await s.plugin.onload();
    let done = false;
    void s.deps().yieldToUi().then(() => { done = true; });
    await settle();
    expect(done).toBe(false);
    s.flushTimers();
    await settle();
    expect(done).toBe(true);
  });

  it("der Standard-Timer nutzt window.setTimeout und window.clearTimeout", () => {
    const calls: unknown[][] = [];
    vi.stubGlobal("window", { setTimeout: (...a: unknown[]) => { calls.push(["set", ...a]); return 7; }, clearTimeout: (...a: unknown[]) => { calls.push(["clear", ...a]); } });
    const plugin = new DocsMirrorPlugin(makeFakeApp() as never, { id: "docs-mirror" } as never);
    const cb = (): void => {};
    expect(plugin.timers.set(cb, 50)).toBe(7);
    plugin.timers.clear(7);
    expect(calls).toEqual([["set", cb, 50], ["clear", 7]]);
  });

  it("die Einstellungen öffnen sich über die App (openTabById)", async () => {
    const s = setup();
    const open = vi.fn();
    const openTabById = vi.fn();
    (s.app as any).setting = { open, openTabById };
    await s.plugin.onload();
    s.plugin.openSettings();
    expect(open).toHaveBeenCalled();
    expect(openTabById).toHaveBeenCalledWith("docs-mirror");
  });
});
