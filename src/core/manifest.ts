import { checkRelPath } from "../vendor/kit/rel-path";

/** Gerätelokales Manifest: was das Plugin gespiegelt hat. Nur Einträge darin darf das Plugin löschen. */
export interface ManifestEntry {
  /** Pfad im Vault (relativ zum Zielordner), gleich dem Schlüssel. */
  path: string;
  srcSize: number;
  srcMtime: number;
  size: number;
  mtime: number;
  hash: string;
}

export type Manifest = Record<string, ManifestEntry>;

function count(x: unknown): x is number {
  return typeof x === "number" && Number.isFinite(x) && x >= 0;
}

function isEntry(key: string, e: unknown): e is ManifestEntry {
  if (typeof e !== "object" || e === null || Array.isArray(e)) return false;
  const o = e as Record<string, unknown>;
  return (
    typeof o.path === "string" && o.path !== "" && o.path === key &&
    key !== "__proto__" && checkRelPath(o.path).ok && o.path === o.path.normalize("NFC") &&
    count(o.srcSize) && count(o.srcMtime) && count(o.size) && count(o.mtime) &&
    typeof o.hash === "string" && o.hash !== ""
  );
}

/** Defekte Einträge werden verworfen und gezählt; wirft nie. */
export function parseManifest(raw: unknown): { manifest: Manifest; dropped: number } {
  const manifest: Manifest = {};
  let dropped = 0;
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) return { manifest, dropped };
  for (const [key, e] of Object.entries(raw)) {
    if (isEntry(key, e)) {
      manifest[key] = { path: e.path, srcSize: e.srcSize, srcMtime: e.srcMtime, size: e.size, mtime: e.mtime, hash: e.hash };
    } else dropped++;
  }
  return { manifest, dropped };
}
