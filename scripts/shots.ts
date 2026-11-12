/**
 * Bilder für README und Doku: nimmt `docs/images/*.png` gegen eine LAUFENDE Zweitinstanz auf (Rezept wie `gui-smoke.ts`; Bildaufnahmen
 * laufen unter `--exclusive focus`, die Instanz mit `--lang=en-US`). Quelle und Vault sind eigene Staging-Ordner, gebaut aus
 * `docs/images/fixture/` (nicht die Fixture des GUI-Smokes).
 *
 *   npm run build && npm run shots -- --setup          # Quelle (Zustand „start“) und Vault im Staging bauen
 *   (Zweitinstanz mit dem Vault starten, Rezept im Kopf von scripts/gui-smoke.ts, Vault-Name docs-mirror-shots)
 *   npm run shots -- --port <port> [--only <name>] [--out <ordner>]
 *
 * Der Lauf geht den Alltag durch: erster Plan (wartet auf Bestätigung), Ausführen, danach ändert sich die Quelle und im Vault steht
 * eine fremde Datei am Ziel einer neuen: zweiter Plan mit Konflikt. Dateinamen und Inhalt der Bilder: `docs/images/README.md`.
 */
import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { join, resolve } from "node:path";
import { cwd } from "node:process";

import { parseArgs, runDriver } from "../../tools/obsidian-cdp/bilanz.js";
import { Cdp, attachTo, bereiteInstanzVor, clearNotices, clickReal, pollUntil, requireVisible, schliesseEinstellungen } from "../../tools/obsidian-cdp/cdp.js";
import { boxOf, capture, setWindowSize, writeShot, type Rect } from "../../tools/obsidian-cdp/shot.js";
import { buildVault, requireEigenerBuild, stagingVaultDir } from "../../tools/obsidian-cdp/vault.js";

const REPO_ROOT = cwd();
const PLUGIN_ID = "docs-mirror";
const VAULT_NAME = "docs-mirror-shots";
const FIXTURE = join(REPO_ROOT, "docs/images/fixture");
const SOURCE = join(stagingVaultDir("docs-mirror-shots-source"), "repos");
const VAULT_DIR = stagingVaultDir(VAULT_NAME);

const argv = parseArgs(process.argv.slice(2));
const ONLY = argv.value("only");
const OUT = argv.value("out") ? resolve(argv.value("out") as string) : join(REPO_ROOT, "docs/images");
const OPT = { outDir: OUT, captureWidth: 1200, thumbWidth: 380, thumb: !argv.value("out") } as const;

const q = (s: unknown): string => JSON.stringify(s);
const P = `app.plugins.plugins[${q(PLUGIN_ID)}]`;
const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));
const baue = (zustand: "start" | "spaeter"): void => { execFileSync("node", [join(FIXTURE, "make-source.mjs"), SOURCE, zustand], { stdio: "inherit" }); };

function setup(): void {
  baue("start");
  const log = buildVault({ repoRoot: REPO_ROOT, vaultDir: VAULT_DIR, fixtureDir: join(FIXTURE, "vault"), pluginId: PLUGIN_ID });
  console.log(`Vault gebaut: ${VAULT_DIR}`);
  for (const l of log) console.log(`  · ${l}`);
  console.log(`\nZweitinstanz mit diesem Vault starten (Name ${VAULT_NAME}), dann: npm run shots -- --port <port>`);
}

/* ── Bausteine ─────────────────────────────────────────────────────────────────────────────────────────────────────── */

async function warteBis(cdp: Cdp, bedingung: string, ms = 10000, takt = 100): Promise<boolean> {
  return (await pollUntil<{ ok: boolean }>(cdp, `return (${bedingung}) ? { ok: true } : null;`, ms, takt)) !== null;
}
async function warteStatus(cdp: Cdp, text: string, ms = 30000): Promise<void> {
  const ok = await warteBis(cdp, `(document.querySelector(".dmr-status-text")?.textContent || "").trim().startsWith(${q(text)})`, ms);
  if (!ok) throw new Error(`Status „${text}“ nicht erreicht`);
}
async function klick(cdp: Cdp, ausdruck: string): Promise<void> {
  await clearNotices(cdp);
  if (!(await clickReal(cdp, ausdruck))) throw new Error(`Klick ins Leere: ${ausdruck}`);
}
const PRIMAER = `document.querySelector(".dmr-primary")`;

async function bestaetigeDialog(cdp: Cdp): Promise<void> {
  if (!(await warteBis(cdp, `document.querySelector(".modal-container .modal-button-container button")`, 5000))) throw new Error("Bestätigungsdialog fehlt");
  await klick(cdp, `Array.from(document.querySelectorAll(".modal-container .modal-button-container button")).find((b) => (b.textContent || "").trim() === "Run plan")`);
  await warteBis(cdp, `!document.querySelector(".modal-container")`, 5000);
}

