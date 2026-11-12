import { FileSystemAdapter, Notice, Platform, Plugin, getLanguage } from "obsidian";
import { t } from "./i18n/strings";
import type { ConfirmReason } from "./core/guards";
import { statusOf, type RunInfo } from "./core/run-info";
import { createRunner, type Runner, type RunnerDeps, type RunOutcome } from "./core/runner";
import { loadSettings, validateRoot, type DocsMirrorSettings, type RootCheck } from "./core/settings";
import { buildViewModel, isOverwritable, type ViewModel } from "./core/view-model";
import { confirmRun } from "./obsidian/confirm-run";
import { createDeviceState } from "./obsidian/device-state";
import { DocsMirrorSettingTab, type SettingsHost } from "./obsidian/settings-tab";
import { createSourcePort } from "./obsidian/source-fs";
import { resolveRealPathsNode } from "./obsidian/real-paths";
import { createVaultPort } from "./obsidian/vault-io";
import { activateView, DocsMirrorView, VIEW_TYPE_DOCS_MIRROR, type DocsMirrorHost } from "./obsidian/view";
import { formatBytes } from "./vendor/kit/format-bytes";
import { getLang, pickLang, setLang } from "./vendor/kit/i18n";

/** Wartezeit nach `onLayoutReady`, bevor der Startlauf beginnt: der Vault-Start bleibt davon unberührt. */
const STARTUP_DELAY_MS = 2000;

/** Makrotask-Pause ohne Zeitgeber. Chromium drosselt `window.setTimeout` in einem verdeckten Fenster (Sekunden bis eine Minute je Aufruf);
 *  eine Pause über den Zeitgeber kann dann jede Runde des Scans zur Wartezeit machen, weil das Zeittor nach einer langen Pause sofort wieder
 *  fällig ist (Befund 2026-10-31). Eine Nachricht auf einem `MessageChannel` ist ein eigener Makrotask, den keine Drosselung verzögert; die
 *  Oberfläche kommt dazwischen trotzdem zum Zug. Ein Kanal je Plugin, `close` löst offene Pausen auf. */
function createMacrotaskPause(): { pause: () => Promise<void>; close: () => void } {
  let channel: MessageChannel | null = null;
  const waiting: (() => void)[] = [];
  return {
    pause: () => new Promise<void>((resolve) => {
      if (channel === null) {
        channel = new MessageChannel();
        channel.port1.onmessage = () => { waiting.shift()?.(); };
      }
      waiting.push(resolve);
      channel.port2.postMessage(null);
    }),
    close: () => {
      channel?.port1.close();
      channel = null;
      for (const resolve of waiting.splice(0)) resolve();
    },
  };
}

function rawLanguage(): string | null {
  try { return getLanguage(); } catch { return null; }
}

/** Das Plugin ist selbst der schmale Host der Ansicht und des Einstellungs-Tabs: beide kennen nur diese Verträge. */
export default class DocsMirrorPlugin extends Plugin implements DocsMirrorHost, SettingsHost {
  settings: DocsMirrorSettings = loadSettings(null);
  /** Die gerätelokale Wurzel; leer, solange dieses Gerät nichts eingerichtet hat. */
  root = "";
  /** Über `window`, nicht über Node-Timer (Obsidian-Vorgabe); als Feld austauschbar für Tests. */
  timers: { set(cb: () => void, ms: number): number; clear(id: number): void } = {
    set: (cb, ms) => window.setTimeout(cb, ms),
    clear: (id) => { window.clearTimeout(id); },
  };
  /** Baut den Runner; austauschbar für Tests. */
  makeRunner: (deps: RunnerDeps) => Runner = createRunner;

  private runner!: Runner;
  private device!: ReturnType<typeof createDeviceState>;
  private last: RunInfo | null = null;
  private running = false;
  private confirming = false;
  private progress: { done: number; total: number | null } | null = null;
  private waitingReasons: ConfirmReason[] = [];
  private abort: AbortController | null = null;
  private runSource: ReturnType<typeof createSourcePort> | null = null;
  private startupTimer: number | null = null;
  private unloaded = false;
  private readonly macrotask = createMacrotaskPause();
  private warnedLarge = false;
  private savedJson = "";
  private readonly listeners = new Set<() => void>();

