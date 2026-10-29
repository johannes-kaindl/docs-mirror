import { Platform } from "obsidian";

/** Das Teilstück von `node:fs`, das die Pfadauflösung braucht. */
export interface RealpathFs { realpathSync(path: string): string }

/** Löst Wurzel und Vault-Basispfad über das Dateisystem auf (Symlinks, `/tmp` gegen `/private/tmp`, Schreibweise),
 *  damit der Kern sie als Text vergleichen kann. Wirft `realpath` (Pfad fehlt, kein Zugriff), bleibt dieser Pfad
 *  unverändert: der Scan meldet eine fehlende Wurzel selbst als unerreichbar, der Host wirft nicht. */
export function resolveRealPaths(
  root: string, vaultBase: string | null, fs: RealpathFs,
): { root: string; vaultBase: string | null } {
  const one = (p: string): string => { try { return fs.realpathSync(p); } catch { return p; } };
  return { root: one(root), vaultBase: vaultBase === null || vaultBase.trim() === "" ? vaultBase : one(vaultBase) };
}

/** Wie `resolveRealPaths` mit dem echten `fs` (lazy `require`, nur Desktop); mobil bleiben die Pfade unverändert. */
export function resolveRealPathsNode(root: string, vaultBase: string | null): { root: string; vaultBase: string | null } {
  if (!Platform.isDesktopApp) return { root, vaultBase };
  let fs: RealpathFs;
  try {
    const req = (window as unknown as { require: (id: string) => unknown }).require;
    fs = req("fs") as RealpathFs;
  } catch {
    return { root, vaultBase };
  }
  return resolveRealPaths(root, vaultBase, fs);
}