async function aufnahme(cdp: Cdp, name: string, clip?: Rect | null): Promise<void> {
  if (ONLY && ONLY !== name.replace(/\.png$/, "")) return;
  await sleep(300);
  await clearNotices(cdp);
  console.log(`  ${await writeShot(cdp, name, await capture(cdp, clip ?? undefined, 2), OPT)}`);
}

/** Ausschnitt der Seitenleiste von der Aktionszeile bis zum Unterrand des letzten Inhalts. */
async function seitenleiste(cdp: Cdp, bis: string): Promise<Rect | null> {
  return cdp.evaluate<Rect | null>(`
    const top = document.querySelector(".dmr-view");
    const last = Array.from(document.querySelectorAll(${q(bis)})).filter((e) => e.getBoundingClientRect().height > 1).pop();
    if (!top || !last) return null;
    const a = top.getBoundingClientRect(), b = last.getBoundingClientRect();
    return { x: a.left, y: a.top, width: a.width, height: Math.min(a.bottom, b.bottom + 28) - a.top };`);
}

/** Klappt die Gruppen auf, die Dateien nennen (wie ein Nutzer, der in den Plan schaut); `nur` filtert nach dem Anfang der Zusammenfassung. */
async function oeffneGruppen(cdp: Cdp, nur?: RegExp): Promise<void> {
  await cdp.evaluate(`
    const re = ${nur ? nur.toString() : "null"};
    for (const d of document.querySelectorAll(".dmr-group")) { const s = (d.querySelector("summary")?.textContent || "").trim(); d.open = re ? re.test(s) : true; }
    return true;`);
  await sleep(300);
}

/** Breite der rechten Seitenleiste in CSS-Pixeln. */
async function breite(cdp: Cdp, px: number): Promise<void> {
  await cdp.evaluate(`const r = document.querySelector(".mod-right-split"); if (r) r.style.width = ${px} + "px"; await new Promise((x) => setTimeout(x, 400)); return true;`);
}

async function oeffneAnsicht(cdp: Cdp): Promise<void> {
  await cdp.evaluate(`app.commands.executeCommandById("docs-mirror:open"); return true;`);
  if (!(await warteBis(cdp, `document.querySelector(".dmr-view")`, 8000))) throw new Error("Ansicht nicht sichtbar");
}

interface TabKontext { s: Cdp; fenster: boolean }
async function oeffneTab(cdp: Cdp, port: number): Promise<TabKontext> {
  await cdp.evaluate(`app.setting.open(); await new Promise((r) => setTimeout(r, 500)); app.setting.openTabById(${q(PLUGIN_ID)}); await new Promise((r) => setTimeout(r, 1200)); return true;`);
  if (await cdp.evaluate<boolean>(`return Boolean(document.querySelector(".modal.mod-settings"));`)) return { s: cdp, fenster: false };
  const w = await attachTo("settings", port, VAULT_NAME);
  if (!w) throw new Error("Einstellungen offen, aber kein Fenster-Ziel gefunden (attachTo settings).");
  return { s: w, fenster: true };
}

async function setzeZurueck(cdp: Cdp): Promise<void> {
  await cdp.evaluate(`
    for (const k of ["root", "manifest", "fingerprint", "last"]) app.saveLocalStorage(${q(`${PLUGIN_ID}:`)} + k, null);
    app.workspace.detachLeavesOfType("docs-mirror-view");
    try { await app.plugins.disablePlugin(${q(PLUGIN_ID)}); await app.plugins.enablePlugin(${q(PLUGIN_ID)}); } catch {}
    for (const f of app.vault.getFiles()) if (!f.path.startsWith("Scratch/")) await app.vault.adapter.remove(f.path);
    for (const d of ["acme-api", "acme-web", "acme-mobile", "acme-infra", "acme-billing"]) { try { await app.vault.adapter.rmdir(d, true); } catch {} }
    return true;
  `);
}

