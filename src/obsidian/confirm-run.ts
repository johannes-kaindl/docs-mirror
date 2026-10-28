import type { App } from "obsidian";
import { t, tn } from "../i18n/strings";
import { getLang } from "../vendor/kit/i18n";
import { formatBytes } from "../vendor/kit/format-bytes";
import type { ConfirmReason } from "../core/guards";
import type { Plan, PlanClass } from "../core/plan";
import { guardTexts } from "../core/view-model";
import { confirmAction } from "../vendor/kit-obsidian/confirm";

/** Klassen, die die Bestätigung mit Zahl nennt (ohne Nullzeilen); unverändert und nur im Vault ändern nichts. */
const COUNTED: PlanClass[] = ["new", "changed", "delete", "vault-modified", "conflict"];

/** Die Bestätigung vor einem Lauf, der es braucht: die Gründe als Sätze, die Zahlen, die Zahl der Dateien, die der
 *  Mensch zum Überschreiben angekreuzt hat. `true` nur auf ausdrücklichen Klick; Esc und Schließen sind `false`. */
export function confirmRun(app: App, reasons: ConfirmReason[], plan: Plan, overwriteCount = 0): Promise<boolean> {
  const message = [...guardTexts(reasons)];
  for (const cls of COUNTED) if (plan.counts[cls] > 0) message.push(tn(`plan.${cls}`, plan.counts[cls]));
  const sep = getLang() === "de" ? "," : ".";
  message.push(t("plan.mirrorSize", { size: formatBytes(plan.mirrorBytes, { decimalSeparator: sep }) }));
  if (overwriteCount > 0) message.push(tn("confirm.overwrite", overwriteCount));
  return confirmAction(app, {
    title: t("confirm.title"),
    message,
    confirmLabel: t("view.runPlan"),
    cancelLabel: t("view.cancel"),
    // Löschen und Überschreiben sind die Wirkungen, die man nicht zurückholt: dann der destruktive Knopf.
    warning: plan.counts.delete > 0 || overwriteCount > 0,
  });
}