  async onload(): Promise<void> {
    // Sprache vor allen Texten setzen (EN ist Fallback).
    setLang(pickLang(rawLanguage()));
    this.settings = loadSettings(await this.loadData());
    this.savedJson = JSON.stringify(this.settings);

    this.device = createDeviceState(this.app, this.manifest.id, { onLargeManifest: (bytes) => { this.warnLarge(bytes); } });
    const state = await this.device.load();
    this.root = state.root;
    this.last = state.last;

    const tempDir = `${this.app.vault.configDir}/plugins/${this.manifest.id}/tmp`;
    // Die Quelle hängt an der Wurzel von jetzt, nicht an der beim Start: ein Wurzelwechsel gilt ab dem nächsten Lauf.
    // Die Wurzel gilt je Lauf: `perform` baut den Quellanschluss einmal; ein Wurzelwechsel mitten im Lauf wirkt erst im nächsten.
    const source = (): ReturnType<typeof createSourcePort> => this.runSource ?? createSourcePort(this.root);
    this.runner = this.makeRunner({
      source: { readdir: (rel) => source().readdir(rel) },
      readSource: (path) => source().readFile(path),
      vault: createVaultPort(this.app, tempDir),
      state: this.device,
      settings: () => this.settings,
      yieldToUi: () => this.macrotask.pause(),
      now: () => Date.now(),
      // Das Basis-Verzeichnis des Vaults kennt nur der Desktop-Adapter; der Kern bekommt nur den Pfad (kein fs im Kern).
      vaultBasePath: () => {
        const adapter = this.app.vault.adapter;
        return adapter instanceof FileSystemAdapter ? adapter.getBasePath() : null;
      },
      // Symlinks und andere Schreibweisen löst nur das Dateisystem auf; der Kern vergleicht danach Text.
      resolvePaths: resolveRealPathsNode,
    });

    this.registerView(VIEW_TYPE_DOCS_MIRROR, (leaf) => new DocsMirrorView(leaf, this));
    this.addCommand({ id: "open", name: t("command.open"), callback: () => { void activateView(this.app); } });
    this.addCommand({ id: "sync-now", name: t("command.syncNow"), callback: () => { this.syncNow(); } });
    this.addCommand({ id: "show-plan", name: t("command.showPlan"), callback: () => { void this.showPlan(); } });
    this.addRibbonIcon("folder-sync", t("command.open"), () => { void activateView(this.app); });
    this.addSettingTab(new DocsMirrorSettingTab(this.app, this, this));

    // Der Startlauf beginnt erst, wenn der Arbeitsbereich steht, und nach einer Atempause; er öffnet nie ein Modal.
    if (this.settings.syncOnStart) {
      this.app.workspace.onLayoutReady(() => {
        if (this.unloaded) return;
        this.startupTimer = this.timers.set(() => { this.startupTimer = null; if (this.unloaded || this.running || this.confirming || this.runner.pending() !== null) return; void this.perform("startup", (s, p) => this.runner.run("startup", s, p)); }, STARTUP_DELAY_MS);
      });
    }
  }

  onunload(): void {
    this.unloaded = true;
    if (this.startupTimer !== null) {
      this.timers.clear(this.startupTimer);
      this.startupTimer = null;
    }
    // Ein laufender Lauf hört auf, bevor das Plugin verschwindet: die Datei, an der er schreibt, wird fertig, die nächste nicht begonnen.
    this.abort?.abort();
    this.macrotask.close();
    this.listeners.clear();
  }

  /* ── Host der Ansicht ───────────────────────────────────── */

  viewModel(): ViewModel {
    const pending = this.runner.pending();
    const waiting = !this.running && pending !== null;
    const last = this.last;
    const status = statusOf({
      configured: validateRoot(this.root).ok,
      running: this.running,
      waiting,
      last,
      reachable: !(last !== null && !last.ok && last.error === "status.unreachable"),
    });
    return buildViewModel({
      status,
      last,
      plan: waiting ? pending : null,
      progress: this.progress,
      waiting,
      reasons: waiting ? this.waitingReasons : [],
    }, { time: (ms) => new Date(ms).toLocaleString(getLang()) });
  }

  onChange(cb: () => void): () => void {
    this.listeners.add(cb);
    return () => { this.listeners.delete(cb); };
  }

  /** Host-Aktionen sind `void` (UI-STANDARD §4); die Arbeit steckt in `sync` und `executePlan`. */
  syncNow(): void {
    void this.sync();
  }

  runPlan(overwrite: ReadonlySet<string> | "all"): void {
    void this.executePlan(overwrite);
  }

  async sync(): Promise<void> {
    await this.perform("manual", (signal, onProgress) => this.runner.run("manual", signal, onProgress));
  }

  /** Führt den wartenden Plan nach ausdrücklicher Bestätigung aus. Überschrieben wird nur, was der Plan als überschreibbar
   *  führt (Konflikt ohne Grund) UND angekreuzt ist; was jemand sonst durchreicht, fällt hier heraus. */
  async executePlan(overwrite: ReadonlySet<string> | "all"): Promise<void> {
    const plan = this.runner.pending();
    if (plan === null || this.running || this.confirming) return;
    const allowed = new Set(plan.items.filter(isOverwritable).map((i) => i.path));
    const chosen: ReadonlySet<string> | "all" = overwrite === "all" ? "all" : new Set([...overwrite].filter((p) => allowed.has(p)));
    const count = chosen === "all" ? allowed.size : chosen.size;
    this.confirming = true;
    let ok: boolean;
    try {
      ok = await confirmRun(this.app, this.waitingReasons, plan, count);
    } finally {
      this.confirming = false;
    }
    if (!ok || this.unloaded) return;
    await this.perform("manual", (signal, onProgress) => this.runner.execute(chosen, signal, onProgress));
  }

