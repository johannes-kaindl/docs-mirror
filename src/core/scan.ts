import { matchIgnore, parsePatterns, type IgnoreRule } from "../vendor/kit/ignore";
import type { DocsMirrorSettings } from "./settings";

export interface SourceEntry {
  name: string;
  kind: "file" | "dir" | "symlink" | "other";
  size: number;
  mtime: number;
}

/** Liest einen Ordner der Quelle (`rel` relativ zur Wurzel, "" = Wurzel); wirft, wenn `rel` fehlt. */
export interface SourcePort {
  readdir(rel: string): Promise<SourceEntry[]>;
}

export interface SourceFile {
  /** Relativ zur Wurzel, `/`-getrennt, NFC. */
  path: string;
  size: number;
  mtime: number;
}

export interface ScanResult {
  /** `unreachable`: Wurzel nicht lesbar; `empty`: Wurzel lesbar, aber nichts zu spiegeln (Löschschutz). */
  state: "ok" | "unreachable" | "empty";
  files: SourceFile[];
  skipped: { symlinks: number; tooBig: number; otherType: number };
  /** Gruppen von Pfaden, die dasselbe Ziel ergäben (alle Mitglieder, keiner gewinnt). Die Mitglieder tragen die
   *  ORIGINALNAMEN der Quelle (vor NFC), damit eine NFD/NFC-Kollision im selben Ordner zwei unterscheidbare Pfade zeigt.
   *  Task 6 vergleicht zum Abgleich mit NFC und Kleinschreibung. */
  collisions: string[][];
  /** Ordner, deren `readdir` geworfen hat (NFC-Pfad). */
  unreadable: string[];
  /** true, sobald `unreadable` nicht leer ist. Task 6 darf bei incomplete keine Löschung ableiten;
   *  Manifest-Einträge unter einem unreadable-Präfix gelten als „nicht geprüft“. */
  incomplete: boolean;
  /** Muster, die die Kit-Engine nicht liest; der Scan läuft ohne sie weiter. */
  invalidPatterns: string[];
}

const nfc = (s: string): string => s.normalize("NFC");
/** Faltungsschlüssel für Kollisionen: NFC, dann klein, groß, klein. NFC im Schlüssel ist bewusst redundant zu `walk`
 *  (Defense in Depth): die Kollisionslogik soll auch dann halten, wenn ein Aufrufer Rohpfade übergibt.
 *
 *  Warum die Dreifachfaltung: reines Kleinschreiben übersieht Paare, die case-insensitive Dateisysteme gleich behandeln
 *  (Messung in der Gesamt-Review: s/ſ, σ/ς, ß/ẞ kollidierten nicht). Der Hin-und-zurück-Weg über Großbuchstaben ist eine
 *  Obermenge der bisherigen Faltung und der des Kits. Zu viel falten kostet nur mehr `case-collision`-Konflikte (ss/ß und
 *  fi/ﬁ fallen bewusst zusammen), nie eine Löschung: gelöscht wird nur bei exakt gleichem NFC-Namen. code-kit
 *  `filesystemPath` faltet genauso, bringt aber NFKC und Windows-Regeln mit und hat eine ẞ-Lücke; die Extraktion einer
 *  gemeinsamen `foldCase` ist Folgearbeit des Masters. */
export const foldKey = (s: string): string => nfc(s).toLowerCase().toUpperCase().toLowerCase();
const join = (dir: string, name: string): string => (dir === "" ? name : `${dir}/${name}`);

function extOf(name: string): string {
  const i = name.lastIndexOf(".");
  return i < 0 ? "" : name.slice(i + 1).toLowerCase();
}

export interface ScanOptions {
  /** Pfade relativ zur Wurzel (`/`-getrennt), deren Teilbaum der Scan nie betritt (z. B. der Vault, wenn er unter der
   *  Wurzel liegt, sonst läse der nächste Lauf die Spiegelkopien als Quelle). Vergleich NFC und gefaltet, nur ganze Segmente. */
  skipPaths?: string[];
}

/** Tiefensuche: Ordner werden gegen die Muster geprüft, bevor ihr Inhalt gelesen wird; unterhalb eines
 *  Treffers wird nicht erneut gematcht. `tick` läuft am Ende jeder Iteration (ohne `continue`). */
export async function scanSource(
  port: SourcePort,
  s: DocsMirrorSettings,
  tick?: () => Promise<void>,
  options: ScanOptions = {},
): Promise<ScanResult> {
  const skipKeys = new Set((options.skipPaths ?? []).filter((p) => p !== "").map(foldKey));
  const parsed = parsePatterns(s.patterns.join("\n"));
  const rules: IgnoreRule[] = parsed.rules;
  const excluded = new Set(s.excludedNames.map(nfc));
  const extensions = new Set(s.extensions.map((e) => e.toLowerCase()));
  const result: ScanResult = {
    state: "ok",
    files: [],
    skipped: { symlinks: 0, tooBig: 0, otherType: 0 },
    collisions: [],
    unreadable: [],
    incomplete: false,
    invalidPatterns: parsed.invalid,
  };

  const collected: { file: SourceFile; raw: string }[] = [];

  async function walk(dir: string, rawDir: string, inMatch: boolean, preloaded?: SourceEntry[]): Promise<void> {
    let entries: SourceEntry[];
    try {
      entries = preloaded ?? (await port.readdir(dir));
    } catch {
      result.unreadable.push(dir);
      return;
    }
    entries = [...entries].sort((a, b) => (nfc(a.name) < nfc(b.name) ? -1 : nfc(a.name) > nfc(b.name) ? 1 : 0));

    for (const entry of entries) {
      const name = nfc(entry.name);
      const path = join(dir, name);
      const rawPath = join(rawDir, entry.name);
      const skip = excluded.has(name) || skipKeys.has(foldKey(path)) || (entry.kind === "dir" && name.startsWith(".") && !s.includeDotFolders);
      const isMatch = !inMatch && entry.kind !== "file" && matchIgnore(rules, path) !== null;
      // Ausgeschlossene Einträge bleiben in der Schleife, damit `tick` auch für sie läuft.
      if (skip) {
        // nichts zu tun
      } else if (entry.kind === "symlink") {
        if (inMatch || isMatch) result.skipped.symlinks++;
      } else if (entry.kind === "other") {
        if (inMatch) result.skipped.otherType++;
      } else if (entry.kind === "file") {
        if (inMatch) {
          if (!extensions.has(extOf(name))) result.skipped.otherType++;
          else if (entry.size > s.maxFileBytes) result.skipped.tooBig++;
          else collected.push({ file: { path, size: entry.size, mtime: entry.mtime }, raw: rawPath });
        }
      } else {
        await walk(path, rawPath, inMatch || isMatch);
      }
      if (tick) await tick();
    }
  }

  let rootEntries: SourceEntry[];
  try {
    rootEntries = await port.readdir("");
  } catch {
    result.state = "unreachable";
    return result;
  }
  await walk("", "", false, rootEntries);
  result.incomplete = result.unreadable.length > 0;

  // Kollisionen über die ganzen Zielpfade der gesammelten Dateien (fängt Datei- und Ordnerebene).
  const groups = new Map<string, { file: SourceFile; raw: string }[]>();
  for (const c of collected) {
    const k = foldKey(c.file.path);
    groups.set(k, [...(groups.get(k) ?? []), c]);
  }
  for (const members of groups.values()) {
    if (members.length > 1) result.collisions.push(members.map((m) => m.raw));
    else result.files.push(members[0].file);
  }
  if (result.files.length === 0) result.state = "empty";
  return result;
}
