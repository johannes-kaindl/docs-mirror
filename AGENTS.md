# AGENTS.md

Orientierung für KI-Agenten und Mitwirkende an diesem Repository. Workspace-weite Standards (comply-or-explain): siehe `../../workspace/_docs/CONVENTIONS.md` (maintainer-lokal, nicht Teil dieses Repos, ignorieren, falls im Klon nicht vorhanden).

**Profil:** `ts-node` · `obsidian-plugin`.

**Stand 2026-10-28: Repo angelegt, noch kein Code.** Der Entwurf ist freigegeben, der Plan fehlt. Reihenfolge: Kit-first-Sondierung (`../AGENTS.md`, `../REGISTRY.md`), dann `superpowers:writing-plans` gegen die Spec, dann TDD.

## Project character

**Projekt:** `docs-mirror` (Docs Mirror), ein Obsidian-Plugin, das die `docs`-Ordner vieler Repos einseitig (Repo nach Vault) in einen kleinen, eigenen Vault spiegelt. Desktop-only. Auslöser ist eine Schaltfläche in der Seitenleiste und ein Schalter für den Lauf beim Vault-Start; kein Dauerlauf, kein Dateiwächter. Das Telefon bekommt die Dateien über Obsidian Sync, nicht über das Plugin. Autor: Johannes Kaindl.

**Spec (verbindlich):** Coding-Cockpit, `25_Coding/obsidian-plugins/_SDD/2026-10-28-docs-mirror-design.md` (CORE-META-14: Specs und Pläne leben im Cockpit, nicht im Repo). Plan und Task-Reports gehören ebenfalls dorthin. Task mit Anlass, Store-Nachbarn und Entscheidungen: `25_Coding/obsidian-plugins/_Tasks/Docs-Spiegel-Plugin — …`.

**Anti-Ziele (aus der Spec, gelten bei jeder Änderung):** keine Datei im Vault geht verloren, die nicht vom Plugin stammt; ein falscher oder leerer Quellpfad leert den Vault nicht; der Vault-Start wird nicht langsamer; der Vault wächst nicht unbemerkt über das Sync-Kontingent; ein Abbruch hinterlässt keine halbe Datei.

## Architecture principles

**PROF-OBS-03/04 — reiner Kern ohne `obsidian`-Import.** `src/core/` ist obsidian-frei und in Node ohne DOM testbar; nur `main.ts` und `src/obsidian/` importieren `obsidian`. `npm run check:pure` nagelt das fest (Muster: `../shadow-tree`).

**Kit-first.** Vor jeder neuen Funktion `../REGISTRY.md` und `python3 ../tools/funktionsinventur/naehte_suche.py <wörter>`. Geteilte Bausteine liegen als Snapshot unter `src/vendor/` mit Herkunfts-Header und `VENDOR.json`, nie von Hand editieren (`tools/kit-sync`). Neue exportierte reine Funktionen ohne `obsidian`-Import sind gate-pflichtig (`../tools/bibliothek/gate.py`).

**Schreiben in den Vault über die Vault-API, Lesen der Quelle über `fs`** (lazy `require`, Desktop-Gate). Zustand (Wurzelpfad, Manifest, Einstellungs-Fingerabdruck) ist gerätelokal und gelangt nie auf ein anderes Gerät.

## Commands

Werden mit dem Gerüst eingetragen (`npm run gate` = lint + typecheck + test + check:pure + build, Pflicht vor jedem Commit; Muster `../shadow-tree/package.json`).

## Conventions

- Texte ausschließlich in `src/i18n/strings.ts`, EN kanonisch, DE vollständig (UI-STANDARD §10). CSS-Präfix `dmr-`, nur Theme-Variablen, kein `!important`, kein `:has()`.
- Vor jeder UI-Arbeit `../UI-STANDARD.md` und `../.claude/rules/ui-bausteine.md`; vor einer `styles.css` `../.claude/rules/store-css.md`.
- Zero Warnings vor Veröffentlichung (0 Errors und 0 Warnings, Store-Scorecard „Passed“).
- Markdown-Dateien: ein Absatz je Zeile.
- **Ein Release ist kein Minion-Auftrag** (CORE-AGENT-14): die Umsetzungs-Session meldet „release-reif“, der Master fährt Tag, Mirror und Store-Rescan.

## Gotchas

Noch keine gemessenen. Eintragen, sobald eine Falle Zeit gekostet hat, mit Datum und Beleg.

## Abweichungen von der Leitkonvention

Keine bekannt (Stand 2026-10-28).
