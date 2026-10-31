# Adjust the folder patterns

This guide changes which folders under the source root Docs Mirror mirrors. The labels are the English interface texts; the German interface uses the names in parentheses.

## Change the patterns

1. Open Settings, go to Community plugins, and open **Docs Mirror**. Find **Folder patterns** (Ordnermuster).
2. Write one pattern per line. The default is `**/docs`.
3. Click elsewhere to leave the field. The value is saved when the field loses focus.
4. Click **Sync now** (Jetzt synchronisieren) in the sidebar and read the plan before you run it.

A changed pattern changes what the plugin mirrors, so the next run waits for your confirmation with the reason "Settings changed since the last run, or the state of this device is unknown." Folders that no longer match show up under **files to delete** (zu löschende Dateien); read that group before you confirm.

## What a pattern matches

A pattern matches folders, never single files. It is read relative to the source root, with `/` as the separator, and it is case-sensitive. When a folder matches, everything below it is mirrored, filtered by the file types, the excluded names and the largest file size. Below a matching folder nothing is matched again, so `a/docs/docs` is just part of `a/docs`.

| Pattern | Matches | Does not match |
|---|---|---|
| `**/docs` (default) | `docs`, `a/docs`, `a/b/docs` | `a/docsx` |
| `docs` | the same folders: without a slash, the name matches at any depth | `a/docsx` |
| `*/docs` | `a/docs` | `docs`, `a/b/docs` |
| `a/*/docs` | `a/x/docs` | `docs`, `b/x/docs` |

`*` stands for any characters inside one folder name, `**` for any number of folders, `?` for one character.

## Mirror more than one folder name

Write one pattern per line. To mirror `docs` and `doc` folders, use two lines:

```
**/docs
**/doc
```

Curly braces are not expanded. `**/{docs,doc}` is a literal pattern and matches only a folder that is really named `{docs,doc}`. A comma in the field is part of the pattern, not a separator.

## Leave one folder out

A line that starts with `!` takes a folder out again. The last line that matches a folder decides.

```
**/docs
!archive/docs
```

This mirrors every `docs` folder except `archive/docs`. To keep a name out everywhere, use **Excluded names** (Ausgeschlossene Namen) instead.

## Comments, empty lines and unreadable lines

A line that starts with `#` is a comment, and empty lines are ignored. A line the plugin cannot read, such as `**` alone, is ignored, and a warning below the field lists it: "1 line could not be read and is ignored: …" (Deutsch: "1 Zeile ließ sich nicht lesen und wird ignoriert: …"). The field cannot be empty: it asks for at least one entry and keeps the saved value.
