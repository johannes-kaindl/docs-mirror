import { sha256Hex } from "../vendor/kit/sha256";
import type { Manifest, ManifestEntry } from "./manifest";
import { foldKey as fold, type ScanResult, type SourceFile } from "./scan";

/** Der Vault, in den gespiegelt wird (Adapter der Vault-API). Pfade sind relativ zum Zielordner, `/`-getrennt.
 *  `list` liefert alle Dateien (keine Ordner) unterhalb des Zielordners, so wie das Dateisystem sie nennt
 *  (also unter Umständen NFD oder mit anderer Schreibweise). `stat` liefert `null`, wenn nichts am Pfad liegt. */
export interface VaultPort {
  list(): Promise<string[]>;
  stat(path: string): Promise<{ kind: "file" | "folder"; size: number; mtime: number } | null>;
  read(path: string): Promise<Uint8Array>;
  writeTemp(name: string, data: Uint8Array, mtime: number): Promise<void>;
  replace(tempName: string, path: string): Promise<void>;
  remove(path: string): Promise<void>;
  mkdirp(dir: string): Promise<void>;
  removeIfEmpty(dir: string): Promise<void>;
  clearTemp(): Promise<void>;
}

export type PlanClass = "new" | "changed" | "unchanged" | "delete" | "vault-modified" | "conflict" | "vault-only";

export interface PlanItem {
  /** NFC, relativ zum Zielordner. Bei `case-collision` aus dem Scan der Originalname der Quelle. */
  path: string;
  cls: PlanClass;
  src?: SourceFile;
  /** `delete`: der Eintrag, der entfällt. `unchanged`: der Eintrag, der ins Manifest gehört (neu aufgenommen oder
   *  nachgezogen). Sonst der bisherige Eintrag, falls vorhanden. */
  entry?: ManifestEntry;
  /** `new`: `vault-missing` = Manifest ja, Quelle ja, Vault-Datei fehlt. `conflict`: `type-change` = am Zielpfad liegt
   *  ein Ordner, `case-collision` = anderer Name derselben Faltung (Groß-/Kleinschreibung, NFC). */
  reason?: "vault-missing" | "type-change" | "case-collision" | "unreadable" | "orphan-modified";
  /** Echter Name der vorgefundenen Vault-Datei (so, wie list/stat ihn liefern), gesetzt bei delete, changed,
   *  vault-modified, conflict und vault-only/orphan-modified. Task 8 ruft damit remove/replace auf, nicht mit `path`. */
  vaultPath?: string;
}

export interface Plan {
  items: PlanItem[];
  counts: Record<PlanClass, number>;
  /** Bytes, die der Lauf ohne Klick schreiben würde: Quellgröße von `new`, `changed` und `vault-modified`
   *  (Fortschritt/Anzeige). `conflict` zählt NICHT, er wird erst auf ausdrücklichen Klick geschrieben. */
  totalBytes: number;
  /** Größe des gespiegelten Vaults nach dem Lauf: Summe von `src.size` über ALLE Items mit Quelle (new, changed,
   *  unchanged, vault-modified, conflict). Dagegen prüft `checkGuards` die Gesamtgröße. */
  mirrorBytes: number;
  skipped: ScanResult["skipped"];
  sourceState: ScanResult["state"];
  /** Manifest-Einträge unter einem nicht lesbaren Quellordner: weder gelöscht noch geprüft, bleiben im Manifest. */
  unchecked: number;
  /** Pfade von Manifest-Einträgen, die still entfallen (Quelle weg und Vault-Datei weg, oder Datei im Vault
   *  verändert und deshalb behalten als vault-only/orphan-modified); kein `delete`. */
  forget: string[];
}

const nfc = (s: string): string => s.normalize("NFC");
const emptyCounts = (): Record<PlanClass, number> => ({
  new: 0, changed: 0, unchanged: 0, delete: 0, "vault-modified": 0, conflict: 0, "vault-only": 0,
});
const hashOf = (b: Uint8Array): string => sha256Hex(b);
const underPrefix = (path: string, prefix: string): boolean => path === prefix || path.startsWith(`${prefix}/`);

/** Bildet den Plan rein aus Scan, Manifest und Vault. Liest Vault-Dateien nur, wenn Größe oder Zeit vom Manifest
 *  abweichen (oder am Zielpfad eine fremde Datei liegt); Quelldateien nur bei gleicher Größe und anderer Zeit.
 *  Schreibt nichts. */
