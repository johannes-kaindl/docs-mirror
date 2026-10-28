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
  /** Gruppen von Pfaden, die dasselbe Ziel ergäben (alle Mitglieder, keiner gewinnt). */
  collisions: string[][];
  unreadable: string[];
  /** Muster, die die Kit-Engine nicht liest; der Scan läuft ohne sie weiter. */
  invalidPatterns: string[];
}

const nfc = (s: string): string => s.normalize("NFC");
const foldKey = (s: string): string => nfc(s).toLocaleLowerCase("en");
const join = (dir: string, name: string): string => (dir === "" ? name : `${dir}/${name}`);

function extOf(name: string): string {
  const i = name.lastIndexOf(".");
  return i < 0 ? "" : name.slice(i + 1).toLowerCase();
}

/** Tiefensuche: Ordner werden gegen die Muster geprüft, bevor ihr Inhalt gelesen wird; unterhalb eines
 *  Treffers wird nicht erneut gematcht. `tick` läuft am Ende jeder Iteration (ohne `continue`). */
export async function scanSource(
  port: SourcePort,
  s: DocsMirrorSettings,
  tick?: () => Promise<void>,
): Promise<ScanResult> {
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
    invalidPatterns: parsed.invalid,
  };

  async function walk(dir: string, inMatch: boolean, preloaded?: SourceEntry[]): Promise<void> {
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
      const skip = excluded.has(name) || (entry.kind === "dir" && name.startsWith(".") && !s.includeDotFolders);
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
          else result.files.push({ path, size: entry.size, mtime: entry.mtime });
        }
      } else {
        await walk(path, inMatch || isMatch);
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
  await walk("", false, rootEntries);

  // Kollisionen über die ganzen Zielpfade der gesammelten Dateien (fängt Datei- und Ordnerebene).
  const groups = new Map<string, SourceFile[]>();
  for (const f of result.files) {
    const k = foldKey(f.path);
    groups.set(k, [...(groups.get(k) ?? []), f]);
  }
  const colliding = new Set<SourceFile>();
  for (const members of groups.values()) {
    if (members.length > 1) {
      result.collisions.push([...new Set(members.map((m) => m.path))]);
      for (const m of members) colliding.add(m);
    }
  }
  if (colliding.size > 0) result.files = result.files.filter((f) => !colliding.has(f));
  if (result.files.length === 0) result.state = "empty";
  return result;
}
