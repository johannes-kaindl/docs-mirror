# Sync plan reference

Before it writes, Docs Mirror builds a plan and sorts every file into a class. This page lists the classes, the reasons a run waits for confirmation, the cases where it refuses to run, and the counters of the last run. The labels are the English interface texts; the German interface uses the names in parentheses.

## Plan groups

The sidebar shows a group per class, with the path of each file. A group lists at most 200 paths and ends with "… and N more". **files to delete** and **files edited in the vault** are open by default.

| Group | Meaning | What the run does |
|---|---|---|
| **new files** (neue Dateien) | In the source, not in the vault. With the note "Missing in the vault: written again.", the plugin mirrored it before and the vault copy is gone. | Writes the file. |
| **changed files** (geänderte Dateien) | Recorded file, source changed, vault copy untouched. | Replaces the vault copy. |
| **unchanged files** (unveränderte Dateien) | Source and vault agree. Shown as a count, not as a group. A file in the vault with the same content as the source, not yet recorded, is counted here and taken into the record. | Nothing. |
| **files to delete** (zu löschende Dateien) | Recorded file whose source is gone or no longer in the scan, vault copy untouched. | Deletes the file and any folder the deletion leaves empty. |
| **files edited in the vault** (im Vault veränderte Dateien) | Recorded file whose vault copy you changed, source still present. | Overwrites your edit with the source version, without a tick. |
| **conflicts** (Konflikte) | A file lies at the target path that the plugin did not create and whose content differs. | Overwrites only what you ticked. Some kinds are never overwritten, see below. |
| **files only in the vault** (Dateien nur im Vault) | Files the plugin did not create, and recorded files whose source is gone but that you edited. Shown apart, below the other groups. | Never touches them; for an edited recorded file, the plugin forgets it so that it is never deleted later. |

Above the groups, the card lists the reasons for confirmation, and notes: "Not checked: N files in unreadable folders" (recorded files below a source folder that could not be read are neither checked nor deleted) and "The vault would be X afterwards" (the size of the whole mirror after the run).

A file leaves the scan, and a recorded vault copy becomes a deletion, when it is deleted or renamed in the source, becomes a symbolic link, grows above the largest file size, has a file type that is not listed, or lies in a folder that no longer matches or is excluded.

### Kinds of conflict

| Note | Overwritable | Cause |
|---|---|---|
| "Already in the vault and not created by this plugin." (Liegt schon im Vault und stammt nicht von diesem Plugin.) | yes, with a tick | A file with different content lies at the target path. |
| "A folder lies at this path: not overwritten." (An diesem Pfad liegt ein Ordner: wird nicht überschrieben.) | never | A folder lies at the path of a source file. |
| "Another file differs only in case or Unicode form: not overwritten." (Eine andere Datei unterscheidet sich nur in Groß- und Kleinschreibung oder Unicode-Form: wird nicht überschrieben.) | never | Two names differ only in case or Unicode form. |
| "The source file could not be read: not overwritten." (Die Quelldatei ließ sich nicht lesen: wird nicht überschrieben.) | never | Reading the source file failed. |

Conflicts you do not tick count as skipped. See [What does a conflict mean](how-to-conflicts.md).

## Reasons for confirmation

A run waits for confirmation if at least one of these five reasons applies. The sidebar shows the plan and the reasons, **Run plan** (Plan ausführen) opens the dialog "Run the plan?" (Plan ausführen?), and only the button in the dialog writes. **Cancel** (Abbrechen) in the dialog writes nothing and the plan keeps waiting.

| Reason | Text in the interface | When |
|---|---|---|
| First run | "First run: check the plan before anything is written." | This device has no record of mirrored files yet. |
| Threshold | "This run deletes at least as many files as the threshold, and at least 20 percent of the recorded files." | The run deletes at least the threshold number of files (default 20) and at least 20 percent of the recorded files. |
| Settings changed | "Settings changed since the last run, or the state of this device is unknown." | The settings fingerprint differs from the saved one, or a record exists without a saved fingerprint. |
| Total size | "The files to mirror exceed the total size limit." | The size of the whole mirror after the run is larger than the total size limit. |
| Conflicts | "Some files already exist in the vault and were not created by this plugin." | The plan contains at least one conflict, of any kind. |

The dialog also lists the counts of new, changed, deleted, edited and conflicting files, the vault size afterwards, and how many files you ticked to overwrite. The **Run plan** button is warning-styled if the run deletes files, overwrites edited files or overwrites ticked conflicts.

If the plan changes between your confirmation and the execution (other counts, or other paths among the deletions, edits and conflicts), or a new reason appears, the run waits again with the new plan.

Edited files alone are not a reason: a run without any of the five reasons overwrites them without asking.

## Runs that refuse

In these cases nothing is written and nothing is deleted; a notice says why.

- The source root is not set, or this device has not set it up.
- The source root cannot be read ("Source unreachable").
- The source root yields no files to mirror ("the source is empty").
- The source root is the vault itself.

If the vault lies below the source root, the scan leaves the vault out, so the mirror is never read as a source. A symbolic link to the vault is resolved before the comparison.

## Counters of the last run

The **Last run** (Letzter Lauf) card shows the time and these counters. The card is hidden while a run is in progress; the status line shows the progress instead: "entries read" while the source folders are scanned (the total is not known yet), then "files of total" while files are written. If the first number stops growing, the scan is stuck, not slow.

| Counter | Counts |
|---|---|
| New (Neu) | Files written that were not in the vault. |
| Changed (Geändert) | Files replaced, including edited files overwritten with the source version. |
| Unchanged (Unverändert) | Files that needed nothing. |
| Deleted (Gelöscht) | Files deleted from the vault. |
| Overwritten (Überschrieben) | Conflicts you ticked and the run overwrote. |
| Skipped (Übersprungen) | Files the scan left out (symbolic links, files above the size limit, file types not listed) and conflicts that were not overwritten. |
| Errors (Fehler) | Files that failed, for example because the source file changed during the run. They are tried again at the next run. |

## Status words

Not set up (Nicht eingerichtet), Never run (Nie gelaufen), Running (Läuft), Waiting for confirmation (Wartet auf Bestätigung), Source unreachable (Quelle nicht erreichbar), Error (Fehler), Up to date (Aktuell). Each status has an icon and a text; the color alone carries nothing.
