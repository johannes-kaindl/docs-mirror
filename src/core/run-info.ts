export interface RunCounts {
  created: number;
  updated: number;
  unchanged: number;
  deleted: number;
  overwritten: number;
  skipped: number;
  errors: number;
}

export interface RunInfo {
  at: number;
  ok: boolean;
  error?: string;
  counts: RunCounts;
  fingerprint: string;
}

export type RunStatus = "not-configured" | "never" | "running" | "waiting" | "unreachable" | "error" | "current";

const COUNT_KEYS: (keyof RunCounts)[] = ["created", "updated", "unchanged", "deleted", "overwritten", "skipped", "errors"];

/** Liest die letzte Lauf-Info; bei jedem Defekt null (der Status fällt dann auf „nie gelaufen“). */
export function parseRunInfo(raw: unknown): RunInfo | null {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) return null;
  const o = raw as Record<string, unknown>;
  if (typeof o.at !== "number" || !Number.isFinite(o.at)) return null;
  if (typeof o.ok !== "boolean") return null;
  if (typeof o.fingerprint !== "string") return null;
  if (o.error !== undefined && typeof o.error !== "string") return null;
  const c = o.counts;
  if (typeof c !== "object" || c === null) return null;
  const cr = c as Record<string, unknown>;
  const counts = {} as RunCounts;
  for (const k of COUNT_KEYS) {
    const v = cr[k];
    if (typeof v !== "number" || !Number.isFinite(v) || v < 0) return null;
    counts[k] = v;
  }
  const info: RunInfo = { at: o.at, ok: o.ok, counts, fingerprint: o.fingerprint };
  if (typeof o.error === "string") info.error = o.error;
  return info;
}

/** Feste Reihenfolge: nicht eingerichtet, läuft, wartet, nicht erreichbar, nie gelaufen, Fehler, aktuell. */
export function statusOf(input: {
  configured: boolean;
  running: boolean;
  waiting: boolean;
  last: RunInfo | null;
  reachable: boolean;
}): RunStatus {
  if (!input.configured) return "not-configured";
  if (input.running) return "running";
  if (input.waiting) return "waiting";
  if (!input.reachable) return "unreachable";
  if (input.last === null) return "never";
  if (!input.last.ok) return "error";
  return "current";
}
