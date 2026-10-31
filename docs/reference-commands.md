# Commands, buttons and messages

The commands, the sidebar buttons and the notices of Docs Mirror, with what to do about each message. The labels are the English interface texts; the German interface uses the names in parentheses.

## Commands

Open the command palette to run them. The plugin is desktop-only; on a phone it does not run.

| Command | Does |
|---|---|
| **Open Docs Mirror** (Docs Mirror öffnen) | Opens the sidebar and makes it visible, also when the right sidebar is collapsed. The ribbon icon (folder-sync) does the same. |
| **Sync docs now** (Docs jetzt synchronisieren) | Scans the source, builds the plan and runs it, or lets it wait for confirmation. The sidebar button **Sync now** does the same. |
| **Show sync plan** (Sync-Plan anzeigen) | Opens the sidebar with a plan that is already waiting for confirmation. It does not build a plan: if none is waiting, it says "No plan is waiting for confirmation." |

## Sidebar buttons

| Button | Shows when | Does |
|---|---|---|
| **Sync now** (Jetzt synchronisieren) | the plugin is set up, no plan is waiting, no run is in progress | Starts a run. |
| **Run plan** (Plan ausführen) | a plan waits for confirmation | Opens the dialog "Run the plan?" (Plan ausführen?); the button in the dialog writes. |
| **Sync now** next to **Run plan** | a plan waits for confirmation | Builds the plan again from the current state. |
| **Cancel** (Abbrechen) | a run is in progress | Stops the run. The file being written is finished, files already written stay in place, and the record keeps what was written. |
| **Open settings** (Einstellungen öffnen) | the plugin is not set up | Opens the settings of the plugin. |
| **Overwrite all** (Alle überschreiben), **Overwrite none** (Keine überschreiben) | a group has conflicts that may be overwritten | Ticks all of them, or clears all ticks. |

## Messages

Notices appear for a few seconds in the corner of the window. What to do:

| Message | Cause and what to do |
|---|---|
| "Sync blocked: Docs Mirror is not set up yet." | No source root on this device. Set it in the settings. |
| "Sync blocked: the source is unreachable. Nothing was deleted." | The source root does not exist or cannot be read. Check the path and the drive. |
| "Sync blocked: the source is empty. Nothing was deleted." | The root can be read, but no folder matches the patterns or no file qualifies. Check the folder patterns and the file types. |
| "Sync blocked: the source folder is this vault itself. Nothing was written." | The source root is the vault folder. Use a separate vault for the mirror. |
| "Sync needs confirmation: open the Docs Mirror sidebar." | A plan waits. Open the sidebar, read it and click **Run plan**. |
| "No plan is waiting for confirmation." | **Show sync plan** found no waiting plan. Use **Sync now**. |
| "Sync cancelled. Files already written stay in place." | You cancelled the run. Sync again. |
| "A sync is already running." | A second start came while a run was in progress. Wait or cancel. |
| "Sync finished: N changed, M deleted." | Done. N counts new, changed and overwritten files. |
| "Sync finished with errors: some files were skipped." | Some files failed, for example because a source file changed during the run. The next run tries them again. |
| "Sync failed. Nothing was deleted by the failed step." | The scan or the run failed as a whole. Sync again; if it repeats, report an issue. |
| "The sync state of this device has grown to X. Narrow the folder patterns to keep it small." | The record of mirrored files is larger than 2 MB. Narrow the folder patterns or the file types. |
| "Docs Mirror reads the source folder with Node.js and works on desktop only." | The plugin was started on a device that is not a desktop. |
