import { foldCase } from "../vendor/kit/fold-case";

/** Wo der Vault zur Quellwurzel liegt. `below`: unterhalb der Wurzel (`rel` relativ zur Wurzel, NFC, `/`-getrennt);
 *  `same`: der Vault ist die Wurzel; `outside`: weder noch (oder der Basispfad ist unbekannt). */
export type VaultLocation = { kind: "outside" } | { kind: "same" } | { kind: "below"; rel: string };

const norm = (p: string): string => p.normalize("NFC").replace(/\\/g, "/").replace(/\/+$/, "");

/** Rein, ohne `fs`: vergleicht den Basispfad des Vaults mit der Wurzel (NFC, `\` wie `/`, ohne Unterschied der
 *  Schreibweise, nur ganze Segmente). Symlinks löst es nicht auf; das kann nur der Aufrufer mit dem Dateisystem. */
export function locateVault(root: string, vaultBase: string | null): VaultLocation {
  if (vaultBase === null || vaultBase.trim() === "") return { kind: "outside" };
  const r = norm(root).split("/");
  const v = norm(vaultBase).split("/");
  // Segmentweise, damit eine Faltung, die die Länge ändert (ß → ss), die Schnittstelle nicht verschiebt.
  if (v.length < r.length || !r.every((seg, i) => foldCase(seg) === foldCase(v[i]))) return { kind: "outside" };
  if (v.length === r.length) return { kind: "same" };
  return { kind: "below", rel: v.slice(r.length).join("/") };
}
