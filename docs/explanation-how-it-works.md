# Why one way, why a record, what Docs Mirror deletes

This page explains the thinking behind Docs Mirror: what it promises, how it keeps the promise, and what has been measured. The labels are the English interface texts; the German interface uses the names in parentheses.

## Why one way

Your repositories are the source of truth. The vault is a reading view that exists so that you can read the documentation, for example on your phone. Because of that, changes flow in one direction only, from the repository into the vault. Nothing you write in the vault is copied back, and the plugin has no way to write into a repository: it reads the source only.

The price is that an edit you make in the vault is not safe. If you change a mirrored file in the vault and the source still exists, the next run overwrites your edit with the source version. The plan shows such files under **files edited in the vault** (im Vault veränderte Dateien), and a run without other reasons does not ask. Make your edits in the repository.

## Why a record

The vault may hold files that do not come from the plugin: your own notes, files from other tools. To tell them apart, the plugin keeps a record of every file it mirrored, with its paths, sizes, times and a hash of its content. The plugin only ever deletes or overwrites a file that is in the record.

The record is stored on this device only, together with the source root and the last run. It is not in the vault and does not travel through Obsidian Sync. This has consequences:

- A second device starts "not set up" and has no record. Its first run waits for confirmation. A file that already lies in the vault with the same content as the source is taken over without writing; a file with different content is a conflict that is overwritten only if you tick it.
- Mirror into one vault from one device only. Two devices with two records would overwrite each other's files.
- If the record is lost, for example because the local storage of the vault was cleared, the next run is a first run again and nothing is deleted on the way: the old mirrored files are taken over, or show up as conflicts or as files only in the vault.

## What the plugin deletes, and what never

It deletes a file from the vault only if all of these hold:

- the file is in the record,
- its source is gone or no longer in the scan, because it was deleted or renamed, became a symbolic link, grew above the largest file size, has a file type you no longer list, or lies in a folder that no longer matches the patterns or is excluded,
- the vault copy is as the plugin wrote it.

A source file that turns into a symbolic link, or grows above the size limit, drops out of the scan and is deleted from the vault. This is intended: the vault shows what the scan would copy today. Folders that a deletion leaves empty are removed too.

It never touches:

- files that are not in the record (**files only in the vault**),
- a mirrored file whose source disappeared if you edited it in the vault: it stays, and the plugin forgets it so that it is never deleted later,
- a conflict you did not tick, and conflicts with a folder, with a name that differs only in case or Unicode form, or with an unreadable source file, ever,
- anything at all when the source root is missing, cannot be read or yields no files,
- files below a source folder that could not be read; they count as "not checked".

## Further safeguards

- A run asks first when it is the first run, when it deletes many files (at least 20 files and 20 percent of the recorded ones), when the settings changed, when the mirror would exceed the total size limit, and when conflicts exist. The reference lists the [reasons](reference-plan.md).
- The vault does not start slower. The start run is off by default; if you turn it on, it begins 2,000 milliseconds after the workspace is ready and never opens a dialog. While a run works, the plugin hands control back to the interface at short intervals.
- The vault does not grow unnoticed. The plan always shows how large the vault would be afterwards, and the total size limit asks before the mirror exceeds it. Obsidian Sync has a storage quota; check the size before you connect a large source.
- No half-written file. The plugin writes each file to a temporary file in the plugin's folder, reads it back and compares it with the source bytes, and only then replaces the target. If the replacement itself fails, the file is missing, never half written, and the next run writes it again as new. A source file that changes during the run is reported as an error and skipped.
- Cancelling is safe. The file being written is finished, the next one is not started, and the record keeps what was written.

## What is measured, and what is not

- The GUI smoke test ran against Obsidian 1.15.0 on macOS: 47 points green, 0 red, 1 skipped of 48. The skipped point is the mobile case, which is covered by a test against a mock only. The details are in [SMOKE.md](SMOKE.md).
- Windows and Linux are not measured. A source root with a drive letter passes the path check, but nobody has run it.
- Mobile is not measured because the plugin is desktop-only and does not load there. The phone gets the files through Obsidian Sync.
- Whether Obsidian Sync uploads the plugin's temporary folder is not measured.
- One run per state: every measured case ran once (n=1). Themes and font sizes other than the default are not measured.
