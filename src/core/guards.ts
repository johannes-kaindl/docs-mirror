import type { Plan } from "./plan";
import type { DocsMirrorSettings } from "./settings";

/** Reihenfolge ist Teil des Vertrags: die Vorschau zeigt die Gründe in dieser Folge. */
export type ConfirmReason = "first-run" | "threshold" | "settings-changed" | "total-size" | "conflicts";

export interface GuardResult {
  /** Gesetzt: der Lauf schreibt und löscht nichts (Löschschutz); `confirm` ist dann leer. */
  blocked: "source-unreachable" | "source-empty" | null;
  confirm: ConfirmReason[];
}

/** Prüft den Plan gegen die Sicherungen. `manifestSize` ist die Zahl der Manifest-Einträge vor dem Lauf. Eine
 *  unvollständige Quelle (`plan.unchecked`) braucht keinen eigenen Grund: die Vorschau nennt die Zahl, und der Plan
 *  leitet unter einem nicht lesbaren Ordner ohnehin keine Löschung ab. */
export function checkGuards(
  plan: Plan,
  ctx: { hadManifest: boolean; manifestSize: number; fingerprintChanged: boolean },
  s: DocsMirrorSettings,
): GuardResult {
  if (plan.sourceState === "unreachable") return { blocked: "source-unreachable", confirm: [] };
  if (plan.sourceState === "empty") return { blocked: "source-empty", confirm: [] };

  const confirm: ConfirmReason[] = [];
  if (!ctx.hadManifest) confirm.push("first-run");

  // Beide Bedingungen, jeweils "mindestens"; ganzzahlig gerechnet, damit 20 von 100 genau auf der Grenze trifft.
  const deletes = plan.counts.delete;
  if (
    deletes > 0 && ctx.manifestSize > 0 &&
    deletes >= s.deleteThresholdFiles &&
    deletes * 100 >= s.deleteThresholdPercent * ctx.manifestSize
  ) confirm.push("threshold");

  if (ctx.fingerprintChanged) confirm.push("settings-changed");
  if (plan.totalBytes > s.maxTotalBytes) confirm.push("total-size");
  if (plan.counts.conflict > 0) confirm.push("conflicts");
  return { blocked: null, confirm };
}
