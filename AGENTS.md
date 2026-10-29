# AGENTS.md

Orientierung für KI-Agenten und Mitwirkende an diesem Repository. Workspace-weite Standards (comply-or-explain): siehe `../../workspace/_docs/CONVENTIONS.md` (maintainer-lokal, nicht Teil dieses Repos, ignorieren, falls im Klon nicht vorhanden).

**Profil:** `ts-node` · `obsidian-plugin`.

**Stand 2026-10-29: Version 0.1.0 umgesetzt, release-reif, nicht veröffentlicht.** Kein Tag, kein Release, kein Push nach GitHub, kein Store-Eintrag; das fährt der Master (CORE-AGENT-14). GUI-Smoke gegen Obsidian 1.15.0: 38 grün, 0 rot, 1 übersprungen von 39 Punkten (Messung in `docs/SMOKE.md`).

## Project character

**Projekt:** `docs-mirror` (Docs Mirror), ein Obsidian-Plugin, das die `docs`-Ordner vieler Repos einseitig (Repo nach Vault) in einen kleinen, eigenen Vault spiegelt. Desktop-only, weil die Quelle mit Node `fs` gelesen wird. Auslöser sind ein Befehl, der Knopf in der Seitenleiste und der Schalter „Beim Vault-Start synchronisieren“ (Standard aus); kein Dauerlauf, kein Dateiwächter. Das Telefon bekommt die Dateien über Obsidian Sync, nicht über das Plugin. Autor: Johannes Kaindl.

**Spec und Plan (verbindlich):** Coding-Cockpit, `25_Coding/obsidian-plugins/_SDD/2026-10-28-docs-mirror-design.md` und `…-docs-mirror-plan.md` (CORE-META-14: Specs, Pläne und Task-Reports leben im Cockpit, nicht im Repo). Anlass, Store-Nachbarn und Entscheidungen: Tasks `_Tasks/Docs-Spiegel-Plugin — …` und `_Tasks/Docs-Mirror — …` im Cockpit.

**Anti-Ziele (aus der Spec, gelten bei jeder Änderung):** keine Datei im Vault geht verloren, die nicht vom Plugin stammt; ein falscher oder leerer Quellpfad leert den Vault nicht; der Vault-Start wird nicht langsamer; der Vault wächst nicht unbemerkt über das Sync-Kontingent; ein Abbruch hinterlässt keine halbe Datei.

## Architektur-Karte

```
src/main.ts                 Plugin: Befehle, Ribbon, Startlauf (2000 ms nach onLayoutReady), Läufe, Host der Ansicht
src/core/                   rein, ohne obsidian-Import (check:pure)
  settings.ts               DocsMirrorSettings, loadSettings, validateRoot, parseList
  scan.ts                   scanSource: Quelle → Dateien, Kollisionen, unlesbare Ordner; Symlinks und Übergrößen werden übersprungen
  plan.ts                   buildPlan: Scan + Manifest + Vault → Klassen (new, changed, unchanged, delete, conflict, vault-modified, vault-only)
  guards.ts                 checkGuards: Löschschutz, Schwelle, Fingerabdruck, Gesamtgröße, Konflikte
  apply.ts                  applyPlan: erst Löschungen, dann Schreiben über Temp-Datei, Teil-Manifest auch nach Abbruch
  runner.ts                 Lauf: Scan → Plan → Sicherungen → bestätigen oder ausführen; speichert Zustand
  manifest.ts, fingerprint.ts, run-info.ts, view-model.ts
src/obsidian/               einzige Stellen mit Vault- und Quellzugriff
  vault-io.ts               VaultPort über app.vault.adapter; Temp-Ordner unter configDir
  source-fs.ts              SourcePort über Node fs (lstat, nur lesend), nur Desktop
  device-state.ts           gerätelokaler Zustand über app.loadLocalStorage
  view.ts, plan-view.ts     Seitenleiste (ItemView) und Plan-Vorschau
  settings-tab.ts           Einstellungen (deklarativ, Kit-Walker als Fallback)
  confirm-run.ts            Bestätigung über den Kit-Dialog
src/i18n/strings.ts         alle Texte, EN kanonisch, DE vollständig
src/vendor/kit/, src/vendor/kit-obsidian/   Snapshots aus obsidian-kit 0.73.0 und code-kit 0.43.0 (je VENDOR.json), nie von Hand
fixtures/source, fixtures/vault   Quelle und Vault für den GUI-Smoke
scripts/gui-smoke.ts        CDP-Treiber gegen eine Zweitinstanz (Rezept im Dateikopf)
scripts/probe-adapter.ts    Adapter-Messung (docs/ADAPTER-MESSUNG.md)
```

## Commands

- `npm run gate` lintet, prüft Typen (Quelle, Tests, Skripte), testet, prüft die Reinheit des Kerns und baut; Pflicht vor jedem Commit.
- `npm run lint` (Zero Warnings), `npm run typecheck`, `npm run typecheck:test`, `npm test`, `npm run check:pure`, `npm run build` einzeln.
- `npm run deploy` baut und kopiert `main.js`, `manifest.json`, `styles.css` nach `$OBSIDIAN_PLUGIN_DIR`.
- `npm run smoke:gui -- --setup` baut Quelle und Vault im Staging (`$STAGING_VAULTS_DIR`); `npm run smoke:gui -- --port <port>` fährt den Smoke gegen die Zweitinstanz.
- `npm run probe:adapter -- --port <port>` misst die Adapter-Semantik neu.
- `python3 ../tools/treiber_check.py` prüft die Treiber-Regeln des Dachs.

