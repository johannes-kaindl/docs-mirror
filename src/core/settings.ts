import { mergeSettings } from "../vendor/kit/settings";

export interface DocsMirrorSettings {
  /** Glob-Muster relativ zur Wurzel, die Quellordner bestimmen (z. B. `**\/docs`). */
  patterns: string[];
  /** Ordner- und Dateinamen, die nie gespiegelt werden. */
  excludedNames: string[];
  /** Dateitypen ohne Punkt, klein. */
  extensions: string[];
  includeDotFolders: boolean;
  maxFileBytes: number;
  maxTotalBytes: number;
  /** Ab dieser Anzahl zu löschender Dateien UND dem Prozentwert wird gefragt. */
  deleteThresholdFiles: number;
  deleteThresholdPercent: number;
  syncOnStart: boolean;
}

export const DEFAULT_SETTINGS: DocsMirrorSettings = {
  patterns: ["**/docs"],
  excludedNames: ["node_modules", ".git", "dist", "build", "__pycache__", ".venv"],
  extensions: ["md", "canvas", "base", "png", "jpg", "jpeg", "gif", "svg", "webp", "pdf"],
  includeDotFolders: false,
  maxFileBytes: 5 * 1024 * 1024,
  maxTotalBytes: 1024 * 1024 * 1024,
  deleteThresholdFiles: 20,
  deleteThresholdPercent: 20,
  syncOnStart: false,
};

/** Trimmt, entfernt Leeres und Doppeltes, behält die Reihenfolge. */
function cleanItems(items: Iterable<string>): string[] {
  const out: string[] = [];
  for (const x of items) {
    const item = x.trim();
    if (item !== "" && !out.includes(item)) out.push(item);
  }
  return out;
}

/** Zeilen- oder kommagetrennter Text → getrimmte, eindeutige, nicht leere Einträge.
 *  Kommas innerhalb geschweifter Klammern trennen nicht (Brace-Globs wie `**\/{docs,doc}`). */
export function parseList(text: string): string[] {
  const parts: string[] = [];
  let depth = 0;
  let cur = "";
  for (const ch of text) {
    if (ch === "{") depth++;
    else if (ch === "}" && depth > 0) depth--;
    if (ch === "\n" || ch === "\r" || (ch === "," && depth === 0)) {
      parts.push(cur);
      cur = "";
      if (ch !== ",") depth = 0;
    } else cur += ch;
  }
  parts.push(cur);
  return cleanItems(parts);
}

function list(raw: unknown, fallback: string[]): string[] {
  if (!Array.isArray(raw)) return fallback.slice();
  const out = cleanItems(raw.filter((x): x is string => typeof x === "string"));
  return out.length > 0 ? out : fallback.slice();
}

function num(raw: unknown, fallback: number, min: number, max = Number.MAX_SAFE_INTEGER): number {
  return typeof raw === "number" && Number.isFinite(raw) && raw >= min && raw <= max ? raw : fallback;
}

function bool(raw: unknown, fallback: boolean): boolean {
  return typeof raw === "boolean" ? raw : fallback;
}

/** mergeSettings hebt fehlende Felder auf Defaults; danach prüft jedes Feld sich selbst,
 *  damit ein kaputtes Feld nur sich zurücksetzt (CORE-DATA-01). */
export function loadSettings(raw: unknown): DocsMirrorSettings {
  const merged = mergeSettings(DEFAULT_SETTINGS, raw);
  const d = DEFAULT_SETTINGS;
  return {
    ...merged,
    patterns: list(merged.patterns, d.patterns),
    excludedNames: list(merged.excludedNames, d.excludedNames),
    extensions: list(merged.extensions, d.extensions),
    includeDotFolders: bool(merged.includeDotFolders, d.includeDotFolders),
    maxFileBytes: num(merged.maxFileBytes, d.maxFileBytes, 1),
    maxTotalBytes: num(merged.maxTotalBytes, d.maxTotalBytes, 1),
    deleteThresholdFiles: num(merged.deleteThresholdFiles, d.deleteThresholdFiles, 0),
    deleteThresholdPercent: num(merged.deleteThresholdPercent, d.deleteThresholdPercent, 0, 100),
    syncOnStart: bool(merged.syncOnStart, d.syncOnStart),
  };
}

export type RootCheck = { ok: true; root: string } | { ok: false; problem: "empty" | "relative" | "tilde" };

/** Rein, ohne `fs`: trimmt, lehnt leer, `~` und relative Pfade ab, entfernt Trennzeichen am Ende. */
export function validateRoot(raw: string): RootCheck {
  const text = raw.trim();
  if (text === "") return { ok: false, problem: "empty" };
  if (text.startsWith("~")) return { ok: false, problem: "tilde" };
  const drive = /^[A-Za-z]:[\\/]/.test(text);
  if (!text.startsWith("/") && !drive) return { ok: false, problem: "relative" };
  const stripped = text.replace(/[\\/]+$/, "");
  const root = stripped === "" ? "/" : /^[A-Za-z]:$/.test(stripped) ? text.slice(0, 3) : stripped;
  return { ok: true, root };
}
