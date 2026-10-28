/** In-Memory-`DataAdapter` mit dem Verhalten, das die Adapter-Messung (docs/ADAPTER-MESSUNG.md, Obsidian 1.15.0) ergab:
 *  `rename` wirft bei bestehendem Ziel und bei fehlendem Elternordner, `writeBinary` wirft ohne Elternordner,
 *  `remove` wirft bei fehlender Datei und auf einem Ordner, `rmdir(path, false)` wirft immer (auch auf einem leeren
 *  Ordner), `stat` liefert `null` bei fehlendem Pfad, `mkdir` legt tief an und verträgt einen vorhandenen Ordner.
 *  Einschränkung: `exists`/`stat` sind hier case- und NFD-sensitiv (APFS ist es nicht, siehe Messung).
 *  `onList(path, n)` wird bei jedem `list` mit der laufenden Nummer des Aufrufs für diesen Pfad gerufen, nach dem Berechnen der Antwort, vor ihrer Rückgabe
 *  (Hook, um zwischen zwei Aufrufen eine Datei anzulegen).
 *  `calls` hält jeden Aufruf in Reihenfolge (`op:arg`). */
export interface FakeAdapter {
  calls: string[];
  onList?: (path: string, n: number) => void;
  files: Map<string, { data: Uint8Array; mtime: number }>;
  folders: Set<string>;
  exists(p: string): Promise<boolean>;
  stat(p: string): Promise<{ type: "file" | "folder"; size: number; mtime: number; ctime: number } | null>;
  list(p: string): Promise<{ files: string[]; folders: string[] }>;
  readBinary(p: string): Promise<ArrayBuffer>;
  writeBinary(p: string, data: ArrayBuffer, opts?: { mtime?: number }): Promise<void>;
  mkdir(p: string): Promise<void>;
  remove(p: string): Promise<void>;
  rename(from: string, to: string): Promise<void>;
  rmdir(p: string, recursive: boolean): Promise<void>;
}

const parentOf = (p: string): string => p.split("/").slice(0, -1).join("/");

export function fakeAdapter(seed: { files?: Record<string, string>; folders?: string[] } = {}): FakeAdapter {
  const calls: string[] = [];
  const listCount = new Map<string, number>();
  const files = new Map<string, { data: Uint8Array; mtime: number }>();
  const folders = new Set<string>([""]);
  const enc = new TextEncoder();
  const mk = (dir: string): void => {
    const parts = dir === "" ? [] : dir.split("/");
    for (let i = 1; i <= parts.length; i++) folders.add(parts.slice(0, i).join("/"));
  };
  for (const f of seed.folders ?? []) mk(f);
  for (const [p, c] of Object.entries(seed.files ?? {})) {
    mk(parentOf(p));
    files.set(p, { data: enc.encode(c), mtime: 1000 });
  }
  const children = (dir: string): { files: string[]; folders: string[] } => {
    const prefix = dir === "" ? "" : `${dir}/`;
    const direct = (p: string): boolean => p.startsWith(prefix) && p !== dir && !p.slice(prefix.length).includes("/");
    return { files: [...files.keys()].filter(direct).sort(), folders: [...folders].filter((f) => f !== "" && direct(f)).sort() };
  };
  const buf = (d: Uint8Array): ArrayBuffer => d.buffer.slice(d.byteOffset, d.byteOffset + d.byteLength) as ArrayBuffer;
  return {
    calls, files, folders,
    exists(p) { calls.push(`exists:${p}`); return Promise.resolve(files.has(p) || folders.has(p)); },
    stat(p) {
      calls.push(`stat:${p}`);
      const f = files.get(p);
      if (f) return Promise.resolve({ type: "file" as const, size: f.data.byteLength, mtime: f.mtime, ctime: f.mtime });
      if (folders.has(p)) return Promise.resolve({ type: "folder" as const, size: 0, mtime: 0, ctime: 0 });
      return Promise.resolve(null);
    },
    list(p) {
      calls.push(`list:${p}`);
      listCount.set(p, (listCount.get(p) ?? 0) + 1);
      if (!folders.has(p)) return Promise.reject(new Error(`ENOENT: scandir ${p}`));
      const res = children(p);
      this.onList?.(p, listCount.get(p) ?? 0);
      return Promise.resolve(res);
    },
    readBinary(p) {
      calls.push(`readBinary:${p}`);
      const f = files.get(p);
      return f ? Promise.resolve(buf(f.data)) : Promise.reject(new Error(`ENOENT: open ${p}`));
    },
    writeBinary(p, data, opts) {
      calls.push(`writeBinary:${p}`);
      if (!folders.has(parentOf(p))) return Promise.reject(new Error(`ENOENT: open ${p}`));
      files.set(p, { data: new Uint8Array(data.slice(0)), mtime: opts?.mtime ?? 5000 });
      return Promise.resolve();
    },
    mkdir(p) { calls.push(`mkdir:${p}`); mk(p); return Promise.resolve(); },
    remove(p) {
      calls.push(`remove:${p}`);
      if (folders.has(p)) return Promise.reject(new Error(`EPERM: unlink ${p}`));
      if (!files.delete(p)) return Promise.reject(new Error(`ENOENT: unlink ${p}`));
      return Promise.resolve();
    },
    rename(from, to) {
      calls.push(`rename:${from}>${to}`);
      const f = files.get(from);
      if (!f) return Promise.reject(new Error(`ENOENT: rename ${from}`));
      if (files.has(to) || folders.has(to)) return Promise.reject(new Error("Destination file already exists!"));
      if (!folders.has(parentOf(to))) return Promise.reject(new Error(`ENOENT: rename ${to}`));
      files.delete(from);
      files.set(to, f);
      return Promise.resolve();
    },
    rmdir(p, recursive) {
      calls.push(`rmdir:${p}:${recursive}`);
      if (!recursive) return Promise.reject(new Error(`Path is a directory: rm returned EISDIR ${p}`));
      for (const k of [...files.keys()]) if (k.startsWith(`${p}/`)) files.delete(k);
      for (const k of [...folders]) if (k === p || k.startsWith(`${p}/`)) folders.delete(k);
      return Promise.resolve();
    },
  };
}
