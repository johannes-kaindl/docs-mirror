# Docs Mirror

> [🇬🇧 English](README.md) · 🇩🇪 Deutsch

Docs Mirror kopiert die `docs`-Ordner vieler Repositories einseitig in einen kleinen Obsidian-Vault. Die Repositories bleiben die Quelle der Wahrheit. Der Vault ist eine Leseansicht: Er wird nie zurück in ein Repository geschrieben.

Version 0.1.0, noch nicht veröffentlicht. Das Plugin läuft nur auf dem Desktop, weil es die Quellordner mit Node.js liest. Auf dem Telefon liest du den Vault über Obsidian Sync; dort läuft das Plugin nicht.

## Was es tut

- Findet unter einem Quellordner alle Ordner, die einem Ordnermuster entsprechen (Standard `**/docs`), damit ein neues Repository ohne Konfiguration erscheint.
- Hält jede Datei unter ihrem Pfad unterhalb des Quellordners, damit relative Links innerhalb eines `docs`-Ordners weiter funktionieren.
- Bildet vor dem Schreiben einen Plan: neu, geändert, unverändert, zu löschen, Konflikte und Dateien, die nur im Vault liegen.
- Zeigt den Plan in der Seitenleiste. Der erste Lauf wartet immer auf deine Bestätigung.
- Löscht und überschreibt nur Dateien, die das Plugin selbst gespiegelt hat, so wie es sie in seiner eigenen Liste pro Gerät verzeichnet. Dateien, die nur im Vault liegen, fasst es nie an.
- Überschreibt Dateien, die du im Vault bearbeitet hast, mit der Fassung aus der Quelle. Ein Lauf, der auf deine Bestätigung wartet, führt sie in der Vorschau als „im Vault verändert“; ein Lauf ohne andere Gründe überschreibt sie direkt.
- Löscht nichts, wenn der Quellordner fehlt oder keine Dateien liefert.
- Fragt vor dem Lauf nach, wenn er viele Dateien löscht, wenn sich die Einstellungen seit dem letzten Lauf geändert haben oder wenn der gespiegelte Vault die Gesamtgrößen-Grenze überschreitet.
- Überspringt symbolische Links, Punkt-Ordner (wenn du sie nicht einschließt), Dateien über der Größengrenze und Dateitypen, die du nicht aufgenommen hast.
- Schreibt jede Datei über eine Temp-Datei; keine Datei bleibt halb geschrieben zurück, eine unterbrochene Ersetzung kann aber eine Datei fehlen lassen, bis der nächste Lauf sie wiederherstellt.

## Installation

Das Plugin ist noch nicht im Community-Plugin-Store.

Für eine manuelle Installation kopierst du `main.js`, `manifest.json` und `styles.css` nach `<Vault>/.obsidian/plugins/docs-mirror/` und aktivierst das Plugin in den Community-Plugins.

Zum Bauen aus dem Quellcode führst du `npm install` und danach `npm run build` aus.

Für die Ersteinrichtung folge [docs/getting-started.md](docs/getting-started.md).

## Einstellungen

- **Quellordner:** der absolute Pfad des Ordners, dessen Repositories gespiegelt werden. Er wird gerätelokal gespeichert und muss auf jedem Gerät gesetzt werden.
- **Ordnermuster:** ein Muster je Zeile, relativ zum Quellordner. Passende Ordner werden mit allem darunter gespiegelt.
- **Ausgeschlossene Namen:** Ordner- und Dateinamen, die nie gespiegelt werden. Standard: `node_modules`, `.git`, `dist`, `build`, `__pycache__`, `.venv`.
- **Dateitypen:** Dateiendungen, die gespiegelt werden. Standard: `md`, `canvas`, `base`, `png`, `jpg`, `jpeg`, `gif`, `svg`, `webp`, `pdf`.
- **Größte Datei:** Dateien über dieser Größe werden übersprungen. Standard: 5 MB.
- **Gesamtgrößen-Grenze:** ein Lauf, der den gespiegelten Vault über diese Größe brächte, fragt vorher nach. Standard: 1 GB.
- **Schwelle für Bestätigung:** ein Lauf, der mindestens so viele Dateien löscht und dabei mindestens ein Fünftel der gespiegelten Dateien trifft, fragt vorher nach. Standard: 20 Dateien.
- **Punkt-Ordner:** Ordner einbeziehen, deren Name mit einem Punkt beginnt. Standardmäßig aus.
- **Beim Vault-Start synchronisieren:** zwei Sekunden nach dem Laden des Arbeitsbereichs einen Lauf starten. Standardmäßig aus. Braucht der Lauf eine Bestätigung, wartet er in der Seitenleiste und öffnet kein Fenster.

## Befehle

- **Docs Mirror öffnen:** öffnet die Seitenleiste. Das Ribbon-Symbol tut dasselbe.
- **Docs jetzt synchronisieren:** startet einen Lauf. Der Knopf in der Seitenleiste tut dasselbe.
- **Sync-Plan anzeigen:** öffnet die Seitenleiste mit dem Plan, der auf Bestätigung wartet. Wartet kein Plan, sagt es das.

## Grenzen

- Der Spiegel ist einseitig. Änderungen im Vault werden nie in die Repositories zurückkopiert.
- Es gibt keinen Dateiwächter und keinen Zeitplan. Ein Lauf startet, wenn du ihn anstößt oder, wenn du es eingestellt hast, beim Start des Vaults.
- Eine gespiegelte Datei, die später ein symbolischer Link wird, die Größengrenze überschreitet oder in einen nicht aufgenommenen Dateityp wechselt, wird im Vault gelöscht, weil sie nicht mehr zum Quellumfang zählt.
- Eine gespiegelte Datei, deren Quelle gelöscht wurde, bleibt im Vault liegen, wenn du sie dort bearbeitet hast; das Plugin vergisst sie dann und löscht sie nie.
- Links, die aus dem `docs`-Ordner hinausführen, etwa `../src/…`, brechen im Vault.
- Das Plugin liest keine `.gitignore`. Nutze stattdessen die ausgeschlossenen Namen und die Ordnermuster.
- Spiegle in einen Vault nur von einem Gerät aus; jedes Gerät führt seine eigene Liste, zwei Geräte würden sich gegenseitig die Dateien überschreiben.
- Die Gesamtgrößen-Grenze vergleicht die Größe des Spiegels nach dem Lauf mit der Grenze, nicht den Zuwachs eines einzelnen Laufs.

## Stand

Version 0.1.0. Screenshots und der Store-Eintrag folgen noch.
