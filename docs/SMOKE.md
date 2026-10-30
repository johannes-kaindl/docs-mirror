# GUI-Smoke (Task 13)

Gemessen am 2026-10-28 (Erstlauf, Fokus-Rerun) und 2026-10-29 (Nacharbeit nach Review, alle Zahlen unten) mit `npm run smoke:gui -- --port <Port>` (`scripts/gui-smoke.ts`) an einer Zweitinstanz mit eigenem Profil, Obsidian 1.15.0 (Fenstertitel), macOS, Fenster 1280×900, Oberfläche englisch (`--lang=en-US`), dunkles Theme. Quelle und Vault liegen im Staging (`STAGING_VAULTS_DIR`), der Vault wird von `buildVault` aus `fixtures/vault` gebaut, die Quelle von `--setup` aus `fixtures/source` plus dem, was Git nicht trägt (`node_modules`, Symlink, Datei über 5 MB, feste Änderungszeiten, leerer Ordner, zweite Quelle, große Quelle mit 4000 Dateien).

Ablauf: `npm run build`, `npm run smoke:gui -- --setup`, Zweitinstanz starten (Rezept im Kopf des Treibers), Lock holen (`--exclusive focus`, die Einstellungen öffnen ein eigenes Fenster), Lauf, Lock freigeben, Prozess der Zweitinstanz beenden. Ein Lauf stellt den gerätelokalen Zustand des Plugins selbst zurück. Flags: `--bilder <ordner>` (Screenshots), `--ohne-gross` (die Punkte mit der großen Quelle werden `skipped`), `--mutiert` und `--setup --mutiertes-main <datei>` (nur für Gegenproben).

Bedienung: Der Treiber klickt mit echten Mausereignissen (`clickReal`) auf die Knöpfe der Seitenleiste, die Zusammenfassungen, die Kästchen, die Dialogknöpfe und die Schalter im Tab. Die Wurzel setzt er über das Feld im Einstellungs-Tab (füllen, verlassen), Schalter über Klick. Direkt über die Plugin-Schnittstelle (`setRoot`, `updateSettings`, `notify`) läuft nur, was der Zeitpunkt verlangt: der Wurzelwechsel mitten im Lauf und die Einstellungs-Änderung, die einen Plan erzwingt.

## Punkte

Baseline-Lauf vor dem Fokus-Fix: 37 grün, 1 rot (O4c), 1 übersprungen, 0 nichts gemessen. Bilanz nach dem Fokus-Fix und der Nacharbeit (Obsidian 1.15.0): 41 grün, 0 rot, 1 übersprungen, 0 nichts gemessen von 42 Punkten (rund 95 s).

Nachlauf 2026-10-29 gegen HEAD ad71616 (main.js md5 c4f18d456806ff81a362bf17b1fab693, Vault-Build gleich): Baseline mit den alten 42 Punkten 41 grün, 0 rot, 1 übersprungen, 0 nichts gemessen. Nach Ergänzung der Punkte Q1 bis Q6 (48 Punkte, unmutierter Build): 47 grün, 0 rot, 1 übersprungen (O12), 0 nichts gemessen, 123 s. P und O7 rechnen seit Q4 mit drei gestörten Dateien (Errors=3, 3997 Manifest-Einträge unter `bigrepo`).

