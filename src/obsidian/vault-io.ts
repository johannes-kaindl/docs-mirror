import type { App } from "obsidian";
import type { VaultPort } from "../core/plan";

/** Präfix der Temp-Namen, die `applyPlan` vergibt (`.dmr-tmp-N`); solche Namen ohne `/` liegen im Temp-Verzeichnis. */
const TEMP_PREFIX = ".dmr-tmp-";

const isTempName = (p: string): boolean => p.startsWith(TEMP_PREFIX) && !p.includes("/");

function toArrayBuffer(data: Uint8Array): ArrayBuffer {
  return data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength) as ArrayBuffer;
}

/** `VaultPort` über `app.vault.adapter` (nie TFile/Vault-Index). `tempDir` liegt unter `configDir`, damit die
 *  Temp-Dateien nicht im Vault-Index und nicht im Sync-Umfang stehen.
 *
 *  Gemessen (docs/ADAPTER-MESSUNG.md): `rename` wirft bei bestehendem Ziel und bei fehlendem Elternordner,
 *  `remove` wirft bei fehlender Datei und auf einem Ordner, `rmdir(path, false)` wirft auch auf einem leeren
 *  Ordner. Deshalb: `replace` = vorhandenes Ziel entfernen + `rename`, `remove` ist idempotent,
 *  `removeIfEmpty` prüft per `list` und räumt dann mit `rmdir(path, true)`. */
export function createVaultPort(app: App, tempDir: string): VaultPort {
  const adapter = app.vault.adapter;
  const configDir = app.vault.configDir;
  const real = (p: string): string => (isTempName(p) ? `${tempDir}/${p}` : p);

  async function walk(dir: string, out: string[]): Promise<void> {
    const l = await adapter.list(dir);
    out.push(...l.files.filter((f) => f !== configDir && !f.startsWith(`${configDir}/`)));
    for (const sub of l.folders) {
      if (sub === configDir) continue;
      await walk(sub, out);
    }
  }

  return {
    async list() {
      const out: string[] = [];
      await walk("", out);
      return out.sort();
    },
    async stat(path) {
      const s = await adapter.stat(real(path));
      if (!s) return null;
      return { kind: s.type === "folder" ? "folder" : "file", size: s.size ?? 0, mtime: s.mtime ?? 0 };
    },
    async read(path) {
      return new Uint8Array(await adapter.readBinary(real(path)));
    },
    async writeTemp(name, data, mtime) {
      await adapter.mkdir(tempDir);
      await adapter.writeBinary(real(name), toArrayBuffer(data), { mtime });
    },
    async replace(tempName, path) {
      if (await adapter.exists(path)) await adapter.remove(path);
      await adapter.rename(real(tempName), path);
    },
    async remove(path) {
      const p = real(path);
      if (await adapter.exists(p)) await adapter.remove(p);
    },
    async mkdirp(dir) {
      await adapter.mkdir(dir);
    },
    async removeIfEmpty(dir) {
      const s = await adapter.stat(dir);
      if (s?.type !== "folder") return;
      const l = await adapter.list(dir);
      if (l.files.length === 0 && l.folders.length === 0) await adapter.rmdir(dir, true);
    },
    async clearTemp() {
      if (!(await adapter.exists(tempDir))) return;
      const l = await adapter.list(tempDir);
      for (const f of l.files) await adapter.remove(f);
    },
  };
}
