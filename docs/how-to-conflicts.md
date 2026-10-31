# What does a conflict mean, and what do I do?

The sync plan sorts every file into a group before anything is written. This guide goes through each group and says what to do. The labels are the English interface texts; the German interface uses the names in parentheses. The full list with all details is in the [plan reference](reference-plan.md).

## Groups you do not have to act on

- **new files** (neue Dateien): the file is in the source and not yet in the vault. The run writes it. A note "Missing in the vault: written again." means the plugin mirrored the file before and you deleted it from the vault; the run writes it again.
- **changed files** (geänderte Dateien): the source changed and the vault copy is untouched. The run replaces the vault copy.
- **unchanged files** (unveränderte Dateien): nothing to do. This is a count line, not a group.
- **files to delete** (zu löschende Dateien): the source file is gone, or it now falls outside the scan (renamed, symbolic link, above the size limit, file type not listed, folder no longer matched), and the vault copy is untouched. The run deletes the vault copy and any folder that the deletion leaves empty. Read this group before you confirm, especially after a settings change.
- **files only in the vault** (Dateien nur im Vault): the plugin never touches them. Nothing to do.

## Files edited in the vault

**files edited in the vault** (im Vault veränderte Dateien): the plugin mirrored the file, you changed the vault copy, and the source still exists. The run overwrites your edit with the source version. This group does not ask for a tick and is not a reason for confirmation on its own: a run without other reasons overwrites these files directly. If you want to keep the edit, copy it into the source (the repository) or into another note before you run. The confirmation dialog marks such a run with a warning-styled **Run plan** button.

## Conflicts

A **conflict** (Konflikt) is a file that already lies at the target path in the vault and that the plugin did not create. While any conflict exists, the run waits for your confirmation, and so does every later run until the conflict is gone.

If the vault file has exactly the content of the source file, it is not a conflict: the plugin takes it over into its record without writing, and it counts as unchanged.

Every conflict row carries a note. What to do depends on the note:

- **"Already in the vault and not created by this plugin."** (Liegt schon im Vault und stammt nicht von diesem Plugin.) The content differs. Either tick the box in front of the file to overwrite it with the source version, or leave it unticked to skip it. **Overwrite all** (Alle überschreiben) ticks every conflict that may be overwritten, including those hidden behind "… and N more"; **Overwrite none** (Keine überschreiben) clears the ticks. To keep both versions, rename or move the file in the vault first and sync again.
- **"A folder lies at this path: not overwritten."** (An diesem Pfad liegt ein Ordner.) A folder in the vault has the name of a source file. Rename or remove the folder in the vault, then sync again.
- **"Another file differs only in case or Unicode form: not overwritten."** (Eine andere Datei unterscheidet sich nur in Groß- und Kleinschreibung oder Unicode-Form.) Two names differ only in case or Unicode form, for example `Readme.md` and `README.md`, and would clash on a case-insensitive file system. The pair can be two source files or a source file and a vault file; the plugin overwrites neither. Rename one of them, then sync again.
- **"The source file could not be read: not overwritten."** (Die Quelldatei ließ sich nicht lesen.) Check the permissions of the file in the repository, then sync again.

The last three kinds are never overwritten, and they have no box to tick. The first kind is overwritten only for the files you ticked. Everything you do not tick stays as it is and counts as skipped.

## After the run

Click **Run plan** (Plan ausführen) in the sidebar and confirm in the dialog. If the plan changed between your confirmation and the execution, the run waits again and shows the new plan. The **Last run** (Letzter Lauf) card shows the counts: New, Changed, Unchanged, Deleted, Overwritten, Skipped, Errors.
