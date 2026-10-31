# Docs Mirror

> [🇬🇧 English](README.md) · 🇩🇪 Deutsch

Docs Mirror kopiert die `docs`-Ordner vieler Repositories einseitig in einen kleinen Obsidian-Vault. Die Repositories bleiben die Quelle der Wahrheit. Der Vault ist eine Leseansicht: Er wird nie zurück in ein Repository geschrieben.

Version 0.1.0, noch nicht veröffentlicht. Das Plugin läuft nur auf dem Desktop, weil es die Quellordner mit Node.js liest. Auf dem Telefon liest du den Vault über Obsidian Sync; dort läuft das Plugin nicht.

## Was es tut

- Findet unter einem Quellordner alle Ordner, die einem Ordnermuster entsprechen (Standard `**/docs`), damit ein neues Repository ohne Konfiguration erscheint.
- Hält jede Datei unter ihrem Pfad unterhalb des Quellordners, damit relative Links innerhalb eines `docs`-Ordners weiter funktionieren.
- Bildet vor dem Schreiben einen Plan: neu, geändert, unverändert, zu löschen, Konflikte und Dateien, die nur im Vault liegen.
- Zeigt den Plan in der Seitenleiste. Der erste Lauf wartet immer auf deine Bestätigung. Ändert sich der Plan zwischen deiner Bestätigung und der Ausführung, wartet der Lauf erneut und zeigt den neuen Plan.
- Löscht und überschreibt nur Dateien, die das Plugin gespiegelt hat, so wie es sie in seiner Liste pro Gerät verzeichnet. Eine Datei, die schon im Vault liegt und das Plugin nicht angelegt hat, ist ein Konflikt: Sie wird nur überschrieben, wenn du sie ankreuzt; hat sie den Inhalt der Quelle, wird sie ohne Schreiben in die Liste übernommen. Dateien, die nur im Vault liegen, fasst es nie an.
- Überschreibt Dateien, die du im Vault bearbeitet hast, mit der Fassung aus der Quelle. Ein Lauf, der auf deine Bestätigung wartet, führt sie in der Vorschau als „im Vault verändert“; ein Lauf ohne andere Gründe überschreibt sie direkt.
- Löscht nichts, wenn der Quellordner fehlt oder keine Dateien liefert.
- Fragt vor einem Lauf nach, wenn einer von fünf Gründen vorliegt: der erste Lauf; viele Löschungen (Schwelle); die Einstellungen haben sich seit dem letzten Lauf geändert; der gespiegelte Vault überschreitet die Gesamtgrößen-Grenze; Konflikte. Konflikte werden nur überschrieben, wenn du sie ankreuzt; Konflikte bei Groß- und Kleinschreibung sowie bei Typen werden nie überschrieben. Einzelheiten (englisch): [Sync plan reference](docs/reference-plan.md) und [What does a conflict mean](docs/how-to-conflicts.md).
- Überspringt symbolische Links, Punkt-Ordner (wenn du sie nicht einschließt), Dateien über der Größengrenze und Dateitypen, die du nicht aufgenommen hast.
- Schreibt jede Datei über eine Temp-Datei; keine Datei bleibt halb geschrieben zurück, eine unterbrochene Ersetzung kann aber eine Datei fehlen lassen, bis der nächste Lauf sie wiederherstellt.

## Installation

Das Plugin ist noch nicht im Community-Plugin-Store.

Für eine manuelle Installation kopierst du `main.js`, `manifest.json` und `styles.css` nach `<Vault>/.obsidian/plugins/docs-mirror/` und aktivierst das Plugin in den Community-Plugins.

Zum Bauen aus dem Quellcode führst du `npm install` und danach `npm run build` aus.

Für die Ersteinrichtung folge [docs/getting-started.md](docs/getting-started.md). Die übrige Dokumentation (englisch) steht im Verzeichnis [docs/README.md](docs/README.md).

## Einstellungen

