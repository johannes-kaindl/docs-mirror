import { formatBytes } from "../vendor/kit/format-bytes";
import { getLang } from "../vendor/kit/i18n";
import { t, tn, type StringKey } from "../i18n/strings";
import type { ConfirmReason } from "./guards";
import type { Plan, PlanClass, PlanItem } from "./plan";
import type { RunCounts, RunInfo, RunStatus } from "./run-info";

/** Mehr Pfade zeigt eine Gruppe nie: eine Gruppe mit tausenden Pfaden friert die Ansicht sonst ein. */
export const MAX_PATHS_PER_GROUP = 200;

export type StatusIcon = "loader" | "circle-check" | "circle-x" | "alert-triangle";
export type StatusClass = "is-checking" | "is-ok" | "is-error" | "is-warning";
export type PrimaryAction = "sync" | "execute" | "cancel" | "settings";

export interface GroupRow {
  path: string;
  /** Begründung oder Hinweis zur Zeile (Text), sonst null. */
  note: string | null;
  /** Nur ein Konflikt ohne `reason` und mit Quelle darf auf ausdrücklichen Klick überschrieben werden. */
  overwritable: boolean;
}

export interface ViewGroup {
  cls: PlanClass;
  /** Zählform der Klasse, z. B. „2 new files“. */
  label: string;
  count: number;
  open: boolean;
  /** `nur im Vault` steht getrennt von den Gruppen, die der Lauf anfasst. */
  separate: boolean;
  hint: string | null;
  /** Höchstens `MAX_PATHS_PER_GROUP` Pfade; `rows` ist dieselbe Liste mit Notiz und Überschreibbarkeit. */
  paths: string[];
  rows: GroupRow[];
  /** „… und N weitere“, wenn gekappt wurde. */
  more: string | null;
}

export interface ViewModel {
  status: RunStatus;
  statusText: string;
  statusAria: string;
  statusIcon: StatusIcon;
  statusClass: StatusClass;
  lastRun: string | null;
  /** Die Überschrift der Ergebniskarte in zwei Teilen, damit die Ansicht die Zeitangabe als Ganzes umbrechen lässt. */
  lastRunLabel: string | null;
  lastRunTime: string | null;
  /** Die Karte des letzten Laufs ist nur sichtbar, solange kein Lauf läuft: sonst zeigte sie den vorigen Lauf neben dem laufenden. */
  showResult: boolean;
  lastError: string | null;
  counters: RunCounts | null;
  counterRows: { key: keyof RunCounts; label: string; value: number }[];
  hasPlan: boolean;
  groups: ViewGroup[];
  unchanged: number;
  notes: string[];
  reasons: string[];
  primary: PrimaryAction;
  primaryLabel: string;
  /** Zweiter Knopf neben „Plan ausführen“: neu planen. */
  secondary: "sync" | null;
  progress: { done: number; total: number | null } | null;
  progressText: string | null;
}

export interface ViewModelInput {
  status: RunStatus;
  last: RunInfo | null;
  plan: Plan | null;
  progress: { done: number; total: number | null } | null;
  waiting: boolean;
  reasons?: ConfirmReason[];
}

const STATUS_LOOK: Record<RunStatus, { icon: StatusIcon; cls: StatusClass; key: StringKey }> = {
  "not-configured": { icon: "alert-triangle", cls: "is-warning", key: "status.not-configured" },
  never: { icon: "alert-triangle", cls: "is-warning", key: "status.never" },
  running: { icon: "loader", cls: "is-checking", key: "status.running" },
  waiting: { icon: "alert-triangle", cls: "is-warning", key: "status.waiting" },
  unreachable: { icon: "circle-x", cls: "is-error", key: "status.unreachable" },
  error: { icon: "circle-x", cls: "is-error", key: "status.error" },
  current: { icon: "circle-check", cls: "is-ok", key: "status.current" },
};

/** Reihenfolge der Gruppen in der Vorschau; `unchanged` steht als Zahl, nicht als Gruppe. */
const GROUP_ORDER: PlanClass[] = ["new", "changed", "delete", "vault-modified", "conflict", "vault-only"];
const OPEN: ReadonlySet<PlanClass> = new Set<PlanClass>(["delete", "vault-modified"]);
/** Nur diese Schlüssel kann der Runner als Fehlertext eines Laufs speichern; alles andere (Altdaten, defekter Speicher) wird generisch. */
const KNOWN_ERRORS: ReadonlySet<string> = new Set(["status.unreachable", "notice.blocked.empty", "notice.failed", "notice.partial"]);
const COUNTER_KEYS: (keyof RunCounts)[] = ["created", "updated", "unchanged", "deleted", "overwritten", "skipped", "errors"];

const GROUP_HINT: Partial<Record<PlanClass, StringKey>> = {
  "vault-modified": "plan.hint.vault-modified",
  conflict: "plan.hint.conflict",
  "vault-only": "plan.hint.vault-only",
};

