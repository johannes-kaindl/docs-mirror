# Settings reference

All settings of Docs Mirror, with their default and what they do. The labels are the English interface texts; the German interface uses the names in parentheses. Open them under Settings, Community plugins, **Docs Mirror**. Text fields save when you leave them, not on every keystroke.

At the top of the page, a help row has the buttons **Open documentation** (Dokumentation öffnen) and **Report an issue** (Problem melden).

## Where the values live

The source root is stored on this device only, together with the record of mirrored files, the settings fingerprint and the last run. It never reaches another device. The other settings are stored in the plugin's `data.json`.

## Settings

| Setting | Default | Effect |
|---|---|---|
| **Source root** (Quellordner) | not set | The absolute folder whose repositories are mirrored. Each repository's docs folder keeps its path below this root. `~` is not expanded, a relative path is refused, a trailing separator is removed. The field cannot be emptied. The root `/` is accepted with a warning, because every folder on the disk is then scanned. A path with a drive letter passes the check but is not measured. |
| **Folder patterns** (Ordnermuster) | `**/docs` | One pattern per line, relative to the source root. Matching folders are mirrored with everything below them. See [Adjust the folder patterns](how-to-folder-patterns.md). |
| **Excluded names** (Ausgeschlossene Namen) | `node_modules`, `.git`, `dist`, `build`, `__pycache__`, `.venv` | Folder and file names that are never mirrored, at any depth. Separate them with commas or line breaks. A name is compared whole and is case-sensitive. |
| **File types** (Dateitypen) | `md`, `canvas`, `base`, `png`, `jpg`, `jpeg`, `gif`, `svg`, `webp`, `pdf` | File extensions that are mirrored, without the dot, compared in lower case. A leading dot you type is removed. Files without an extension and all other types are skipped. |
| **Largest file** (Größte Datei) | 5 MB | Files larger than this are skipped. Given in megabytes; decimals are allowed. |
| **Total size limit** (Gesamtgrößen-Grenze) | 1024 MB (1 GB) | If the vault would be larger than this after the run, the run asks for confirmation first. It compares the size of the whole mirror after the run, not the growth of one run. Given in megabytes. |
| **Confirmation threshold** (Schwelle für Bestätigung) | 20 files | A run asks for confirmation if it deletes at least this many files and, in addition, at least 20 percent of the files the plugin has recorded for this device. The 20 percent are fixed. A whole number from 1. |
| **Dot folders** (Punkt-Ordner) | off | Include folders whose names start with a dot. Files whose names start with a dot are not affected by this setting. |
| **Sync when the vault starts** (Beim Vault-Start synchronisieren) | off | Runs a sync 2,000 milliseconds after the workspace is ready. The switch is read when the plugin loads, so a change counts from the next start. A run that needs confirmation waits in the sidebar and shows a notice; the plugin never opens a dialog at start. The start run is skipped without a message if a run, a confirmation or a waiting plan already exists. A successful start run is silent. |

## Settings that make the next run ask

The plugin keeps a fingerprint of the settings that decide what is mirrored: source root, folder patterns, excluded names, file types, largest file and dot folders. If the fingerprint differs from the one saved at the last complete run, the next run waits for confirmation (reason "Settings changed"). The confirmation threshold, the total size limit and the start run are not part of the fingerprint.
