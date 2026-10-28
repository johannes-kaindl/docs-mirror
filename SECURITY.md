# Security Policy

## Supported Versions

Security updates are provided for the most recently released version of Docs Mirror. Older versions do not receive backported fixes; please update to the latest release.

| Version | Supported |
| ------- | --------- |
| 0.1.x   | :white_check_mark: |

## Reporting a Vulnerability

Please do **not** report security vulnerabilities through public issues. Report them privately by email to **code@jkaindl.de** (PGP-encrypted mail is welcome). You will receive a prompt acknowledgement and updates as the fix progresses.

## Data Handling / Scope

Docs Mirror is a desktop-only plugin that works with files on the local machine:

- **Reads the configured source folders** (the `docs` folders of your repos) from disk through Node `fs`. Reading is strictly read-only; the plugin never writes into a source folder.
- **Does not follow symlinks** in the source folders.
- **Writes mirrored files only into its own mirror vault**, through the Obsidian vault API, plus its own settings.
- **Deletes or overwrites only files it mirrored itself**, tracked in its manifest. Files it did not create are never touched.
- **Safeguards:** the first run and runs that delete many files ask for confirmation first. Nothing is deleted when a source folder is unreachable or empty. An aborted run leaves no half-written file behind.
- **No network access.** The plugin makes no outbound requests.
- **No telemetry, no analytics, no remote logging.**

If you have questions about the plugin's data handling beyond what is described here, the same private contact applies.