const GUARD_TEXT: Record<Exclude<ConfirmReason, "settings-changed">, StringKey> = {
  "first-run": "guard.first-run",
  threshold: "guard.threshold",
  "total-size": "guard.total-size",
  conflicts: "guard.conflicts",
};

/** Texte der Bestätigungsgründe für die Vorschau (die Bestätigung nennt dieselben Sätze, siehe `guardTexts`). */
function reasonText(r: ConfirmReason): string {
  return r === "settings-changed" ? t("plan.hint.settings-changed") : t(GUARD_TEXT[r]);
}

/** Die Gründe der Bestätigung als Sätze, in der Reihenfolge des Vertrags (`ConfirmReason`). */
export function guardTexts(reasons: ConfirmReason[]): string[] {
  return reasons.map((r) => t(`guard.${r}`));
}

function noteOf(it: PlanItem): string | null {
  if (it.reason !== undefined) return t(`plan.reason.${it.reason}`);
  return it.cls === "conflict" ? t("plan.reason.foreign") : null;
}

/** Die eine Regel, wer überschrieben werden darf: nur ein Konflikt ohne `reason` und mit Quelle, und nur auf Klick.
 *  `case-collision`, `type-change` und `unreadable` sind es nie. */
export function isOverwritable(it: PlanItem): boolean {
  return it.cls === "conflict" && it.reason === undefined && it.src !== undefined;
}

function rowOf(it: PlanItem): GroupRow {
  return { path: it.path, note: noteOf(it), overwritable: isOverwritable(it) };
}

function groupOf(cls: PlanClass, items: PlanItem[]): ViewGroup {
  const shown = items.slice(0, MAX_PATHS_PER_GROUP);
  const rest = items.length - shown.length;
  const hintKey = GROUP_HINT[cls];
  return {
    cls,
    label: tn(`plan.${cls}`, items.length),
    count: items.length,
    open: OPEN.has(cls),
    separate: cls === "vault-only",
    hint: hintKey === undefined ? null : t(hintKey),
    paths: shown.map((i) => i.path),
    rows: shown.map(rowOf),
    more: rest > 0 ? t("plan.more", { n: rest }) : null,
  };
}

function planParts(plan: Plan): { groups: ViewGroup[]; notes: string[] } {
  const groups: ViewGroup[] = [];
  for (const cls of GROUP_ORDER) {
    const items = plan.items.filter((i) => i.cls === cls);
    if (items.length > 0) groups.push(groupOf(cls, items));
  }
  const notes: string[] = [];
  if (plan.unchecked > 0) notes.push(tn("plan.unchecked", plan.unchecked));
  const sep = getLang() === "de" ? "," : ".";
  notes.push(t("plan.mirrorSize", { size: formatBytes(plan.mirrorBytes, { decimalSeparator: sep }) }));
  return { groups, notes };
}

function primaryOf(status: RunStatus, waiting: boolean): { primary: PrimaryAction; label: StringKey; secondary: "sync" | null } {
  if (status === "running") return { primary: "cancel", label: "view.cancel", secondary: null };
  if (status === "not-configured") return { primary: "settings", label: "view.openSettings", secondary: null };
  if (waiting) return { primary: "execute", label: "view.runPlan", secondary: "sync" };
  return { primary: "sync", label: "view.syncNow", secondary: null };
}

/** Rein: Zustand rein, alles Sichtbare raus (UI-STANDARD §6). Die Ansicht entscheidet nichts. */
export function buildViewModel(input: ViewModelInput, fmt: { time(ms: number): string }): ViewModel {
  const look = STATUS_LOOK[input.status];
  const statusText = t(look.key);
  const last = input.last;
  const parts = input.plan === null ? { groups: [], notes: [] } : planParts(input.plan);
  const act = primaryOf(input.status, input.waiting);
  const progress = input.status === "running" ? input.progress : null;
  return {
    status: input.status,
    statusText,
    statusAria: t("view.statusAria", { status: statusText }),
    statusIcon: look.icon,
    statusClass: look.cls,
    lastRun: last === null ? null : `${t("view.lastRun")}: ${fmt.time(last.at)}`,
    lastRunLabel: last === null ? null : t("view.lastRun"),
    lastRunTime: last === null ? null : fmt.time(last.at),
    showResult: last !== null && input.status !== "running",
    lastError: last !== null && !last.ok && last.error !== undefined ? t(KNOWN_ERRORS.has(last.error) ? (last.error as StringKey) : "notice.failed") : null,
    counters: last === null ? null : last.counts,
    counterRows: last === null ? [] : COUNTER_KEYS.map((key) => ({ key, label: t(`count.${key}`), value: last.counts[key] })),
    hasPlan: input.plan !== null,
    groups: parts.groups,
    unchanged: input.plan === null ? 0 : input.plan.counts.unchanged,
    notes: parts.notes,
    reasons: (input.reasons ?? []).map(reasonText),
    primary: act.primary,
    primaryLabel: t(act.label),
    secondary: act.secondary,
    progress,
    progressText: progress === null ? null : progress.total === null ? t("view.scanning", { done: progress.done }) : t("view.progress", { done: progress.done, total: progress.total }),
  };
}
