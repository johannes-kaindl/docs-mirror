import type { VaultPort } from "../../src/core/plan";

/** In-Memory-`VaultPort` für Plan-, Lauf- und Schreib-Tests.
 *
 *  Dateisystem-Realität (APFS): `caseInsensitive` und `normalizationInsensitive` lassen zwei Schreibweisen
 *  denselben Eintrag treffen, der gespeicherte Name bleibt wie zuerst angelegt (case-preserving).
 *  Zähler: `calls.read` / `calls.stat` (Pfade in Aufrufreihenfolge), `calls.ops` (alle schreibenden Aufrufe in
 *  Reihenfolge, z. B. `writeTemp:a.tmp`, `replace:a.tmp>docs/a.md`, `remove:docs/a.md`).
 *  Fehler einspeisen: `failOn(op, path?)` lässt jeden Aufruf von `op` (optional nur für diesen Pfad) ablehnen. */
export interface FakeVaultOptions {
  caseInsensitive?: boolean;
  normalizationInsensitive?: boolean;
  /** Pfade, die `list()` verschweigt, die aber per `stat`/`read` auffindbar sind (Lücke zwischen list und stat). */
  unlisted?: string[];
  /** `writeTemp` legt nur die ersten Bytes ab (Platte voll, Abbruch im Schreiben): die Temp-Prüfung muss das fangen. */
  truncateTemp?: boolean;
}

interface FileRec { name: string; data: Uint8Array; mtime: number }

const enc = new TextEncoder();
const toBytes = (c: string | Uint8Array): Uint8Array => (typeof c === "string" ? enc.encode(c) : c);

export interface FakeVault extends VaultPort {
  calls: { read: string[]; stat: string[]; ops: string[] };
  /** Jede Änderung am Ziel in Reihenfolge (`replace`): so lässt sich prüfen, dass nie ein unvollständiger Inhalt am Ziel lag. */
  writes: { path: string; data: Uint8Array }[];
  /** Legt eine Datei an (Elternordner entstehen mit). */
  put(path: string, content: string | Uint8Array, mtime?: number): void;
  /** Legt einen Ordner an. */
  putFolder(path: string): void;
  has(path: string): boolean;
  text(path: string): string | null;
  mtimeOf(path: string): number | null;
  tempNames(): string[];
  failOn(op: keyof VaultPort, path?: string): void;
  clearFailures(): void;
  resetCalls(): void;
}

export function fakeVault(opts: FakeVaultOptions = {}): FakeVault {
  const key = (p: string): string => {
    let k = p;
    if (opts.normalizationInsensitive) k = k.normalize("NFC");
    if (opts.caseInsensitive) k = k.toLocaleLowerCase("en");
    return k;
  };
  const files = new Map<string, FileRec>();
  const folders = new Map<string, string>();
  const temps = new Map<string, { data: Uint8Array; mtime: number }>();
  const failures: { op: string; path?: string }[] = [];
  const calls = { read: [] as string[], stat: [] as string[], ops: [] as string[] };
  const writes: { path: string; data: Uint8Array }[] = [];

  const maybeFail = (op: string, path: string): void => {
    if (failures.some((f) => f.op === op && (f.path === undefined || key(f.path) === key(path)))) {
      throw new Error(`EIO: ${op} ${path}`);
    }
  };
  const parentOf = (p: string): string => p.split("/").slice(0, -1).join("/");
  const ensureFolders = (dir: string): void => {
    const parts = dir === "" ? [] : dir.split("/");
    for (let i = 1; i <= parts.length; i++) {
      const d = parts.slice(0, i).join("/");
      if (!folders.has(key(d))) folders.set(key(d), d);
    }
  };

  return {
    calls,
    writes,
    put(path, content, mtime = 1000) {
      ensureFolders(parentOf(path));
      const existing = files.get(key(path));
      files.set(key(path), { name: existing?.name ?? path, data: toBytes(content), mtime });
    },
    putFolder(path) { ensureFolders(path); },
    has: (path) => files.has(key(path)),
    text: (path) => {
      const f = files.get(key(path));
      return f ? new TextDecoder().decode(f.data) : null;
    },
    mtimeOf: (path) => files.get(key(path))?.mtime ?? null,
    tempNames: () => [...temps.keys()],
    failOn(op, path) { failures.push({ op, path }); },
    clearFailures() { failures.length = 0; },
    resetCalls() { calls.read.length = 0; calls.stat.length = 0; calls.ops.length = 0; writes.length = 0; },

    list() {
      maybeFail("list", "");
      return Promise.resolve(
        [...files.values()].filter((f) => !opts.unlisted?.some((u) => key(u) === key(f.name))).map((f) => f.name).sort(),
      );
    },
    stat(path) {
      calls.stat.push(path);
      maybeFail("stat", path);
      const f = files.get(key(path));
      if (f) return Promise.resolve({ kind: "file" as const, size: f.data.byteLength, mtime: f.mtime });
      if (folders.has(key(path))) return Promise.resolve({ kind: "folder" as const, size: 0, mtime: 0 });
      const t = temps.get(path);
      if (t) return Promise.resolve({ kind: "file" as const, size: t.data.byteLength, mtime: t.mtime });
      return Promise.resolve(null);
    },
    read(path) {
      calls.read.push(path);
      maybeFail("read", path);
      const f = files.get(key(path));
      if (f) return Promise.resolve(f.data);
      const t = temps.get(path);
      return t ? Promise.resolve(t.data) : Promise.reject(new Error(`ENOENT: ${path}`));
    },
    writeTemp(name, data, mtime) {
      calls.ops.push(`writeTemp:${name}`);
      maybeFail("writeTemp", name);
      temps.set(name, { data: opts.truncateTemp ? data.slice(0, Math.max(0, data.byteLength - 1)) : data, mtime });
      return Promise.resolve();
    },
    replace(tempName, path) {
      calls.ops.push(`replace:${tempName}>${path}`);
      maybeFail("replace", path);
      const t = temps.get(tempName);
      if (!t) return Promise.reject(new Error(`ENOENT: ${tempName}`));
      if (folders.has(key(path))) return Promise.reject(new Error(`EISDIR: ${path}`));
      // Wie der echte Adapter (docs/ADAPTER-MESSUNG.md): `rename` wirft bei vorhandenem Ziel.
      if (files.has(key(path))) return Promise.reject(new Error(`Destination file already exists: ${path}`));
      files.set(key(path), { name: path, data: t.data, mtime: t.mtime });
      writes.push({ path, data: t.data });
      temps.delete(tempName);
      return Promise.resolve();
    },
    remove(path) {
      calls.ops.push(`remove:${path}`);
      maybeFail("remove", path);
      files.delete(key(path));
      temps.delete(path);
      return Promise.resolve();
    },
    mkdirp(dir) {
      calls.ops.push(`mkdirp:${dir}`);
      maybeFail("mkdirp", dir);
      ensureFolders(dir);
      return Promise.resolve();
    },
    removeIfEmpty(dir) {
      calls.ops.push(`removeIfEmpty:${dir}`);
      maybeFail("removeIfEmpty", dir);
      const prefix = key(dir) + "/";
      const used = [...files.keys(), ...folders.keys()].some((k) => k.startsWith(prefix));
      if (!used) folders.delete(key(dir));
      return Promise.resolve();
    },
    clearTemp() {
      calls.ops.push("clearTemp");
      maybeFail("clearTemp", "");
      temps.clear();
      return Promise.resolve();
    },
  };
}
