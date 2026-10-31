# Docs Mirror

> 🇬🇧 English · [🇩🇪 Deutsch](README.de.md)

Docs Mirror copies the `docs` folders of many repositories, one way, into a small Obsidian vault. The repositories stay the source of truth. The vault is a reading view: it is never written back into a repository.

Version 0.1.0, not yet released. The plugin is desktop-only because it reads the source folders with Node.js. On your phone, read the vault through Obsidian Sync; the plugin does not run there.

## What it does

- Finds every folder that matches the folder patterns (default `**/docs`) under one source root, so a new repository appears without any configuration.
- Keeps each file under its path below the source root, so relative links inside a `docs` folder keep working.
- Builds a plan before it writes: new, changed, unchanged, to delete, conflicts, and files that exist only in the vault.
- Shows the plan in the sidebar. The first run always waits for your confirmation. If the plan changes between your confirmation and the execution, the run waits again and shows the new plan.
- Deletes and overwrites only files that the plugin mirrored, as recorded in its per-device list. A file already in the vault that the plugin did not create is a conflict: it is overwritten only when you tick it, and if its content equals the source it is adopted into the record without a write. Files that exist only in the vault are never touched.
- Overwrites files you edited in the vault with the source version. A run that waits for confirmation lists them as "edited in the vault"; a run without other reasons overwrites them directly.
- Refuses to delete anything when the source root is missing or yields no files.
- Asks for confirmation before a run with one of five reasons: the first run; many deletions (threshold); settings changed since the last run; the mirrored size exceeds the total size limit; conflicts. Conflicts are overwritten only when you tick them, and case and type conflicts are never overwritten. Details: [Sync plan reference](docs/reference-plan.md) and [What does a conflict mean](docs/how-to-conflicts.md).
- Skips symbolic links, hidden (dot) folders unless you include them, files above the size limit, and file types you did not list.
- Writes each file through a temporary file, so no file is ever left half-written; an interrupted replacement can leave a file missing until the next run restores it.

## Installation

The plugin is not yet in the community plugin store.

To install it by hand, copy `main.js`, `manifest.json` and `styles.css` into `<vault>/.obsidian/plugins/docs-mirror/` and enable the plugin in the community plugins settings.

To build it from source, run `npm install` and then `npm run build`.

For a first setup, follow [docs/getting-started.md](docs/getting-started.md). The rest of the documentation is indexed in [docs/README.md](docs/README.md).

## Settings

- **Source root:** the absolute path of the folder whose repositories are mirrored. It is stored per device and must be set on each device.
- **Folder patterns:** one pattern per line, relative to the source root. Matching folders are mirrored with everything below them. See [Adjust the folder patterns](docs/how-to-folder-patterns.md).
- **Excluded names:** folder and file names that are never mirrored, separated by commas. Defaults: `node_modules`, `.git`, `dist`, `build`, `__pycache__`, `.venv`.
- **File types:** extensions that are mirrored, separated by commas. Defaults: `md`, `canvas`, `base`, `png`, `jpg`, `jpeg`, `gif`, `svg`, `webp`, `pdf`.
- **Largest file:** files above this size are skipped. Default: 5 MB.
- **Total size limit:** a run that would leave more data in the vault than this asks for confirmation first. Default: 1 GB.
- **Confirmation threshold:** a run that deletes at least this many files, and at least a fifth of the mirrored files, asks for confirmation first. Default: 20 files. The one-fifth share is fixed and not adjustable.
- **Dot folders:** include folders whose names start with a dot. Off by default.
- **Sync when the vault starts:** run a sync two seconds after the workspace is ready. Off by default. If the run needs confirmation, it waits in the sidebar and shows a notice instead of a dialog. The start run is skipped silently if a run, a confirmation or a waiting plan already exists. Every setting in detail: [Settings reference](docs/reference-settings.md).

## Commands

- **Open Docs Mirror:** opens the sidebar. A ribbon icon does the same.
- **Sync docs now:** runs a sync. The sidebar button does the same.
- **Show sync plan:** opens the sidebar with a plan that is waiting for confirmation. If no plan is waiting, it says so. All commands, buttons and messages: [docs/reference-commands.md](docs/reference-commands.md).

## Limits

- The mirror is one way. Changes in the vault are never copied back to the repositories. Why, and what is measured: [docs/explanation-how-it-works.md](docs/explanation-how-it-works.md).
- There is no file watcher and no schedule. A sync runs when you start it or, if you turned it on, when the vault starts.
- A mirrored file is deleted from the vault when its source disappears, becomes a symbolic link, exceeds the size limit or changes to a type you did not list, but only if you did not edit it in the vault; an edited file stays there, and the plugin forgets it and never deletes it.
- Links that leave the `docs` folder, such as `../src/…`, break in the vault.
- The plugin does not read `.gitignore`. Use the excluded names and folder patterns instead.
- Mirror into one vault from one device only; each device keeps its own record, so two devices would overwrite each other's files.
- The total size limit compares the size of the mirror after the run with the limit, not the growth of a single run.

## Status

Version 0.1.0. Screenshots and the store listing are still to come.