export async function buildPlan(input: {
  scan: ScanResult;
  manifest: Manifest;
  vault: VaultPort;
  readSource: (path: string) => Promise<Uint8Array>;
}): Promise<Plan> {
  const { scan, manifest, vault, readSource } = input;
  const items: PlanItem[] = [];
  const forget: string[] = [];
  let unchecked = 0;

  /** Hash der Quelldatei; `null`, wenn sie sich nicht lesen lässt (EACCES, verschwunden): die Datei wird ein Konflikt
   *  `unreadable`, der Plan bricht nicht ab. */
  const sourceHash = async (path: string): Promise<string | null> => {
    try { return hashOf(await readSource(path)); } catch { return null; }
  };

  const byFold = new Map<string, string[]>();
  for (const real of await vault.list()) {
    const k = fold(real);
    byFold.set(k, [...(byFold.get(k) ?? []), real]);
  }
  const handled = new Set<string>();
  const lookup = (path: string): { exact?: string; other: string[] } => {
    const cands = byFold.get(fold(path)) ?? [];
    const exact = cands.find((c) => nfc(c) === path);
    return { exact, other: cands.filter((c) => c !== exact) };
  };

  // Kollisionen: Mitglieder sind Konflikte, zugehörige Manifest-Einträge bleiben unberührt.
  const collisionKeys = new Set<string>();
  for (const group of scan.collisions) {
    for (const member of group) {
      collisionKeys.add(fold(member));
      items.push({ path: member, cls: "conflict", reason: "case-collision" });
    }
  }
  for (const k of collisionKeys) for (const real of byFold.get(k) ?? []) handled.add(real);

  const sourceKeys = new Set(scan.files.map((f) => fold(f.path)));

  for (const src of scan.files) {
    const path = src.path;
    const old = manifest[path];
    const { exact, other } = lookup(path);
    for (const o of other) handled.add(o);

    if (exact === undefined && other.length > 0) {
      items.push({ path, cls: "conflict", src, entry: old, reason: "case-collision", vaultPath: other[0] });
      continue;
    }
    const st = await vault.stat(exact ?? path);
    if (st !== null && st.kind === "folder") {
      items.push({ path, cls: "conflict", src, entry: old, reason: "type-change" });
      continue;
    }
    if (st === null) {
      items.push(old ? { path, cls: "new", src, entry: old, reason: "vault-missing" } : { path, cls: "new", src });
      continue;
    }
    // list kann eine Datei verschweigen, die stat findet: sie zählt wie ein Treffer in list.
    const real = exact ?? path;
    handled.add(real);

    if (!old) {
      // Fremde Datei am Zielpfad: gleiche Größe wie die Quelle ist Voraussetzung für gleichen Inhalt.
      if (st.size !== src.size) {
        items.push({ path, cls: "conflict", src, vaultPath: real });
        continue;
      }
      const vh = hashOf(await vault.read(real));
      const sh = await sourceHash(path);
      if (sh === null) {
        items.push({ path, cls: "conflict", src, vaultPath: real, reason: "unreadable" });
        continue;
      }
      if (vh === sh) {
        const adopted: ManifestEntry = { path, srcSize: src.size, srcMtime: src.mtime, size: st.size, mtime: st.mtime, hash: vh };
        items.push({ path, cls: "unchanged", src, entry: adopted });
      } else items.push({ path, cls: "conflict", src, vaultPath: real });
      continue;
    }

    let current = old;
    if (st.size !== old.size || st.mtime !== old.mtime) {
      const vh = hashOf(await vault.read(real));
      if (vh !== old.hash) {
        items.push({ path, cls: "vault-modified", src, entry: old, vaultPath: real });
        continue;
      }
      current = { ...old, size: st.size, mtime: st.mtime };
    }
    if (src.size !== old.srcSize) {
      items.push({ path, cls: "changed", src, entry: old, vaultPath: real });
    } else if (src.mtime === old.srcMtime) {
      items.push({ path, cls: "unchanged", src, entry: current });
    } else {
      const sh = await sourceHash(path);
      if (sh === null) items.push({ path, cls: "conflict", src, entry: old, vaultPath: real, reason: "unreadable" });
      else if (sh !== old.hash) items.push({ path, cls: "changed", src, entry: old, vaultPath: real });
      else items.push({ path, cls: "unchanged", src, entry: { ...current, srcSize: src.size, srcMtime: src.mtime } });
    }
  }

  // Manifest-Einträge ohne Quelle: nur bei erreichbarer, nicht leerer Quelle kann etwas entfallen. Ein Eintrag, dessen
  // Faltung zu einer Quelldatei oder einem Kollisionsmitglied gehört (Case-Umbenennung), bleibt unberührt.
  for (const e of Object.values(manifest)) {
    const { exact } = lookup(e.path);
    if (exact !== undefined) handled.add(exact);
    const k = fold(e.path);
    if (sourceKeys.has(k) || collisionKeys.has(k)) continue;
    if (scan.state !== "ok") continue;
    if (scan.unreadable.some((u) => underPrefix(fold(e.path), fold(u)))) {
      unchecked++;
      continue;
    }
    const st = exact !== undefined ? await vault.stat(exact) : null;
    if (exact === undefined || st === null || st.kind !== "file") {
      forget.push(e.path);
      continue;
    }
    // Wie bei vault-modified: erst stat, nur bei Abweichung lesen und hashen.
    if (st.size !== e.size || st.mtime !== e.mtime) {
      if (hashOf(await vault.read(exact)) !== e.hash) {
        items.push({ path: e.path, cls: "vault-only", entry: e, reason: "orphan-modified", vaultPath: exact });
        forget.push(e.path);
        continue;
      }
    }
    items.push({ path: e.path, cls: "delete", entry: e, vaultPath: exact });
  }

  for (const reals of byFold.values()) {
    for (const real of reals) if (!handled.has(real)) items.push({ path: nfc(real), cls: "vault-only" });
  }

  items.sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
  forget.sort();
  const counts = emptyCounts();
  let totalBytes = 0;
  let mirrorBytes = 0;
  for (const it of items) {
    counts[it.cls]++;
    if (it.src) mirrorBytes += it.src.size;
    if (it.src && (it.cls === "new" || it.cls === "changed" || it.cls === "vault-modified")) totalBytes += it.src.size;
  }
  return { items, counts, totalBytes, mirrorBytes, skipped: scan.skipped, sourceState: scan.state, unchecked, forget };
}
