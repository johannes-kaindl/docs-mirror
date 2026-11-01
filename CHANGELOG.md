# Changelog

All notable changes to this project are documented here. The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html) (without a `v` prefix).

## [0.1.0] - Unreleased

First version. Not released yet.

### Added

- One-way mirror from the source root into the vault: the `docs` folders of many repositories keep their path below the root, so relative links inside a `docs` folder keep working.
- Folder patterns in `.gitignore` style, default `**/docs`: one pattern per line, `!` takes a folder out again, curly braces match literally, lines the plugin cannot read are ignored with a warning.
- Plan before any write: files are classified as new, changed, unchanged, to delete, edited in the vault, conflict, or only in the vault. The sidebar shows the plan in one group per class (at most 200 paths each), the size the vault would have afterwards, and the files that could not be checked in unreadable folders.
- Confirmation for five reasons: the first run, many deletions (at least 20 files and 20 percent of the recorded files), changed settings, a mirror above the total size limit, and conflicts. If the plan changes between confirmation and execution, the run waits again with the new plan.
- Per-device record of mirrored files (path, sizes, times, content hash), kept in local storage and never in the vault: only recorded files are deleted or overwritten.
- Conflicts with files the plugin did not create are never overwritten unless you tick them ("Overwrite all" and "Overwrite none" are available). A file with the same content is taken over into the record without a write. Conflicts of case, Unicode form, folder type or an unreadable source file are never overwritten.
- Files edited in the vault are overwritten with the source version; the confirmation dialog marks such a run with a warning-styled button. A recorded file whose source is gone but that was edited in the vault stays, and the plugin forgets it.
- Safeguards: nothing is deleted when the source root is missing, unreadable or yields no files; the vault is left out of the scan when it lies below the source root (symbolic links are resolved), and a run whose source root is the vault itself is refused.
- Writes go through temporary files that are read back and compared with the source bytes before they replace the target; a source file that changes during the run is reported as an error and skipped. Cancelling finishes the file being written and keeps the record of what was written.
- Start run when the vault loads (off by default): it begins 2,000 ms after the workspace is ready, opens no dialog, and waits in the sidebar with a notice if it needs confirmation.
- Sidebar with a status line (icon and text, never color alone), progress (entries read while the source is scanned, then files written), a cancel button and a card for the last run with its counters; the card is hidden while a run is in progress.
- Settings for the source root (per device), folder patterns, excluded names, file types, largest file, total size limit, confirmation threshold, dot folders and the start run.
- Commands "Open Docs Mirror", "Sync docs now" and "Show sync plan" (opens the sidebar with a plan that is already waiting), and a ribbon icon.
- Interface texts in English (canonical) and German.
- Documentation after Diátaxis: getting started, how-to guides for folder patterns and conflicts, references for settings, plan and commands, and an explanation of the one-way design, the record and the safeguards, indexed in `docs/README.md`.
- Desktop only; the plugin reads the source with Node.js. Measured so far: Obsidian 1.15.0 on macOS; Windows, Linux and mobile are not measured.
