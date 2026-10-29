# Changelog

All notable changes to this project are documented here. The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html) (without a `v` prefix).

## [0.1.0] - Unreleased

### Added

- One-way mirror from the source root into the vault: new, changed, unchanged, deleted, conflicting and vault-only files are classified before anything is written.
- Plan preview in the sidebar, grouped by class; the first run and runs with a reason wait for confirmation.
- Per-device record of mirrored files: only files recorded there are deleted or overwritten.
- Conflicts with files the plugin did not create are never overwritten unless ticked.
- Safeguards: no deletion when the source root is missing or yields no files; confirmation for the first run, for many deletions, for changed settings and for the total size limit.
- Start run when the vault loads (off by default); it waits in the sidebar and opens no dialog.
- Writes through temporary files, verified against the source bytes before replacing the target.
- Settings for the source root, folder patterns, excluded names, file types, largest file, total size limit, confirmation threshold, dot folders and the start run.
- Commands "Open Docs Mirror", "Sync docs now" and "Show sync plan", and a ribbon icon.
- Interface texts in English (canonical) and German.
- Desktop only; the plugin reads the source with Node.js.
