import type { App } from "obsidian";
import type { VaultPort } from "../core/plan";
import { foldCase } from "../vendor/kit/fold-case";
import { checkRelPath } from "../vendor/kit/rel-path";

/** Präfix der Temp-Namen, die `applyPlan` vergibt (`.dmr-tmp-N`); solche Namen ohne `/` liegen im Temp-Verzeichnis. */
const TEMP_PREFIX = ".dmr-tmp-";

/** Vorsicht: gilt für Namen ohne `/`. */
const isTempName = (p: string): boolean => p.startsWith(TEMP_PREFIX) && !p.includes("/");

function toArrayBuffer(data: Uint8Array): ArrayBuffer {
  return data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength) as ArrayBuffer;
}

/** `VaultPort` über `app.vault.adapter` (nie TFile/Vault-Index). `tempDir` liegt unter `configDir`, damit die
 *  Temp-Dateien nicht im Vault-Index und nicht im Sync-Umfang stehen.
 *
 *  Gemessen (docs/ADAPTER-MESSUNG.md): `rename` wirft bei bestehendem Ziel und bei fehlendem Elternordner,
 *  `remove` wirft bei fehlender Datei und auf einem Ordner, `rmdir(path, false)` wirft auch auf einem leeren
 *  Ordner. Deshalb: `replace` = nur `rename` (wirft bei vorhandenem Ziel; der Aufrufer entfernt das alte Ziel), `remove` ist idempotent,
 *  `removeIfEmpty` prüft per `list` und räumt dann mit `rmdir(path, true)`. */
export function createVaultPort(app: App, tempDir: string): VaultPort {
  const adapter = app.vault.adapter;
  const configDir = app.vault.configDir;

  // Das Temp-Verzeichnis ist das einzige, das `clearTemp` anfasst: es muss ein echter Unterpfad von configDir sein.
  const tc = checkRelPath(tempDir);
  if (!tc.ok || !tempDir.startsWith(`${configDir}/`)) {
    throw new Error(`docs-mirror: temp directory "${tempDir}" must be a relative path below ${configDir}/`);
  }

  /** Schranke für jeden Vault-Pfad vor einem Adapteraufruf: `..`, absolut, `\`, NUL, leer und `.`-Segmente wirft. */
  const safe = (p: string): string => {
    const r = checkRelPath(p);
    if (!r.ok) throw new Error(`docs-mirror: unsafe vault path "${p}" (${r.problem})`);
    return p;
  };
  // Gefaltet: auf einem case-insensitiven Dateisystem erreicht `.OBSIDIAN/x` dasselbe Verzeichnis.
  const configKey = foldCase(configDir);
  const underConfig = (p: string): boolean => { const k = foldCase(p); return k === configKey || k.startsWith(`${configKey}/`); };
  /** Zielpfad im Vault: wie `safe`, kein Wurzelname im Temp-Schema (der würde als Temp-Datei gelesen) und nie unter
   *  `configDir` (dort liegen Einstellungen und Plugins, die der Spiegel nicht anfasst). */
  const target = (p: string): string => {
    safe(p);
    if (isTempName(p)) throw new Error(`docs-mirror: "${p}" is reserved for temporary files`);
    if (underConfig(p)) throw new Error(`docs-mirror: refusing to write "${p}" (inside ${configDir})`);
    return p;
  };
  /** Temp-Namen laufen über ihre eigene Prüfung (Präfix, kein `/`), alles andere über `safe`. */
  const real = (p: string): string => (isTempName(p) ? `${tempDir}/${p}` : safe(p));
  const tempOnly = (name: string): string => {
    if (!isTempName(name)) throw new Error(`docs-mirror: "${name}" is not a temporary file name`);
    return `${tempDir}/${name}`;
  };

  async function walk(dir: string, out: string[]): Promise<void> {
    const l = await adapter.list(dir);
    out.push(...l.files.filter((f) => !underConfig(f)));
    for (const sub of l.folders) {
      if (underConfig(sub)) continue;
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
      const path = tempOnly(name);
      await adapter.mkdir(tempDir);
      await adapter.writeBinary(path, toArrayBuffer(data), { mtime });
    },
    async replace(tempName, path) {
      const to = target(path);
      const from = tempOnly(tempName);
      // Löscht nie selbst: `rename` wirft bei vorhandenem Ziel, und das ist gewollt (B1). Ein Ziel, das erst nach dem
      // Planen entstanden ist (fremde Datei), bleibt so unberührt; das Entfernen des alten Ziels besorgt `applyPlan`.
      await adapter.rename(from, to);
    },
    async remove(path) {
      const p = real(path);
      if (await adapter.exists(p)) await adapter.remove(p);
    },
    async mkdirp(dir) {
      await adapter.mkdir(target(dir));
    },
    async removeIfEmpty(dir) {
      target(dir);
      if (underConfig(dir)) throw new Error(`docs-mirror: refusing to remove "${dir}" (inside ${configDir})`);
      const s = await adapter.stat(dir);
      if (s?.type !== "folder") return;
      const isEmpty = async (): Promise<boolean> => {
        const l = await adapter.list(dir);
        return l.files.length === 0 && l.folders.length === 0;
      };
      if (!(await isEmpty())) return;
      // Zweite Prüfung unmittelbar vor dem rekursiven rmdir: hält das Fenster für eine neu angelegte Datei klein.
      if (!(await isEmpty())) return;
      await adapter.rmdir(dir, true);
    },
    async clearTemp() {
      if (!(await adapter.exists(tempDir))) return;
      const l = await adapter.list(tempDir);
      for (const f of l.files) {
        const base = f.slice(f.lastIndexOf("/") + 1);
        if (base.startsWith(TEMP_PREFIX)) await adapter.remove(f);
      }
    },
  };
}