  cancel(): void {
    this.abort?.abort();
  }

  openSettings(): void {
    const setting = (this.app as unknown as { setting?: { open(): void; openTabById(id: string): void } }).setting;
    setting?.open();
    setting?.openTabById(this.manifest.id);
  }

  /** „Show sync plan“: öffnet die Seitenleiste, in der der wartende Plan steht. */
  private async showPlan(): Promise<void> {
    await activateView(this.app);
    if (this.runner.pending() === null) new Notice(t("notice.noPlan"));
  }

  /* ── Host des Einstellungs-Tabs ─────────────────────────── */

  /** Schreibt `data.json` nur, wenn sich der Inhalt geändert hat. */
  async saveSettings(): Promise<void> {
    const json = JSON.stringify(this.settings);
    if (json === this.savedJson) return;
    await this.saveData(this.settings);
    this.savedJson = json;
    this.notify();
  }

  /** Eine Einstellung ändern heißt: speichern und den Fingerabdruck ändern. Einen Lauf löst es nie aus; der nächste Lauf
   *  fragt dann nach (Spec § 3 „Einstellungen ändern“). */
  async updateSettings(patch: Partial<DocsMirrorSettings>): Promise<void> {
    this.settings = { ...this.settings, ...patch };
    await this.saveSettings();
  }

  setRoot(raw: string): RootCheck {
    const check = validateRoot(raw);
    if (!check.ok) return check;
    this.device.setRoot(check.root);
    this.root = check.root;
    this.notify();
    return check;
  }

  /* ── Läufe ──────────────────────────────────────────────── */

  private async perform(mode: "manual" | "startup", start: (signal: AbortSignal, onProgress: (done: number, total: number | null) => void) => Promise<RunOutcome>): Promise<void> {
    if (this.unloaded) return;
    if (!Platform.isDesktopApp) {
      if (mode === "manual") new Notice(t("notice.desktopOnly"));
      return;
    }
    if (this.running) {
      if (mode === "manual") new Notice(t("notice.alreadyRunning"));
      return;
    }
    const controller = new AbortController();
    this.abort = controller;
    this.runSource = createSourcePort(this.root);
    this.running = true;
    this.progress = null;
    this.notify();
    try {
      const outcome = await start(controller.signal, (done, total) => {
        this.progress = { done, total };
        this.notify();
      });
      await this.settleOutcome(outcome, mode);
    } catch {
      if (!this.unloaded) new Notice(t("notice.failed"));
    } finally {
      this.runSource = null;
      this.running = false;
      this.abort = null;
      this.progress = null;
      this.notify();
    }
  }

  private async settleOutcome(outcome: RunOutcome, mode: "manual" | "startup"): Promise<void> {
    if (this.unloaded) return;
    const manual = mode === "manual";
    switch (outcome.kind) {
      case "busy":
        if (manual) new Notice(t("notice.alreadyRunning"));
        return;
      case "blocked":
        this.waitingReasons = [];
        await this.reloadLast();
        if (outcome.reason === "not-configured") {
          if (manual) new Notice(t("notice.blocked.not-configured"));
        } else if (outcome.reason === "vault-is-root") {
          new Notice(t("notice.blocked.vault-is-root"));
        } else {
          new Notice(t(outcome.reason === "source-unreachable" ? "notice.blocked.unreachable" : "notice.blocked.empty"));
        }
        return;
      case "waiting":
        this.waitingReasons = outcome.reasons;
        new Notice(t("notice.waiting"));
        return;
      case "done": {
        this.waitingReasons = [];
        if (outcome.aborted) {
          // Ein Abbruch vor dem Scan speichert nichts: der Stand des Geräts gilt, nicht die leere Info des Runners.
          await this.reloadLast();
          new Notice(t("notice.cancelled"));
          return;
        }
        this.last = outcome.info;
        if (!outcome.info.ok) new Notice(t(outcome.info.error === "notice.partial" ? "notice.partial" : "notice.failed"));
        else if (manual) {
          const c = outcome.info.counts;
          new Notice(t("notice.done", { changed: c.created + c.updated + c.overwritten, deleted: c.deleted }));
        }
        return;
      }
    }
  }

  private async reloadLast(): Promise<void> {
    try {
      this.last = (await this.device.load()).last;
    } catch {
      // Der Stand bleibt, wie er war; die Ansicht zeigt dann den letzten bekannten.
    }
  }

  private notify(): void {
    for (const cb of [...this.listeners]) {
      try { cb(); } catch { /* eine kaputte Ansicht darf den Lauf nicht stören */ }
    }
  }

  private warnLarge(bytes: number): void {
    if (this.warnedLarge) return;
    this.warnedLarge = true;
    new Notice(t("notice.largeManifest", { size: formatBytes(bytes, { decimalSeparator: getLang() === "de" ? "," : "." }) }));
  }
}

