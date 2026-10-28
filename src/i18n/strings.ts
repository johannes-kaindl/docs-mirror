import { getLang } from "../vendor/kit/i18n";

/**
 * Alle Nutzertexte (UI-STANDARD §10). EN ist kanonisch, DE vollständig; die Schlüsselmengen
 * und Platzhalter prüft tests/strings.test.ts. Platzhalter sind benannt: {n}, {reason}, …
 * Zählformen: `<base>.one` bei genau 1, sonst `<base>.many`; `tn` wählt die Form.
 */
export const STRINGS = {
  en: {
    "status.not-configured": "Not set up",
    "status.never": "Never run",
    "status.running": "Running",
    "status.waiting": "Waiting for confirmation",
    "status.unreachable": "Source unreachable",
    "status.error": "Error",
    "status.current": "Up to date",

    "plan.new.one": "{n} new file",
    "plan.new.many": "{n} new files",
    "plan.changed.one": "{n} changed file",
    "plan.changed.many": "{n} changed files",
    "plan.unchanged.one": "{n} unchanged file",
    "plan.unchanged.many": "{n} unchanged files",
    "plan.delete.one": "{n} file to delete",
    "plan.delete.many": "{n} files to delete",
    "plan.vault-modified.one": "{n} file edited in the vault",
    "plan.vault-modified.many": "{n} files edited in the vault",
    "plan.conflict.one": "{n} conflict",
    "plan.conflict.many": "{n} conflicts",
    "plan.vault-only.one": "{n} file only in the vault",
    "plan.vault-only.many": "{n} files only in the vault",
    "plan.hint.vault-only": "Files that exist only in the vault are never touched.",
    "plan.hint.settings-changed": "Settings changed since the last run.",
    "plan.more": "… and {n} more",

    "guard.first-run": "First run: check the plan before anything is written.",
    "guard.threshold": "This run deletes more files than the threshold allows.",
    "guard.settings-changed": "The settings changed since the last run.",
    "guard.total-size": "The files to mirror exceed the total size limit.",
    "guard.conflicts": "Some files already exist in the vault and were not created by this plugin.",

    "view.title": "Docs Mirror",
    "view.syncNow": "Sync now",
    "view.runPlan": "Run plan",
    "view.cancel": "Cancel",
    "view.notConfigured": "Not set up",
    "view.notConfiguredDesc": "Set the source root in the settings first, then sync.",
    "view.openSettings": "Open settings",
    "view.lastRun": "Last run",

    "settings.root": "Source root",
    "settings.rootDesc": "The folder whose repositories are mirrored. Each repository's docs folder keeps its path below this root.",
    "settings.patterns": "Ignore patterns",
    "settings.patternsDesc": "One rule per line, like a .gitignore for folders. Matching folders are skipped.",
    "settings.excludedNames": "Excluded names",
    "settings.excludedNamesDesc": "Folder and file names that are never mirrored, separated by commas.",
    "settings.fileTypes": "File types",
    "settings.fileTypesDesc": "File extensions that are mirrored, separated by commas. Everything else is skipped.",
    "settings.maxFile": "Largest file",
    "settings.maxFileDesc": "Files larger than this are skipped. Given in megabytes.",
    "settings.totalSize": "Total size limit",
    "settings.totalSizeDesc": "A run that would mirror more data than this asks for confirmation first. Given in megabytes.",
    "settings.threshold": "Confirmation threshold",
    "settings.thresholdDesc": "A run that deletes more files than this, and more than a fifth of the mirrored files, asks for confirmation first.",
    "settings.dotFolders": "Dot folders",
    "settings.dotFoldersDesc": "Include folders whose names start with a dot. Off by default.",
    "settings.syncOnStart": "Sync when the vault starts",
    "settings.syncOnStartDesc": "Run a sync after the vault has loaded. A run that needs confirmation waits in the sidebar and opens no dialog.",
    "settings.helpName": "Help",
    "settings.helpDesc": "Getting started and troubleshooting",

    "command.open": "Open Docs Mirror",
    "command.syncNow": "Sync docs now",
    "command.showPlan": "Show sync plan",

    "notice.blocked.unreachable": "Sync blocked: the source is unreachable. Nothing was deleted.",
    "notice.blocked.empty": "Sync blocked: the source is empty. Nothing was deleted.",
    "notice.blocked.not-configured": "Sync blocked: Docs Mirror is not set up yet.",
    "notice.waiting": "Sync needs confirmation: open the Docs Mirror sidebar.",
    "notice.alreadyRunning": "A sync is already running.",
    "notice.done": "Sync finished: {changed} changed, {deleted} deleted.",
  },
  de: {
    "status.not-configured": "Nicht eingerichtet",
    "status.never": "Nie gelaufen",
    "status.running": "Läuft",
    "status.waiting": "Wartet auf Bestätigung",
    "status.unreachable": "Quelle nicht erreichbar",
    "status.error": "Fehler",
    "status.current": "Aktuell",

    "plan.new.one": "{n} neue Datei",
    "plan.new.many": "{n} neue Dateien",
    "plan.changed.one": "{n} geänderte Datei",
    "plan.changed.many": "{n} geänderte Dateien",
    "plan.unchanged.one": "{n} unveränderte Datei",
    "plan.unchanged.many": "{n} unveränderte Dateien",
    "plan.delete.one": "{n} zu löschende Datei",
    "plan.delete.many": "{n} zu löschende Dateien",
    "plan.vault-modified.one": "{n} im Vault veränderte Datei",
    "plan.vault-modified.many": "{n} im Vault veränderte Dateien",
    "plan.conflict.one": "{n} Konflikt",
    "plan.conflict.many": "{n} Konflikte",
    "plan.vault-only.one": "{n} Datei nur im Vault",
    "plan.vault-only.many": "{n} Dateien nur im Vault",
    "plan.hint.vault-only": "Dateien, die nur im Vault liegen, werden nie angefasst.",
    "plan.hint.settings-changed": "Einstellungen seit dem letzten Lauf geändert.",
    "plan.more": "… und {n} weitere",

    "guard.first-run": "Erster Lauf: Prüfe den Plan, bevor etwas geschrieben wird.",
    "guard.threshold": "Dieser Lauf löscht mehr Dateien, als die Schwelle erlaubt.",
    "guard.settings-changed": "Die Einstellungen haben sich seit dem letzten Lauf geändert.",
    "guard.total-size": "Die zu spiegelnden Dateien überschreiten die Gesamtgröße.",
    "guard.conflicts": "Einige Dateien liegen schon im Vault und stammen nicht von diesem Plugin.",

    "view.title": "Docs Mirror",
    "view.syncNow": "Jetzt synchronisieren",
    "view.runPlan": "Plan ausführen",
    "view.cancel": "Abbrechen",
    "view.notConfigured": "Nicht eingerichtet",
    "view.notConfiguredDesc": "Lege zuerst den Quellordner in den Einstellungen fest, dann synchronisiere.",
    "view.openSettings": "Einstellungen öffnen",
    "view.lastRun": "Letzter Lauf",

    "settings.root": "Quellordner",
    "settings.rootDesc": "Der Ordner, dessen Repositories gespiegelt werden. Der docs-Ordner jedes Repositories behält seinen Pfad unter diesem Ordner.",
    "settings.patterns": "Ausschlussmuster",
    "settings.patternsDesc": "Eine Regel je Zeile, wie eine .gitignore für Ordner. Getroffene Ordner werden übersprungen.",
    "settings.excludedNames": "Ausgeschlossene Namen",
    "settings.excludedNamesDesc": "Ordner- und Dateinamen, die nie gespiegelt werden, durch Komma getrennt.",
    "settings.fileTypes": "Dateitypen",
    "settings.fileTypesDesc": "Dateiendungen, die gespiegelt werden, durch Komma getrennt. Alles andere wird übersprungen.",
    "settings.maxFile": "Größte Datei",
    "settings.maxFileDesc": "Dateien, die größer sind, werden übersprungen. Angabe in Megabyte.",
    "settings.totalSize": "Gesamtgrößen-Grenze",
    "settings.totalSizeDesc": "Ein Lauf, der mehr Daten spiegeln würde, fragt vorher nach einer Bestätigung. Angabe in Megabyte.",
    "settings.threshold": "Schwelle für Bestätigung",
    "settings.thresholdDesc": "Ein Lauf, der mehr Dateien löscht als hier angegeben und mehr als ein Fünftel der gespiegelten Dateien, fragt vorher nach einer Bestätigung.",
    "settings.dotFolders": "Punkt-Ordner",
    "settings.dotFoldersDesc": "Ordner einbeziehen, deren Name mit einem Punkt beginnt. Standardmäßig aus.",
    "settings.syncOnStart": "Beim Vault-Start synchronisieren",
    "settings.syncOnStartDesc": "Nach dem Laden des Vaults einen Lauf starten. Ein Lauf, der eine Bestätigung braucht, wartet in der Seitenleiste und öffnet kein Fenster.",
    "settings.helpName": "Hilfe",
    "settings.helpDesc": "Erste Schritte und Fehlersuche",

    "command.open": "Docs Mirror öffnen",
    "command.syncNow": "Docs jetzt synchronisieren",
    "command.showPlan": "Sync-Plan anzeigen",

    "notice.blocked.unreachable": "Lauf blockiert: Quelle nicht erreichbar. Es wurde nichts gelöscht.",
    "notice.blocked.empty": "Lauf blockiert: Quelle ist leer. Es wurde nichts gelöscht.",
    "notice.blocked.not-configured": "Lauf blockiert: Docs Mirror ist noch nicht eingerichtet.",
    "notice.waiting": "Der Lauf braucht eine Bestätigung: Öffne die Seitenleiste von Docs Mirror.",
    "notice.alreadyRunning": "Ein Lauf läuft bereits.",
    "notice.done": "Lauf fertig: {changed} geändert, {deleted} gelöscht.",
  },
} as const;

export type StringKey = keyof typeof STRINGS.en;

/** Basis-Schlüssel aller Zählformen (ohne `.one`/`.many`). */
export type PluralKey = StringKey extends infer K ? (K extends `${infer B}.one` ? B : never) : never;

type Vars = Record<string, string | number>;

function fill(raw: string, vars: Vars): string {
  return raw.replace(/\{(\w+)\}/g, (match, name: string) =>
    Object.prototype.hasOwnProperty.call(vars, name) ? String(vars[name]) : match,
  );
}

function lookup(key: string): string {
  const dict: Record<string, string> = STRINGS[getLang()];
  return dict[key] ?? (STRINGS.en as Record<string, string>)[key] ?? key;
}

/** Übersetzt `key` in der Sprache des Kits; benannte Platzhalter `{name}` kommen aus `vars`. */
export function t(key: StringKey, vars: Vars = {}): string {
  return fill(lookup(key), vars);
}

/** Zählform: `<base>.one` bei genau 1, sonst `<base>.many`; `{n}` ist immer die Zahl. */
export function tn(base: PluralKey, n: number, vars: Vars = {}): string {
  return fill(lookup(n === 1 ? `${base}.one` : `${base}.many`), { ...vars, n });
}
