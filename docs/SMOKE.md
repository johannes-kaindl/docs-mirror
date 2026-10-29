# GUI-Smoke (Task 13)

Gemessen am 2026-10-28 mit `npm run smoke:gui -- --port <Port>` (`scripts/gui-smoke.ts`) an einer Zweitinstanz mit eigenem Profil, Obsidian 1.15.0 (Fenstertitel), macOS, Fenster 1280×900, Oberfläche englisch (`--lang=en-US`), dunkles Theme. Quelle und Vault liegen im Staging (`STAGING_VAULTS_DIR`), der Vault wird von `buildVault` aus `fixtures/vault` gebaut, die Quelle von `--setup` aus `fixtures/source` plus dem, was Git nicht trägt (`node_modules`, Symlink, Datei über 5 MB, feste Änderungszeiten, leerer Ordner, zweite Quelle, große Quelle mit 4000 Dateien).

Ablauf: `npm run build`, `npm run smoke:gui -- --setup`, Zweitinstanz starten (Rezept im Kopf des Treibers), Lock holen (`--exclusive focus`, die Einstellungen öffnen ein eigenes Fenster), Lauf, Lock freigeben, Prozess der Zweitinstanz beenden. Ein Lauf stellt den gerätelokalen Zustand des Plugins selbst zurück. Flags: `--bilder <ordner>` (Screenshots), `--ohne-gross` (die Punkte mit der großen Quelle werden `skipped`), `--mutiert` und `--setup --mutiertes-main <datei>` (nur für Gegenproben).

Bedienung: Der Treiber klickt mit echten Mausereignissen (`clickReal`) auf die Knöpfe der Seitenleiste, die Zusammenfassungen, die Kästchen, die Dialogknöpfe und die Schalter im Tab. Die Wurzel setzt er über das Feld im Einstellungs-Tab (füllen, verlassen), Schalter über Klick. Direkt über die Plugin-Schnittstelle (`setRoot`, `updateSettings`, `notify`) läuft nur, was der Zeitpunkt verlangt: der Wurzelwechsel mitten im Lauf und die Einstellungs-Änderung, die einen Plan erzwingt.

## Punkte

Baseline-Lauf vor dem Fokus-Fix: 37 grün, 1 rot (O4c), 1 übersprungen, 0 nichts gemessen. Finale Bilanz nach dem Fokus-Fix (Commit 74c5da7, Obsidian 1.15.0): 38 grün, 0 rot, 1 übersprungen, 0 nichts gemessen von 39 Punkten (73 s).

- `0` Plugin geladen, Zustand zurückgesetzt.
- `O1` Befehl „Open“ bei eingeklappter rechter Seitenleiste: Ansicht 276×816 px statt 0×0, ein Blatt.
- `A` Empty-State, nur „Open settings“.
- `O9a`–`O9e` Einstellungs-Tab: Knopf öffnet den Tab, Obsidian 1.15.0 nimmt den deklarativen Pfad (`display()` wird nicht selbst gerufen), der `display()`-Fallback zeichnet dieselben zehn Zeilen, ein blur speichert einmal, der Hinweis unter dem Feld steht im Beschreibungsbereich, der Schalter schreibt `data.json`.
- `B`, `B2` Erster Lauf wartet („6 new files“, Grund „First run“), Abbrechen im Dialog schreibt nichts.
- `C`, `D` Dateien unter ihrem Repo-Pfad, `node_modules`, Symlink, große Datei und Fremdtyp fehlen, Zähler New 6, Skipped 3, Zeitstempel auf die Millisekunde gleich der Quelle.
- `E`, `F`, `G`, `H` geändert, gelöscht (Warnknopf, leerer Ordner weg), Fremddatei bleibt (nur im Vault, nicht im Manifest), im Vault verändert (Überschreiben stellt die Quelle her).
- `O4a`–`O4c` Konflikte: „Alle überschreiben“ setzt `checked` und `disabled`, nur das angekreuzte wird überschrieben; der Fokus auf einem Kästchen überlebt den Neuaufbau (`data-dmr-focus`, davor rot).
- `O10`, `O10c` Doppelter Auslöser: ein Lauf, ein „läuft bereits“; Startlauf-Timer und Befehle nie gleichzeitig.
- `I`, `J` Wurzel nicht vorhanden und leerer Ordner: blockiert, Vault und Manifest unverändert.
- `O11` Wurzel „/“: Warnung sichtbar.
- `K`, `K2`, `O3a`, `O3b` Statuszeile in sechs Zuständen mit Text, Icon und aria-label; `is-checking` dreht sich (Animation `dmr-spin` läuft), startet beim Neuaufbau nicht neu (gleiches Element, Uhr 457→1432 ms in 979 ms), unter `prefers-reduced-motion` aus.
- `L`, `L2` Aktionszeile bei 276, 196 und 116 px Breite erreichbar (bei 116 px brechen die Knöpfe um), Körper rollt darunter; Gegenprobe mit überdeckendem Körper wird rot.
- `O2` `<details>`: Auf- und Zuklappen überlebt `notify()`, Scrollposition bleibt (600 px, Abweichung 0).
- `N0`, `N`, `O6` Startlauf: Schalter aus kein Lauf; Schalter an kein Modal, Notice „Sync needs confirmation“; Ladezeit 7 ms, Lauf beginnt nach 2026 ms, größter Ruckler der Oberfläche 27 ms bei einer Quelle mit 4000 Dateien.
- `M`, `O5` Entladen mitten im Lauf: der Lauf endet (532 von 4000 Dateien), kein Temp-Rest, keine halbe Datei, das Teil-Manifest trägt genau die geschriebenen Dateien.
- `O7`, `O8` Wurzelwechsel mitten im Lauf: der Lauf liest den alten Baum zu Ende; Wurzelwechsel in der Wartephase: der bestätigte Lauf wartet erneut mit dem Grund „Settings changed“, im Vault wird nichts gelöscht.

