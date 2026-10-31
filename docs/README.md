# Docs Mirror documentation

This is the index of the user documentation, ordered after the Diátaxis scheme: a tutorial, how-to guides, reference pages and an explanation. The short overview of the plugin is in the [README](../README.md). The labels in the pages are the English interface texts; the German interface names stand in parentheses.

## Tutorial

- [Getting started](getting-started.md) sets up Docs Mirror once on a desktop computer: create a docs vault, enable the plugin, set the source root, confirm the first run and read the vault on the phone through Obsidian Sync.

## How-to guides

- [Adjust the folder patterns](how-to-folder-patterns.md) shows how to choose which folders are mirrored: one pattern per line, the default `**/docs`, several folder names, leaving a folder out, and why curly braces are taken literally.
- [What does a conflict mean, and what do I do?](how-to-conflicts.md) goes through every group of the sync plan and says what to do with it: edited files, conflicts of each kind, and what overwriting costs.

## Reference

- [Settings](reference-settings.md) lists every setting with its default and its effect, and says which settings make the next run ask.
- [Sync plan](reference-plan.md) lists the plan groups, the kinds of conflict, the five reasons for confirmation, the cases in which a run refuses, the counters of the last run and the status words.
- [Commands, buttons and messages](reference-commands.md) lists the commands, the sidebar buttons and every notice with its cause and what to do. Start here when something does not work.

## Explanation

- [Why one way, why a record, what Docs Mirror deletes](explanation-how-it-works.md) explains why changes flow only from the repository into the vault, what the per-device record is for, which files the plugin deletes and which it never touches, the safeguards, and what has been measured and what has not.

## Measurements for maintainers

- [SMOKE.md](SMOKE.md) holds the GUI smoke test against a running Obsidian (German).
- [ADAPTER-MESSUNG.md](ADAPTER-MESSUNG.md) holds the measurement of the vault adapter that the write sequence rests on (German).
