import type { SourceEntry, SourcePort } from "../../src/core/scan";

/** Fake-Quelle für Scan-Tests.
 *
 *  `tree` bildet Pfade (relativ zur Wurzel, `/`) ab:
 *  - `string` = Datei, Größe = Länge des Strings in Bytes (UTF-8)
 *  - `number` = Datei dieser Größe in Bytes
 *  - `null`   = leerer Ordner (Elternordner entstehen implizit aus den Pfaden)
 *  Schreibweisen am Ende des Schlüssels: `name@` = Symlink (kein Verfolgen), `name?` = anderer Typ
 *  (Socket o. Ä.); das Zeichen gehört nicht zum Namen.
 *  Optionen: `mtimes` (Pfad ohne Suffix → mtime, sonst 1000), `failing` (Ordnerpfade, deren
 *  `readdir` wirft; "" = Wurzel), `missingRoot` (Wurzel existiert nicht). */
export interface FakeSourceOptions {
  mtimes?: Record<string, number>;
  failing?: string[];
  missingRoot?: boolean;
}

export function fakeSource(
  tree: Record<string, string | number | null>,
  opts: FakeSourceOptions = {},
): SourcePort {
  const children = new Map<string, Map<string, SourceEntry>>();
  const ensureDir = (dir: string): Map<string, SourceEntry> => {
    let m = children.get(dir);
    if (!m) {
      m = new Map();
      children.set(dir, m);
    }
    return m;
  };
  ensureDir("");
  const add = (parent: string, entry: SourceEntry): void => {
    const m = ensureDir(parent);
    if (!m.has(entry.name) || entry.kind !== "dir") m.set(entry.name, entry);
  };
  for (const [rawKey, value] of Object.entries(tree)) {
    let key = rawKey;
    let kind: SourceEntry["kind"] = value === null ? "dir" : "file";
    if (key.endsWith("@")) { kind = "symlink"; key = key.slice(0, -1); }
    else if (key.endsWith("?")) { kind = "other"; key = key.slice(0, -1); }
    const parts = key.split("/");
    for (let i = 0; i < parts.length - 1; i++) {
      add(parts.slice(0, i).join("/"), { name: parts[i], kind: "dir", size: 0, mtime: 1000 });
      ensureDir(parts.slice(0, i + 1).join("/"));
    }
    const name = parts[parts.length - 1];
    const size = typeof value === "string" ? Buffer.byteLength(value) : typeof value === "number" ? value : 0;
    add(parts.slice(0, -1).join("/"), { name, kind, size, mtime: opts.mtimes?.[key] ?? 1000 });
    if (kind === "dir") ensureDir(key);
  }
  return {
    readdir(rel: string): Promise<SourceEntry[]> {
      if (opts.failing?.includes(rel) || (rel === "" && opts.missingRoot)) {
        return Promise.reject(new Error(`ENOENT: ${rel}`));
      }
      const m = children.get(rel);
      if (!m) return Promise.reject(new Error(`ENOENT: ${rel}`));
      return Promise.resolve([...m.values()]);
    },
  };
}
