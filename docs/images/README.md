# Capture contract — README images

This folder holds the images that `README.md` and `README.de.md` embed, recorded by `scripts/shots.ts` against a second Obsidian instance. The source folders and the vault come from `docs/images/fixture/` (five invented repositories named `acme-*`; the vault holds one note of its own), not from the fixture of the GUI smoke.

## Classes

| Class | Embedding | Limit |
|---|---|---|
| `hero` | `width="820"`, centered, right after the badges | landscape (H ≤ W) |
| `feature` | `width="820"` | H/W ≤ 1.6 |
| `detail` | preview `width="380"`, linked to the full image | no height limit |

## Images

| File | Class | Referenced by | Must show |
|---|---|---|---|
| `hero.png` | hero | README (top) | The window in the light theme: the file explorer with the mirrored repositories, one mirrored note open, and the sidebar with a sync plan that waits for confirmation (new, changed, to delete, edited in the vault, conflict, only in the vault). |
| `first-plan.png` | detail | README (Usage) | The sidebar on the first run: status "Waiting for confirmation", the reason, 13 new files and the one file that exists only in the vault, all groups open. |
| `plan.png` | detail | README (Usage) | A later plan with every group open, including the conflict with its checkbox, "Overwrite all" and "Overwrite none". |
| `result.png` | detail | README (Usage) | The sidebar after a run: status "Up to date" and the last-run card with its seven counts. |
| `settings.png` | detail | README (Configuration) | The settings tab from the help row to "Largest file". The source root shows a placeholder path in the picture only; the stored value is not touched. |

## Recipe

Record in a second instance (own profile, own port, English surface via `--lang=en-US` at start), never in the regular instance. The recording takes pictures, so the lock is `--exclusive focus`.

```bash
npm run build && npm run shots -- --setup
# start the instance as in the header of scripts/gui-smoke.ts with the vault "docs-mirror-shots", then:
npm run shots -- --port <port>
```

`--only <name>` records one image; `--out <folder>` writes to a folder instead of this one (no thumbnails). The driver resets the device state of the plugin and the vault before it starts and again at the end, so every run begins with the first run.

Every picture is looked at after a run: crop, legibility, nothing private, and the state it claims to show. The picture of the settings is the only one that needs a masked value; the driver restores the field before it closes the tab.
