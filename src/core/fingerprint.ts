import { sha256HexUtf8 } from "../vendor/kit/sha256";
import type { DocsMirrorSettings } from "./settings";

/** Fingerabdruck der Einstellungen, die den Umfang der Spiegelung bestimmen (Spec § 3).
 *  Schwelle, Gesamtgröße und Start-Schalter fehlen mit Absicht: sie ändern nicht, was gespiegelt wird.
 *  `root` ist das Ergebnis von `validateRoot` (getrimmt, ohne Schrägstrich am Ende).
 *  Kanonisch: feste Schlüsselreihenfolge, Listen sortiert, JSON als Trenner-sichere Serialisierung. */
export function settingsFingerprint(s: DocsMirrorSettings, root: string): string {
  const canonical = JSON.stringify([
    ["root", root],
    ["patterns", s.patterns.slice().sort()],
    ["excludedNames", s.excludedNames.slice().sort()],
    ["extensions", s.extensions.slice().sort()],
    ["maxFileBytes", s.maxFileBytes],
    ["includeDotFolders", s.includeDotFolders],
  ]);
  return sha256HexUtf8(canonical);
}