- `0` Plugin geladen, Zustand zurückgesetzt.
- `O1` Befehl „Open“ bei eingeklappter rechter Seitenleiste: Ansicht 276×816 px statt 0×0, ein Blatt.
- `A` Empty-State, nur „Open settings“.
- `O9a`–`O9e` Einstellungs-Tab: Knopf öffnet den Tab, Obsidian 1.15.0 nimmt den deklarativen Pfad (`display()` wird nicht selbst gerufen), der `display()`-Fallback zeichnet dieselben zehn Zeilen, ein blur speichert einmal, der Hinweis unter dem Feld steht im Beschreibungsbereich, der Schalter schreibt `data.json`.
- `B`, `B2` Erster Lauf wartet („6 new files“, Grund „First run“), Abbrechen im Dialog schreibt nichts.
- `C`, `D` Dateien unter ihrem Repo-Pfad, `node_modules`, Symlink, große Datei und Fremdtyp fehlen, Zähler New 6, Skipped 3, Zeitstempel auf die Millisekunde gleich der Quelle.
- `E`, `F`, `G`, `H` geändert, gelöscht (Warnknopf, leerer Ordner weg), Fremddatei bleibt (nur im Vault, nicht im Manifest), im Vault verändert (Überschreiben stellt die Quelle her).
- `O4a`–`O4c` Konflikte: „Alle überschreiben“ setzt `checked` und `disabled`, nur das angekreuzte wird überschrieben; der Fokus auf einem Kästchen überlebt den Neuaufbau (`data-dmr-focus`, davor rot).
- `O10`, `O10c` Doppelter Auslöser: ein Lauf, ein „läuft bereits“; Startlauf-Timer und Befehle nie gleichzeitig.
- `I`, `J` Wurzel nicht vorhanden und leerer Ordner: blockiert (Status, Meldung), Vault und Manifest (7 Einträge) unverändert. Ehrlich: Beide Punkte ändern die Wurzel, damit ändert sich der Fingerabdruck, und die Bestätigungspflicht („Settings changed“) fängt ein Löschen schon vorher ab. Sie belegen die Meldung und den Zustand nach dem Blockieren, nicht allein den Löschschutz.
- `I2`, `J2` Der Löschschutz allein: Wurzel und Einstellungen bleiben, der Fingerabdruck ist vorher und nachher gleich, ein Vorlauf zeigt, dass kein Plan auf Bestätigung wartet, und die sieben Löschungen liegen unter der Schwelle (20). Dann verschwindet die Quelle (`I2`: Ordner umbenannt) oder alle Treffer (`J2`: die drei `docs`-Ordner weggenommen). Erwartet: „Source unreachable“ beziehungsweise „Error“ mit „the source is empty“, 8 Dateien im Vault und 7 Manifest-Einträge unverändert. Ohne Löschschutz (Mutation `I`) verliert der Vault die sieben gespiegelten Dateien (8 → 1).
- `P` Eine Quelldatei wird WÄHREND des Laufs gelöscht, eine andere verlängert (beide stehen am Ende der Reihenfolge und sind beim Eingriff noch nicht geschrieben, der Lauf läuft nachweislich): Zähler Errors=2, Status „Error“ („Sync finished with errors“), beide Dateien weder im Vault noch im Manifest, eine spätere Datei ist da und im Manifest, 3998 Manifest-Einträge unter `bigrepo`. Grenze: die Geschwindigkeit des Laufs reicht, weil der Treiber die Reihenfolge nutzt und die Dateien ans Ende der Pfad-Sortierung legt; ein Wettlauf mit einer beliebigen Datei wird nicht gemessen.
- `O11` Wurzel „/“: Warnung sichtbar.
- `K`, `K2`, `O3a`, `O3b` Statuszeile in sechs Zuständen mit Text, Icon und aria-label; `is-checking` dreht sich (Animation `dmr-spin` läuft), startet beim Neuaufbau nicht neu (gleiches Element, Uhr 457→1432 ms in 979 ms), unter `prefers-reduced-motion` aus.
- `L`, `L2` Aktionszeile bei 276, 196 und 116 px Breite erreichbar (bei 116 px brechen die Knöpfe um), Körper rollt darunter; Gegenprobe mit überdeckendem Körper wird rot.
- `O2` `<details>`: Auf- und Zuklappen überlebt `notify()`, Scrollposition bleibt (600 px, Abweichung 0).
- `N0`, `N`, `O6` Startlauf: Schalter aus kein Lauf; Schalter an kein Modal, Notice „Sync needs confirmation“; Ladezeit 7 ms, Lauf beginnt nach 2026 ms, größter Ruckler der Oberfläche 27 ms bei einer Quelle mit 4000 Dateien.
- `M`, `O5` Entladen mitten im Lauf: der Lauf endet (532 von 4000 Dateien), kein Temp-Rest, keine halbe Datei, das Teil-Manifest trägt genau die geschriebenen Dateien.
- `O7`, `O8` Wurzelwechsel mitten im Lauf: der Lauf liest den alten Baum zu Ende; Wurzelwechsel in der Wartephase: der bestätigte Lauf wartet erneut mit dem Grund „Settings changed“, im Vault wird nichts gelöscht.