- **Quellordner:** der absolute Pfad des Ordners, dessen Repositories gespiegelt werden. Er wird gerätelokal gespeichert und muss auf jedem Gerät gesetzt werden.
- **Ordnermuster:** ein Muster je Zeile, relativ zum Quellordner. Passende Ordner werden mit allem darunter gespiegelt. Siehe [Adjust the folder patterns](docs/how-to-folder-patterns.md) (englisch).
- **Ausgeschlossene Namen:** Ordner- und Dateinamen, die nie gespiegelt werden, durch Komma getrennt. Standard: `node_modules`, `.git`, `dist`, `build`, `__pycache__`, `.venv`.
- **Dateitypen:** Dateiendungen, die gespiegelt werden, durch Komma getrennt. Standard: `md`, `canvas`, `base`, `png`, `jpg`, `jpeg`, `gif`, `svg`, `webp`, `pdf`.
- **Größte Datei:** Dateien über dieser Größe werden übersprungen. Standard: 5 MB.
- **Gesamtgrößen-Grenze:** ein Lauf, der den gespiegelten Vault über diese Größe brächte, fragt vorher nach. Standard: 1 GB.
- **Schwelle für Bestätigung:** ein Lauf, der mindestens so viele Dateien löscht und dabei mindestens ein Fünftel der gespiegelten Dateien trifft, fragt vorher nach. Standard: 20 Dateien. Der Fünftel-Anteil ist fest und nicht einstellbar.
- **Punkt-Ordner:** Ordner einbeziehen, deren Name mit einem Punkt beginnt. Standardmäßig aus.
- **Beim Vault-Start synchronisieren:** zwei Sekunden nach dem Laden des Arbeitsbereichs einen Lauf starten. Standardmäßig aus. Braucht der Lauf eine Bestätigung, wartet er in der Seitenleiste und zeigt eine Mitteilung statt eines Fensters. Ist schon ein Lauf, eine Bestätigung oder ein wartender Plan vorhanden, entfällt der Startlauf still. Jede Einstellung im Einzelnen (englisch): [Settings reference](docs/reference-settings.md).

## Befehle

- **Docs Mirror öffnen:** öffnet die Seitenleiste. Das Ribbon-Symbol tut dasselbe.
- **Docs jetzt synchronisieren:** startet einen Lauf. Der Knopf in der Seitenleiste tut dasselbe.
- **Sync-Plan anzeigen:** öffnet die Seitenleiste mit dem Plan, der auf Bestätigung wartet. Wartet kein Plan, sagt es das. Alle Befehle, Knöpfe und Meldungen (englisch): [docs/reference-commands.md](docs/reference-commands.md).

## Grenzen

- Der Spiegel ist einseitig. Änderungen im Vault werden nie in die Repositories zurückkopiert. Warum, und was gemessen ist (englisch): [docs/explanation-how-it-works.md](docs/explanation-how-it-works.md).
- Es gibt keinen Dateiwächter und keinen Zeitplan. Ein Lauf startet, wenn du ihn anstößt oder, wenn du es eingestellt hast, beim Start des Vaults.
- Eine gespiegelte Datei wird im Vault gelöscht, wenn ihre Quelle verschwindet, ein symbolischer Link wird, die Größengrenze überschreitet oder sie in einen nicht aufgenommenen Dateityp wechselt; das gilt aber nur, wenn du sie im Vault nicht bearbeitet hast. Eine dort bearbeitete Datei bleibt liegen, und das Plugin vergisst sie und löscht sie nie.
- Links, die aus dem `docs`-Ordner hinausführen, etwa `../src/…`, brechen im Vault.
- Das Plugin liest keine `.gitignore`. Nutze stattdessen die ausgeschlossenen Namen und die Ordnermuster.
- Spiegle in einen Vault nur von einem Gerät aus; jedes Gerät führt seine eigene Liste, zwei Geräte würden sich gegenseitig die Dateien überschreiben.
- Die Gesamtgrößen-Grenze vergleicht die Größe des Spiegels nach dem Lauf mit der Grenze, nicht den Zuwachs eines einzelnen Laufs.

## Stand

Version 0.1.0. Screenshots und der Store-Eintrag folgen noch.
