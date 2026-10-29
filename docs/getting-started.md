# Getting started with Docs Mirror

This guide sets up Docs Mirror once on a desktop computer. The labels are the English interface texts; the German interface uses the names in parentheses.

## 1. Create a docs vault

Create a new, empty vault for the mirror, separate from your workspace. Do not use the workspace itself as the vault: the mirror would then copy its own files.

## 2. Enable the plugin

Copy `main.js`, `manifest.json` and `styles.css` into `<vault>/.obsidian/plugins/docs-mirror/` (see the installation section of the README).

Then open Settings, go to Community plugins, and enable **Docs Mirror**. (Deutsch: Community-Plugins, Docs Mirror aktivieren.)

## 3. Set the source root

Open the plugin's settings and fill in **Source root** (Quellordner) with the absolute path of the folder that contains your repositories. Write the full path: `~` is not expanded, and relative paths are refused.

Leave the field by clicking elsewhere; the value is saved when the field loses focus. Until a root is set, the sidebar shows **Not set up** (Nicht eingerichtet).

The root is stored on this device only. Set it again on every computer you mirror from.

## 4. Confirm the first run

Open the sidebar with the ribbon icon or the command **Open Docs Mirror** (Docs Mirror öffnen), then click **Sync now** (Jetzt synchronisieren).

The first run never writes directly. The sidebar shows the **Sync plan** (Sync-Plan) with the new files and the size the vault would have afterwards. Check it and tick any conflict you want to overwrite.

Clicking **Run plan** (Plan ausführen) in the sidebar opens a second dialog titled **Run the plan?** (Plan ausführen?), with the buttons **Run plan** and **Cancel** (Abbrechen). Only the button in this dialog writes; **Cancel** in the dialog writes nothing.

Later runs go through without a question unless one of these reasons applies: a run deletes many files, the settings changed since the last run, the mirror would exceed the total size limit, or there are conflicts with files the plugin did not create. Conflicts are overwritten only when you tick them.

## 5. Read on the phone through Obsidian Sync

Connect the docs vault to Obsidian Sync on your phone and let it sync. The plugin does not run on mobile devices, and it does not need to: the phone receives the files through Sync.

Check the vault size in the sync plan before you connect a large source. Sync has a storage quota.