async function main(): Promise<void> {
  if (argv.has("setup")) { setup(); return; }
  const port = Number(argv.value("port"));
  if (!Number.isInteger(port) || port < 1024 || port === 9222) throw new Error("--port <Zahl> fehlt (Port der eigenen Zweitinstanz, nie 9222).");
  const cdp = await attachTo("workspace", port, VAULT_NAME);
  if (!cdp) throw new Error(`Kein Obsidian-Fenster für Vault "${VAULT_NAME}" auf Port ${port}.`);
  try {
    await requireVisible(cdp);
    const klar = await bereiteInstanzVor(cdp, { pluginIds: [PLUGIN_ID], nurVault: VAULT_NAME, sprache: "en" });
    console.log(`  (${klar.hinweis})`);
    const basis = await cdp.evaluate<string>(`return app.vault.adapter.basePath + "/" + app.vault.configDir;`);
    requireEigenerBuild(join(basis, "plugins", PLUGIN_ID, "main.js"), join(REPO_ROOT, "main.js"), (m) => { throw new Error(m); });
    if (!existsSync(join(SOURCE, "acme-api/docs/index.md"))) throw new Error("Quelle fehlt: erst `npm run shots -- --setup`.");
    baue("start");
    await setzeZurueck(cdp);
    await setWindowSize(cdp, 1500, 900);
    // App-Einstellungen aus Dateien greifen im laufenden Obsidian nicht: zur Laufzeit setzen (helles Theme, kein doppelter Titel).
    await cdp.evaluate(`app.vault.setConfig("showInlineTitle", false); app.setTheme("moonstone"); app.workspace.trigger("css-change"); return true;`);
    await cdp.evaluate(`${P}.setRoot(${q(SOURCE)}); return true;`);
    await oeffneAnsicht(cdp);
    await sleep(500);

    console.log("Aufnahmen:");
    // 1. Erster Plan: wartet immer auf die Bestätigung.
    await klick(cdp, PRIMAER);
    await warteStatus(cdp, "Waiting for confirmation");
    await breite(cdp, 460);
    await oeffneGruppen(cdp);
    await aufnahme(cdp, "first-plan.png", await seitenleiste(cdp, ".dmr-group"));

    // 2. Ausführen: Ergebnis-Karte.
    await klick(cdp, PRIMAER);
    await bestaetigeDialog(cdp);
    await warteStatus(cdp, "Up to date", 60000);
    await aufnahme(cdp, "result.png", await seitenleiste(cdp, ".dmr-result"));

    // 3. Die Quelle ändert sich; im Vault steht eine fremde Datei am Ziel einer neuen und eine gespiegelte ist im Vault bearbeitet.
    baue("spaeter");
    await cdp.evaluate(`
      await app.vault.adapter.write("acme-mobile/docs/push-notifications.md", "# Push\\n\\nMy own notes on push, written in the vault.\\n");
      await app.vault.adapter.write("acme-web/docs/architecture.md", (await app.vault.adapter.read("acme-web/docs/architecture.md")) + "\\nTODO: add a diagram here.\\n");
      return true;
    `);
    await sleep(300);
    await klick(cdp, PRIMAER);
    await warteStatus(cdp, "Waiting for confirmation");
    // Hero: links der Dateibaum mit den gespiegelten Ordnern, in der Mitte eine gespiegelte Notiz, rechts der Plan.
    await cdp.evaluate(`
      app.workspace.leftSplit.expand();
      await app.workspace.openLinkText("acme-api/docs/index.md", "", false);
      return true;
    `);
    await setWindowSize(cdp, 1500, 900);
    await cdp.evaluate(`
      const fe = app.workspace.getLeavesOfType("file-explorer")[0]?.view;
      for (const d of ["acme-api", "acme-api/docs", "acme-web", "acme-web/docs"]) fe?.fileItems?.[d]?.setCollapsed(false);
      return true;`);
    await breite(cdp, 400);
    await oeffneGruppen(cdp, /^[▶▼\s]*1 (new|changed|file to delete)/);
    await aufnahme(cdp, "hero.png");

    // Der Plan im Einzelnen: alle Gruppen offen, nur die Seitenleiste.
    await oeffneGruppen(cdp);
    await breite(cdp, 460);
    await aufnahme(cdp, "plan.png", await seitenleiste(cdp, ".dmr-group"));

    // Einstellungen: der Quellpfad ist in der Darstellung ein Platzhalter (der Wert in den Einstellungen bleibt unberührt).
    if (!ONLY || ONLY === "settings") {
      const ctx = await oeffneTab(cdp, port);
      try {
        await sleep(600);
        const echt = await ctx.s.evaluate<string>(`const i = document.querySelector('[aria-label="Source root"]'); const v = i.value; i.value = "/home/you/code"; return v;`);
        await sleep(300);
        await aufnahme(ctx.s, "settings.png", await boxOf(ctx.s, ".vertical-tab-content", 0));
        await ctx.s.evaluate(`document.querySelector('[aria-label="Source root"]').value = ${q(echt)}; return true;`);
      } finally {
        if (ctx.fenster) ctx.s.close();
        await schliesseEinstellungen(cdp).catch(() => undefined);
      }
    }
  } finally {
    await setzeZurueck(cdp).catch(() => undefined);
    await schliesseEinstellungen(cdp).catch(() => undefined);
    cdp.close();
  }
}

runDriver(main);
