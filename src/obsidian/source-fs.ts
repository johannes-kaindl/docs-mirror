import { Platform } from "obsidian";
import type { SourceEntry, SourcePort } from "../core/scan";

/** Das Teilstück von `node:fs/promises`, das die Quelle braucht. */
interface FsLike {
  readdir(path: string): Promise<string[]>;
  lstat(path: string): Promise<{ size: number; mtimeMs: number; isFile(): boolean; isDirectory(): boolean; isSymbolicLink(): boolean }>;
  readFile(path: string): Promise<Uint8Array>;
}
interface PathLike { join(...parts: string[]): string }

function nodeModules(): { fs: FsLike; path: PathLike } {
  if (!Platform.isDesktopApp) throw new Error("Docs Mirror reads the source folder with Node.js and works on desktop only.");
  const req = (window as unknown as { require: (id: string) => unknown }).require;
  return { fs: (req("fs") as { promises: FsLike }).promises, path: req("path") as PathLike };
}

/** Quelle über das Dateisystem (lazy `require`, nur Desktop). `lstat`, damit Symlinks als `symlink` erscheinen
 *  und der Scan sie überspringt. `rel` ist relativ zur Wurzel, `""` ist die Wurzel. */
export function createSourcePort(root: string): SourcePort & { readFile(rel: string): Promise<Uint8Array> } {
  return {
    async readdir(rel) {
      const { fs, path } = nodeModules();
      const dir = path.join(root, rel);
      const out: SourceEntry[] = [];
      for (const name of await fs.readdir(dir)) {
        const st = await fs.lstat(path.join(dir, name));
        const kind: SourceEntry["kind"] = st.isSymbolicLink() ? "symlink" : st.isDirectory() ? "dir" : st.isFile() ? "file" : "other";
        out.push({ name, kind, size: st.size, mtime: Math.floor(st.mtimeMs) });
      }
      return out;
    },
    async readFile(rel) {
      const { fs, path } = nodeModules();
      return new Uint8Array(await fs.readFile(path.join(root, rel)));
    },
  };
}