## Nicht gemessen und Grenzen

- `O12` übersprungen: `Platform.isDesktopApp` lässt sich in der Zweitinstanz nicht auf false stellen (das Plugin bindet `Platform` aus dem Modul „obsidian“, im Renderer nicht erreichbar). Der Mobil-Fall bleibt gegen den Mock getestet.
- Der blur im Einstellungs-Fenster ist echt, solange das Fenster den Systemfokus hat; sonst sendet der Treiber das Ereignis einmal selbst (der Detailtext nennt, welche Form lief).
- Der Startlauf wird durch Neuladen des Plugins hergestellt, nicht durch einen Prozessstart; `onLayoutReady` läuft dabei sofort.
- Gemessen nur auf macOS mit Obsidian 1.15.0, ein Lauf je Zustand (n=1), Themen und Schriftgrößen außer dem Standard nicht.

## Befunde

- `O4c` war im ersten Lauf rot: der Fokus auf einem Körper-Kästchen ging beim Neuaufbau des Körpers verloren (Fokus fiel auf `body`). Behoben in 74c5da7 (`render()` merkt den Fokus über `data-dmr-focus` und stellt ihn her); der Rerun ist grün (Fokus vor und nach dem Neuaufbau auf demselben Kästchen, `INPUT`).
- Beobachtung (kein Defekt): Notices liegen oben rechts über der Aktionszeile und fangen dort einen Klick ab; der Treiber räumt sie vor jedem Klick weg. Der Startlauf läuft nach einem früheren manuellen Lauf noch einmal (redundant, folgenlos).
- Punkte, die nur mitten im Lauf gelten (K2, O3a, O3b, O7), werden `nichts gemessen`, wenn der Lauf bei der Probe schon zu Ende war (statt rot); die große Quelle hat deshalb 4000 Dateien.

## Gegenproben

Mutation in einer temporären Kopie des Quellcodes, mit esbuild zu einem eigenen `main.js` gebaut und in den Plugin-Ordner des Staging-Vaults gelegt; der Repo-Stand blieb unberührt. Jede Mutation macht die genannten Punkte rot, der unmutierte Abschlusslauf ist wieder grün (38/0/1/0).

- `C`: Scan ohne `excludedNames` → B und C rot („node_modules“ in Vorschau und Vault).
- `G`: Vault-only-Dateien als Löschung geplant und die Manifest-Prüfung im Löschen entfernt → G rot (Fremddatei gelöscht).
- `I`: Löschschutz bei nicht erreichbarer und leerer Quelle entfernt → I und J rot (Status „Waiting for confirmation“ statt „Source unreachable“; die Bestätigungspflicht fängt das Löschen dann noch ab).
- `M`: `abort()` beim Entladen entfernt → M und O5 rot (der Lauf schreibt nach dem Entladen weiter, 142 → 950 Dateien, Manifest und Vault weichen ab).
- `O1`: `revealLeaf` für das neue Blatt entfernt → O1 rot (Ansicht 0×0 px, Seitenleiste eingeklappt).
- `O4c`: die Fokus-Wiederherstellung (`next?.focus(...)`) entfernt → O4c rot (Fokus danach `body`).