- `Q1` Wurzel als Symlink auf das Staging-Verzeichnis (Elternordner des Vaults; nur Vault und eine echte Q1-Quelle werden betreten, die übrigen Staging-Ordner stehen in `excludedNames`): bestätigter Lauf, keine Datei unter `docs-mirror/` im Vault (Vault-Kopien nicht als Quelle gelesen), die echte Quelldatei gespiegelt, zweiter Lauf 0 neu und 0 geändert, Vault-Dateizahl gleich.
- `Q2` Wurzel gleich Vault: Notice „Sync blocked: the source folder is this vault itself. Nothing was written.“, kein wartender Plan, Vault und Manifest unverändert.
- `Q3` Bestätigungsdialog offen, Plugin entladen, Klick auf „Run plan“: Lauf läuft nicht, `last` unverändert, die neue Quelldatei fehlt im Vault, kein Temp-Rest, Vault und Manifest unverändert.
- `Q4` (B1) Eine fremde Datei entsteht im Vault am Ziel einer noch nicht geschriebenen neuen Datei (`bigrepo/docs/d9/f3939.md`, nach dem Planen, mitten im Lauf): Fehler gezählt (Errors=3 zusammen mit P), Inhalt der fremden Datei unverändert, kein Manifest-Eintrag.
- `Q5` Der Bestätigungsdialog bei einer nur im Vault veränderten Datei (H) trägt am „Run plan“-Knopf die Klasse `mod-destructive`, der Dialog des ersten Laufs (B2, nur neue Dateien) `mod-cta`.
- `Q6` Der Einstellungs-Tab zeigt unter „Confirmation threshold“ den Text mit „deletes at least this many files, and at least a fifth“.

## Beobachtungen, nicht behoben

Bei 116 px Breite der Seitenleiste bricht das Statuswort mitten im Wort („confirmati/on“, `overflow-wrap: anywhere` an `.dmr-status-text`).

In den Konfliktzeilen sitzen Kästchen und Pfad nicht auf einer Grundlinie (das Kästchen steht höher), und die Notiz „Already in the vault …“ steht ohne Einzug darunter.

Die Karte „Last run“ bleibt während eines Laufs sichtbar und zeigt den vorigen Lauf, das kann mit dem laufenden verwechselt werden.

Die Zeitangabe in der Überschrift der Ergebniskarte („Last run: 10/28/2026, 12:06:39 PM“) bricht in der schmalen Seitenleiste um.

Notices liegen oben rechts über der Aktionszeile und fangen dort einen Klick ab (Obsidian-Verhalten, der Treiber räumt sie vor jedem Klick weg).

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

Mutation in einer temporären Kopie von `src/` (mit `tsconfig.json`), gebaut mit denselben Optionen wie `npm run build` (esbuild, minify, cjs, es2022), in den Plugin-Ordner des Staging-Vaults gelegt. Der Repo-Stand blieb unberührt. Der Kontroll-Build aus derselben Kopie ohne Mutation ist md5-gleich dem Repo-`main.js` (a5cc849718588f76c7ad977b15fc931d); jede Mutation weicht davon ab. Nach den Mutationen lief der Abschlusslauf mit dem unmutierten Build.