## Conventions

- Texte ausschließlich in `src/i18n/strings.ts`; `tests/strings.test.ts` prüft die Schlüsselmengen. Zählformen heißen `<base>.one` und `<base>.many`.
- `src/core` bleibt obsidian-frei. Vor einer neuen Funktion `../REGISTRY.md` und `python3 ../tools/funktionsinventur/naehte_suche.py <wörter>`; neue exportierte reine Funktionen sind gate-pflichtig (`../tools/bibliothek/gate.py`).
- Vendorte Dateien nie von Hand editieren; Re-Vendoring läuft über das Dach (`tools/kit-sync`).
- In den Vault wird nur über `app.vault.adapter` geschrieben (`VaultPort`); die Quelle wird nur gelesen (`readdir`, `lstat`, `readFile`).
- CSS-Präfix `dmr-`, nur Theme-Variablen, kein `!important`, kein `:has()` (heute in `styles.css` gemessen: keines davon).
- Markdown-Dateien: ein Absatz je Zeile.
- Release nur über den Master (CORE-AGENT-14); `npm run release` braucht das Dach (`../tools/release/`).

## Gotchas

- **Adapter-Semantik (2026-10-28, Obsidian 1.15.0, `docs/ADAPTER-MESSUNG.md`):** `rename` wirft, wenn das Ziel existiert, und wenn der Elternordner fehlt. Darum: Ziel vorher entfernen (`replace`), Elternordner vor dem Schreiben anlegen (`mkdirp`).
- **`rmdir(path, false)` wirft auch auf einem leeren Ordner** (EISDIR). `removeIfEmpty` prüft zweimal per `list` und ruft dann `rmdir(dir, true)`; Restfenster: legt in Millisekunden ein anderer Prozess eine Datei an, wird sie mitgelöscht.
- **`adapter.list` nennt Dateien im configDir** (`.obsidian/…`); der Port schließt configDir aus.
- **`stat` direkt nach `rename` sieht die Datei, der Vault-Index (`getAbstractFileByPath`) noch nicht.** Darum nur über den Adapter arbeiten, nie über TFile.
- **Temp-Datei-Folge:** scheitert `rename` nach dem Entfernen des Ziels, fehlt die Datei. Der Manifest-Eintrag entfällt, der nächste Lauf schreibt sie als neu; `clearTemp` räumt Reste. Ob Obsidian Sync den Temp-Ordner (`<configDir>/plugins/docs-mirror/tmp`) hochlädt, ist ungemessen (Task-Note im Cockpit, vor dem ersten großen Lauf zu klären).
- **Gerätelokaler Zustand:** Wurzel, Manifest, Fingerabdruck und letzter Lauf liegen in `app.loadLocalStorage` je Vault und Gerät, nie in `data.json` und nie im Vault. Ein zweites Gerät startet „nicht eingerichtet“. Ein Manifest über 2 MB meldet eine Notice.
- **Wurzel pro Lauf eingefroren:** `perform` baut den Quellanschluss einmal. Ein Wurzelwechsel mitten im Lauf wirkt erst im nächsten Lauf (Smoke O7, 2026-10-28).
- **Fokus beim Neuaufbau:** `render()` merkt den Fokus über `data-dmr-focus`; ohne das fiel er auf `body` (Smoke O4c, Commit 74c5da7, 2026-10-28).
- **Ordnermuster kennen keine Brace-Globs.** `**/{docs,doc}` ist ein wörtliches Muster und trifft nur einen Ordner namens `{docs,doc}` (gemessen 2026-10-29 mit `src/vendor/kit/ignore.ts`). Je Zeile ein Muster schreiben. Der Kommentar in `src/core/settings.ts` (`parseList`) nennt Brace-Globs noch als Fall; das ist ein Befund, kein Verhalten.
- **Kollisionen auf APFS:** Namen, die sich nur in Groß- und Kleinschreibung oder in NFC/NFD unterscheiden, zählen als Konflikt `case-collision` und werden nie überschrieben (Messung 2026-10-28: `gross.md` trifft `Gross.md`, NFD trifft NFC).
- **Symlinks und Dateien über `maxFileBytes` oder mit fremder Endung fallen aus dem Scan.** War so eine Datei schon gespiegelt, plant der Lauf ihre Löschung im Vault. Das ist gewollt (Spec § 3), gehört aber in die Nutzer-Doku.
- **Die Schwelle ist im Code `>=`, im Einstellungstext steht „mehr als“.** Gemessen im Code (`src/core/guards.ts`), nicht geändert; Befund für den Master.
- **Dach-Suche:** `grep` ist auf diesem Rechner ugrep und respektiert `.gitignore`; für Suchen über Repos `/usr/bin/grep` (Belege 2026-09-16, 2026-10-03).

## Abweichungen von der Leitkonvention

Keine gegen die Leitkonvention. Abweichungen von der Spec, vom Master übernommen (Task-Note „Plan weicht in drei Punkten von der Spec ab“, 2026-10-28): Vorschau ohne `buildReviewList`, Klasse `vault-missing`, eigene Schreibfolge statt atomarem Ersetzen.

Offen (Stand 2026-10-29): `devDependencies.obsidian` steht auf `latest`, die Lock-Datei auf 1.13.1; Pinnen ist noch nicht entschieden. Die Hilfe-Zeile in den Einstellungen verlinkt auf GitHub (`docs/README.md` und Issues); dieses Ziel existiert vor dem ersten Release nicht.