| Punkt | Mutation | md5 mutiert | rot sichtbar |
|---|---|---|---|
| Kontrolle | keine | a5cc849718588f76c7ad977b15fc931d (= Repo) | 41 grün, 0 rot |
| C | Scan ohne `excludedNames` | ad2216c51c36af84d505097d07ebe581 | B, B2, C rot (`node_modules`-Pfade in Vorschau und Vault, New=8) |
| G | Vault-only als Löschung geplant, Manifest-Prüfung im Löschen entfernt | ee197e8e373a52ad96dfa4d7d575a457 | G rot (Fremddatei gelöscht) |
| I, I2, J2 | Löschschutz bei nicht erreichbarer und leerer Quelle entfernt (`guards.ts` beide Zweige, `plan.ts`) | 8e35693c9c5b3137de580b39f232510a | I2 und J2 rot: der Vault verliert die gespiegelten Dateien (8 → 1), Manifest geändert; I und J rot (Status „Waiting for confirmation“, die Bestätigungspflicht fängt dort noch ab) |
| M, O5 | `abort()` beim Entladen entfernt | 3e1a6277d7f0d04970fca223f8842b7e | M rot (Lauf endet nicht: 331 → 744 → 1590 Dateien, ein Temp-Rest), O5 rot (Manifest 2293, Vault 1593); K2, O3a, O3b, O7, P werden dann nicht gemessen |
| O1 | `revealLeaf` für das neue Blatt entfernt | 29103a9c56f0518237b636a5bbb5896b | O1 rot (Ansicht 0×0, Seitenleiste eingeklappt) |
| O4c | Fokus-Wiederherstellung `next?.focus(...)` entfernt | cefd0939112abf9d4656b22f3b68c4f0 | O4c rot (Fokus danach `<BODY>`) |
| P | Größenprüfung „source changed during the run“ entfernt | c2e5b91adc402e52f1f13c434c3fe34c | P rot (Errors=1 statt 2, die verlängerte Datei wird geschrieben und steht im Manifest: 3999 statt 3998), O7 rot als Folge |
| Q1 | `resolvePaths` im Runner ignoriert | e9c5bf9b593235425bc754ab07fc6eda | Q1 rot (Vault-Kopien unter `docs-mirror/` als Quelle gelesen); 33 grün, 1 rot, 13 übersprungen, 1 nichts gemessen (`--ohne-gross`) |
| Q2 | Zweig `vault-is-root` entfernt | 1f0338833b869a1eab7197444d45c342 | Q2 rot (keine Notice, der Plan wartet), 3. Lauf nach zwei Abbrüchen durch die Umgebung |
| Q3 | beide `unloaded`-Prüfungen entfernt (`executePlan` und `perform`) | 468e30460e53f386531c0b7da2778781 | Q3 rot (neue Datei im Vault, Vault 8 → 9, Manifest geändert); I2, J2, I, J, K rot als Folge (Vault verändert); 28 grün, 6 rot (`--ohne-gross`). Eine Prüfung allein genügt nicht: die zweite fängt es ab |
| Q5 | `vault-modified` aus der Warn-Bedingung entfernt | aa7c92e18d6c5ccc4ad097b035f8e677 | Q5 rot; der Lauf brach danach durch die Umgebung ab (Q5 steht davor im Log) |
| Q6 | Text ohne „at least“ | 2b05f8e5d200e6a6e2ccde8e9ad87e76 | Q6 rot; 33 grün, 1 rot, 13 übersprungen, 1 nichts gemessen (`--ohne-gross`) |
| Q4 | `replace` entfernt ein vorhandenes Ziel vor dem `rename` | d5024bb7c7ec3c54032f806e9b1b1a26 | NICHT GEMESSEN: drei Läufe brachen vor Q4 durch die Umgebung ab (Zeitüberschreitung bei `app.setting.open()`); später brachen auch zwei Läufe des unmutierten Builds in der Nacht ab (O10c), die Ursache ist die Umgebung (Rechner im Ruhezustand), nicht der Build. Die rote Gegenprobe zu Q4 steht aus |

Der Fokus-Rückfall auf die Gruppen-Summary (verschwindet das Ziel) ist im Smoke nicht erreichbar (der Smoke-Plan behält das Ziel) und wird im Unit-Test belegt: ohne den Rückfall ist `tests/view.test.ts` rot (1 von 27), mit ihm grün.
