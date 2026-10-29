/**
 * GUI-Smoke — fährt die Prüfpunkte aus docs/SMOKE.md gegen ein LAUFENDES Obsidian (CORE-TEST-02 b), in einer Zweitinstanz
 * mit eigenem Profil und Port (die reguläre Instanz gehört anderen Sessions; `--port` ist Pflicht, kein Standardport).
 *
 * Gegenstand: die Seitenleiste (Aktionszeile, Statuszeile, Vorschau, Ergebnis), die Befehle, der Einstellungs-Tab und der Startlauf
 * von Docs Mirror, am echten DOM und am echten Dateisystem. Quelle und Vault liegen ausschließlich im Staging (`STAGING_VAULTS_DIR`).
 *
 * Quelle: `fixtures/source` (drei Mini-Repos) wird im Setup nach `<staging>/docs-mirror-source/main` kopiert und um das ergänzt,
 * was nicht getrackt wird: `node_modules` (Git ignoriert den Namen), ein Symlink, eine Datei über 5 MB, feste Änderungszeiten.
 * Daneben liegen `solo` (ein Repo), `empty` (leerer Ordner), `big` (4000 Dateien, für Startlauf, Abbruch und Wurzelwechsel im Lauf).
 * Vault: `fixtures/vault` (eine Fremddatei) nach `<staging>/docs-mirror`, gebaut mit `buildVault`.
 *
 * Wurzel und Einstellungen setzt der Treiber wie ein Nutzer: Feld im Einstellungs-Tab füllen und verlassen (blur), Schalter anklicken.
 * Nur wo der Zeitpunkt zählt (Wurzelwechsel MITTEN im Lauf) und für die Einstellungs-Änderung, die einen Plan erzwingt, ruft er die
 * Plugin-Schnittstelle (`setRoot`, `updateSettings`) direkt: dieselbe, die der Tab über seinen Host-Vertrag ruft.
 *
 * ## Zweitinstanz (eigenes Profil, eigener Port — NICHT die reguläre Instanz anfassen)
 *
 *   echo "$STAGING_VAULTS_DIR"                                          # muss gesetzt sein
 *   npm run build && npm run smoke:gui -- --setup
 *   UD=/tmp/obs-test-docs-mirror-smoke; mkdir -p "$UD"
 *   lsof -nP -iTCP:9392 -sTCP:LISTEN && echo "Port belegt — anderen nehmen"; pgrep -f "user-data-dir=$UD" && echo "Profil belegt"
 *   node -e 'const p=process.env.STAGING_VAULTS_DIR+"/docs-mirror";require("fs").writeFileSync(process.argv[1]+"/obsidian.json",JSON.stringify({vaults:{"docs-mirror":{path:p,ts:Date.now(),open:true}},language:"en"}))' "$UD"
 *   cp ~/Library/Application\ Support/obsidian/obsidian-*.asar "$UD"/    # aktuelle Version statt gebündelter
 *   /Applications/Obsidian.app/Contents/MacOS/Obsidian --user-data-dir="$UD" --remote-debugging-port=9392 --lang=en-US &
 *   python3 ~/.claude/hooks/obsidian-cdp-lock.py acquire --label docs-mirror --intent "GUI-Smoke" --exclusive focus --port 9392 --ttl 900 --warten 540 \
 *     && npm run smoke:gui -- --port 9392 --bilder <ordner>
 *   python3 ~/.claude/hooks/obsidian-cdp-lock.py release --port 9392
 *
 * Prozess der Zweitinstanz je Messlauf neu starten (recycelte Fenster altern, Dach-Regel Welle 11). Ein Lauf stellt den gerätelokalen
 * Zustand des Plugins selbst zurück (localStorage-Schlüssel, Plugin neu laden); `--setup` baut Vault und Quellen neu.
 *
 * Flags: `--port` (Pflicht), `--setup`, `--bilder <ordner>` (Screenshots; ohne Ordner keine), `--ohne-gross` (die Punkte mit der großen
 * Quelle werden `skipped`, für kurze Mutationsläufe), `--mutiert` (der Vault trägt absichtlich ein anderes main.js: Herkunftsprüfung aus,
 * nur für die Gegenprobe), `--mutiertes-main <datei>` zusammen mit `--setup` (legt es in den Plugin-Ordner des Vaults).
 *
 * Bilanz: `createBilanz` mit Soll-Liste `PUNKTE` als Nenner. Exit 1 bei Rot ODER „nichts gemessen“, Exit 2 bei Abbruch.
 *
 * Typen: `tsconfig.scripts.json` (im `gate` über `npm run typecheck:scripts`).
 */
import { cpSync, existsSync, mkdirSync, readFileSync, readdirSync, renameSync, rmSync, statSync, symlinkSync, utimesSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { cwd } from "node:process";

import { createBilanz, parseArgs, runDriver } from "../../tools/obsidian-cdp/bilanz.js";
import { Cdp, attachTo, beimAbbruch, bereiteInstanzVor, clearNotices, clickReal, istAbgebrochen, notices, pollUntil, requireVisible, schliesseEinstellungen } from "../../tools/obsidian-cdp/cdp.js";
import { buildVault, requireEigenerBuild, stagingVaultDir } from "../../tools/obsidian-cdp/vault.js";
import { gegenprobeErreichbarkeit, messeErreichbarkeit, zeichnePflicht } from "../../tools/obsidian-cdp/pflichtpunkte.js";
import { capture, setWindowSize } from "../../tools/obsidian-cdp/shot.js";

const REPO_NAME = "docs-mirror";
const PLUGIN_ID = "docs-mirror";
const REPO_ROOT = cwd();
const FIXTURE_VAULT = join(REPO_ROOT, "fixtures/vault");
const FIXTURE_SOURCE = join(REPO_ROOT, "fixtures/source");

const SRC_BASE = stagingVaultDir("docs-mirror-source");
const MAIN = join(SRC_BASE, "main");
const SOLO = join(SRC_BASE, "solo");
const EMPTY = join(SRC_BASE, "empty");
const BIG = join(SRC_BASE, "big");
const MISSING = join(SRC_BASE, "missing");
const BIG_COUNT = 4000;

/** Was aus `main` gespiegelt wird (Pfad im Vault = Pfad unter der Wurzel). */
const MIRROR = [
  "repo-alpha/docs/assets/pixel.png",
  "repo-alpha/docs/guide/intro.md",
  "repo-alpha/docs/index.md",
  "repo-beta/docs/a.md",
  "repo-beta/docs/notes/b.md",
  "repo-gamma/docs/c.md",
] as const;
/** Was in `main` liegt und NICHT im Vault landen darf. */
const NOT_MIRRORED = [
  "repo-alpha/docs/node_modules/pkg/leak.md",
  "repo-alpha/docs/link.md",
  "repo-alpha/docs/big.pdf",
  "repo-alpha/docs/data.json",
  "repo-beta/node_modules/dep/docs/x.md",
  "repo-beta/README.md",
  "repo-alpha/src/main.ts",
] as const;
const FOREIGN = "Fremd/fremd.md";

/** Soll-Liste aller Prüfpunkte — der Nenner der Bilanz (CORE-TEST-19). */
const PUNKTE = [
  "0 Plugin geladen (Restricted-Mode-Guard), Zustand zurückgesetzt",
  "O1 Befehl „Open“ bei eingeklappter rechter Seitenleiste: Ansicht sichtbar, nicht 0×0, genau ein Blatt",
  "A Empty-State ohne Wurzel: Überschrift, Beschreibung, nur „Open settings“",
  "O9a Knopf „Open settings“ öffnet den Tab des Plugins (openTabById)",
  "O9b Einstellungs-Tab: gewählter Render-Pfad, display()-Fallback zeichnet dieselben Zeilen, Hilfe-Zeile zuerst",
  "O9c blur speichert genau einmal, ohne Änderung gar nicht",
  "O9d Hinweis unter dem Feld überlebt setDesc und wechselt auf den Fehler",
  "O9e Schalter im Tab speichert in data.json, Gegenprobe: zweiter Klick stellt zurück",
  "B Erster Lauf wartet auf Bestätigung, Vorschau nennt die neu-Zahl, nichts geschrieben",
  "B2 Abbrechen im Bestätigungsdialog schreibt nichts, der Plan bleibt wartend",
  "C Plan ausführen: Dateien unter ihrem Repo-Pfad, node_modules, Symlink, große Datei und Fremdtypen fehlen",
  "D Zeitstempel und Größe der Kopie gleich der Quelle",
  "E Quelldatei geändert: Vorschau „geändert“, danach Kopie gleich Quelle",
  "F Quelldatei gelöscht: Vorschau „zu löschen“, nach dem Lauf weg (samt leerem Ordner)",
  "G Fremddatei im Vault bleibt und steht unter „nur im Vault“",
  "H Im Vault verändert: Vorschau „im Vault verändert“, Überschreiben stellt die Quelle wieder her",
  "O4a Konflikte: „Alle überschreiben“ setzt checked und disabled, „Keine“ löst beides",
  "O4b Konflikt-Auswahl: nur die angekreuzte Datei wird überschrieben, die andere bleibt",
  "O4c Fokus auf einem Körper-Kästchen überlebt den Neuaufbau des Körpers",
  "O10 Doppelter Auslöser (Befehl ×2, Knopf+Befehl): ein Lauf, ein „läuft bereits“",
  "O10c Startlauf-Timer und Befehle zusammen: nie zwei Läufe gleichzeitig",
  "I Wurzel auf nicht vorhandenen Pfad: „Quelle nicht erreichbar“, alle Vault-Dateien und das Manifest bleiben",
  "J Wurzel auf leeren Ordner: blockiert, nichts gelöscht, Manifest bleibt",
  "I2 Quelle verschwindet bei unverändertem Fingerabdruck (kein Wurzelwechsel, keine Bestätigungspflicht): blockiert, Vault und Manifest bleiben",
  "J2 Alle Treffer verschwinden bei bestehender Wurzel und unverändertem Fingerabdruck: blockiert, Vault und Manifest bleiben",
  "O11 Wurzel „/“: Warnung sichtbar (kein Lauf)",
  "O12 Platform.isDesktopApp false: Notice statt fs-Zugriff",
  "K Statuszeile in jedem Zustand: Text, Icon (svg) und aria-label, Klasse zum Zustand",
  "L Verdeckungsprobe der Aktionszeile (breit und schmal), Körper scrollt darunter",
  "L2 Gegenprobe zu L: überdeckt der Körper die Aktionszeile, wird die Probe rot",
  "O2 <details>: Auf-/Zuklappen überlebt den Neuaufbau, Scrollposition bleibt",
  "N0 Startlauf mit Schalter aus: kein Lauf",
  "N Startlauf mit Schalter an: kein Modal, Notice bei Bestätigungspflicht",
  "O6 Startlauf: Vault-Start wird nicht langsamer (Ladezeit, Verzögerung, größter Ruckler)",
  "M Entladen mitten im Lauf: kein Temp-Rest, keine halbe Datei, Lauf endet",
  "O5 Entladen mitten im Lauf: Teil-Manifest passt zu den geschriebenen Dateien",
  "K2 is-checking: das Icon dreht sich während des Laufs (animationName, Animation läuft)",
  "O3a is-checking startet beim Neuaufbau nicht neu (gleiches Element, Uhr läuft weiter)",
  "O3b prefers-reduced-motion: Animation aus",
  "O7 Wurzelwechsel MITTEN im Lauf: der Lauf liest den alten Baum weiter",
  "P Quelldatei WÄHREND des Laufs gelöscht, eine geändert: Fehler gezählt, kein Manifest-Eintrag, der Lauf geht weiter",
  "O8 Wurzelwechsel in der Wartephase: nächster Lauf wartet mit Fingerabdruck-Grund, nichts gelöscht",
] as const;

const bilanz = createBilanz({ punkte: PUNKTE });
const { record, skipped } = bilanz;
type Name = (typeof PUNKTE)[number];
const nm = (kurz: string): Name => {
  const n = PUNKTE.find((p) => p === kurz || p.startsWith(`${kurz} `));
  if (!n) throw new Error(`Unbekannter Prüfpunkt: ${kurz}`);
  return n;
};
const rec = (kurz: string, ok: boolean, detail: string): void => record(nm(kurz), ok, detail);
const skip = (kurz: string, grund: string): void => skipped(nm(kurz), grund);
const unm = (kurz: string, grund: string): void => bilanz.unmeasured(nm(kurz), grund);

const q = (s: unknown): string => JSON.stringify(s);
const P = `app.plugins.plugins[${q(PLUGIN_ID)}]`;
const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

/* ── Setup: Quellen und Vault ──────────────────────────────────────────────────────────────────────────────────────── */

/** Feste Änderungszeit mit Millisekunden, je Datei verschieden: der Vergleich in D sieht dann auch ein Abrunden. */
function setzeZeit(datei: string, i: number): void {
  const t = new Date(1709287200123 + i * 61000 + i);
  utimesSync(datei, t, t);
}

function baueGross(dir: string, n: number): string[] {
  const pfade: string[] = [];
  for (let i = 0; i < n; i++) {
    const rel = `bigrepo/docs/d${i % 30}/f${String(i).padStart(4, "0")}.md`;
    const full = join(dir, rel);
    mkdirSync(join(full, ".."), { recursive: true });
    writeFileSync(full, `# Datei ${i}\n\n${"Eine Zeile Fülltext für die große Quelle. ".repeat(8)}\n`);
    pfade.push(rel);
  }
  return pfade;
}

function baueQuellen(): void {
  for (const f of MIRROR) if (!existsSync(join(FIXTURE_SOURCE, f))) throw new Error(`Fixture-Datei fehlt: ${f}`);
  rmSync(SRC_BASE, { recursive: true, force: true });
  mkdirSync(SRC_BASE, { recursive: true });
  cpSync(FIXTURE_SOURCE, MAIN, { recursive: true });
  // Was Git nicht trägt: node_modules (Name ist ignoriert), Symlink, große Datei.
  mkdirSync(join(MAIN, "repo-alpha/docs/node_modules/pkg"), { recursive: true });
  writeFileSync(join(MAIN, "repo-alpha/docs/node_modules/pkg/leak.md"), "# Leck\n\nDarf nie im Vault landen (node_modules).\n");
  mkdirSync(join(MAIN, "repo-beta/node_modules/dep/docs"), { recursive: true });
  writeFileSync(join(MAIN, "repo-beta/node_modules/dep/docs/x.md"), "# Fremdes docs\n\nUnter node_modules, darf nie im Vault landen.\n");
  symlinkSync(join(MAIN, "repo-beta/docs/a.md"), join(MAIN, "repo-alpha/docs/link.md"));
  writeFileSync(join(MAIN, "repo-alpha/docs/big.pdf"), Buffer.alloc(6 * 1024 * 1024, 1));
  MIRROR.forEach((f, i) => { setzeZeit(join(MAIN, f), i); });
  mkdirSync(join(SOLO, "solo/docs"), { recursive: true });
  writeFileSync(join(SOLO, "solo/docs/only.md"), "# Solo\n\nDas einzige Repo der zweiten Quelle.\n");
  mkdirSync(EMPTY, { recursive: true });
  baueGross(BIG, BIG_COUNT);
}

function setup(args: ReturnType<typeof parseArgs>): void {
  baueQuellen();
  console.log(`Quellen gebaut: ${SRC_BASE} (main, solo, empty, big mit ${BIG_COUNT} Dateien)`);
  const vaultDir = stagingVaultDir(REPO_NAME);
  const log = buildVault({ repoRoot: REPO_ROOT, vaultDir, fixtureDir: FIXTURE_VAULT, pluginId: PLUGIN_ID });
  console.log(`Staging-Vault gebaut: ${vaultDir}`);
  for (const l of log) console.log(`  · ${l}`);
  const mutiert = args.value("mutiertes-main");
  if (mutiert) {
    cpSync(mutiert, join(vaultDir, ".obsidian/plugins", PLUGIN_ID, "main.js"));
    console.log(`  · MUTIERTES main.js eingelegt: ${mutiert} (nur für die Gegenprobe)`);
  }
  console.log("\nZweitinstanz starten (Rezept im Dateikopf), dann:\n  npm run smoke:gui -- --port <Port>");
}

/* ── Renderer-Bausteine ────────────────────────────────────────────────────────────────────────────────────────────── */

interface Gruppe { summary: string; open: boolean; separate: boolean; rows: string[]; hint: string | null }
interface Ansicht {
  present: boolean;
  statusCls: string | null; statusText: string | null; aria: string | null; svg: boolean; svgCls: string | null;
  primary: { text: string; cls: string } | null;
  secondary: { text: string; hidden: boolean } | null;
  groups: Gruppe[]; reasons: string[]; notes: string[];
  emptyHeading: string | null; emptyDesc: string | null; error: string | null; resultHeading: string | null;
  counters: Record<string, number>;
  boxes: { path: string; checked: boolean; disabled: boolean }[];
}

const ANSICHT = `
  const qs = (s) => document.querySelector(s);
  const tx = (el) => (el ? (el.textContent || "").trim() : null);
  const st = qs(".dmr-status");
  const pr = qs(".dmr-primary"); const se = qs(".dmr-secondary");
  const counters = {};
  for (const c of document.querySelectorAll(".dmr-counter")) counters[tx(c.querySelector(".dmr-counter-label"))] = Number(tx(c.querySelector(".dmr-counter-value")));
  return {
    present: Boolean(qs(".dmr-view")),
    statusCls: st ? st.className : null, statusText: tx(qs(".dmr-status-text")), aria: st ? st.getAttribute("aria-label") : null,
    svg: Boolean(qs(".dmr-status-icon svg")), svgCls: qs(".dmr-status-icon svg") ? qs(".dmr-status-icon svg").getAttribute("class") : null,
    primary: pr ? { text: tx(pr), cls: pr.className } : null,
    secondary: se ? { text: tx(se), hidden: se.classList.contains("dmr-hidden") } : null,
    groups: Array.from(document.querySelectorAll(".dmr-group")).map((d) => ({
      summary: tx(d.querySelector("summary")), open: d.open, separate: d.classList.contains("is-separate"),
      rows: Array.from(d.querySelectorAll(".dmr-path")).map((x) => tx(x)), hint: tx(d.querySelector(".dmr-hint")),
    })),
    reasons: Array.from(document.querySelectorAll(".dmr-reason")).map((x) => tx(x)),
    notes: Array.from(document.querySelectorAll(".dmr-note")).map((x) => tx(x)),
    emptyHeading: tx(qs(".dmr-empty-heading")), emptyDesc: tx(qs(".dmr-empty-desc")), error: tx(qs(".dmr-error")),
    resultHeading: tx(qs(".dmr-result .dmr-card-heading")), counters,
    boxes: Array.from(document.querySelectorAll(".dmr-overwrite")).map((b) => ({ path: (b.getAttribute("aria-label") || "").replace(/^[^:]*: /, ""), checked: b.checked, disabled: b.disabled })),
  };
`;

async function lese(cdp: Cdp): Promise<Ansicht> {
  return cdp.evaluate<Ansicht>(ANSICHT);
}

async function warteStatus(cdp: Cdp, text: string, ms = 20000): Promise<boolean> {
  const r = await pollUntil<{ ok: boolean }>(cdp, `const e = document.querySelector(".dmr-status-text"); return e && (e.textContent || "").trim().startsWith(${q(text)}) ? { ok: true } : null;`, ms, 100);
  return r !== null;
}

async function warteBis(cdp: Cdp, bedingung: string, ms = 10000, takt = 100): Promise<boolean> {
  return (await pollUntil<{ ok: boolean }>(cdp, `return (${bedingung}) ? { ok: true } : null;`, ms, takt)) !== null;
}

/** Echter Mausklick. Eine Notice liegt oben rechts über der Seitenleiste und finge den Klick ab: vorher wegräumen. */
async function klick(cdp: Cdp, ausdruck: string): Promise<boolean> {
  await clearNotices(cdp);
  return clickReal(cdp, ausdruck);
}
const PRIMAER = `document.querySelector(".dmr-primary")`;
const SEKUNDAER = `document.querySelector(".dmr-secondary")`;

interface Dialog { title: string | null; paras: string[]; buttons: { text: string; cls: string }[] }
async function leseDialog(cdp: Cdp, ms = 5000): Promise<Dialog | null> {
  return pollUntil<Dialog>(cdp, `
    const m = document.querySelector(".modal-container .modal"); if (!m) return null;
    const t = m.querySelector(".modal-title");
    return { title: t ? (t.textContent || "").trim() : null,
      paras: Array.from(m.querySelectorAll("p")).map((p) => (p.textContent || "").trim()),
      buttons: Array.from(m.querySelectorAll(".modal-button-container button")).map((b) => ({ text: (b.textContent || "").trim(), cls: b.className })) };
  `, ms, 100);
}
async function klickeDialogKnopf(cdp: Cdp, text: string): Promise<boolean> {
  const ok = await klick(cdp, `Array.from(document.querySelectorAll(".modal-container .modal-button-container button")).find((b) => (b.textContent || "").trim() === ${q(text)})`);
  await warteBis(cdp, `!document.querySelector(".modal-container")`, 5000);
  return ok;
}

async function vaultDateien(cdp: Cdp): Promise<string[]> {
  return cdp.evaluate<string[]>(`
    const out = [];
    const walk = async (dir) => { const l = await app.vault.adapter.list(dir); out.push(...l.files); for (const f of l.folders) { if (f === app.vault.configDir) continue; await walk(f); } };
    await walk("");
    return out.filter((f) => !f.startsWith(app.vault.configDir + "/")).sort();
  `);
}
async function vaultLies(cdp: Cdp, pfad: string): Promise<string | null> {
  return (await cdp.evaluate<{ t: string | null }>(`return { t: (await app.vault.adapter.exists(${q(pfad)})) ? await app.vault.adapter.read(${q(pfad)}) : null };`)).t;
}
async function vaultExistiert(cdp: Cdp, pfad: string): Promise<boolean> {
  return cdp.evaluate<boolean>(`return await app.vault.adapter.exists(${q(pfad)});`);
}
async function vaultStat(cdp: Cdp, pfad: string): Promise<{ size: number; mtime: number } | null> {
  return (await cdp.evaluate<{ s: { size: number; mtime: number } | null }>(`const s = await app.vault.adapter.stat(${q(pfad)}); return { s: s ? { size: s.size, mtime: s.mtime } : null };`)).s;
}
async function geraetWert(cdp: Cdp, name: string): Promise<string | null> {
  return (await cdp.evaluate<{ v: string | null }>(`const v = app.loadLocalStorage(${q(`${PLUGIN_ID}:${name}`)}); return { v: typeof v === "string" ? v : null };`)).v;
}
async function manifestSchluessel(cdp: Cdp): Promise<string[]> {
  const raw = await geraetWert(cdp, "manifest");
  if (raw === null) return [];
  try { return Object.keys(JSON.parse(raw) as Record<string, unknown>).sort(); } catch { return []; }
}

/** Ein Punkt, der nur MITTEN im Lauf gilt: war der Lauf schon zu Ende, ist der Gegenstand nicht erreicht (nichts gemessen), nicht rot. */
const recL = (noch: boolean, kurz: string, ok: boolean, detail: string): void => {
  if (noch) rec(kurz, ok, detail);
  else unm(kurz, `Gegenstand nicht erreicht: der Lauf war bei der Probe schon zu Ende (${detail.slice(0, 160)})`);
};
/** Verschobene Quellordner (I2/J2): im Aufräumen zurück an ihren Platz, auch nach einem Abbruch. */
const verschoben: [string, string][] = [];
function verschiebe(von: string, nach: string): void {
  mkdirSync(join(nach, ".."), { recursive: true });
  renameSync(von, nach);
  verschoben.push([von, nach]);
}
function stelleQuellenWiederHer(): void {
  for (const [von, nach] of verschoben.splice(0).reverse()) if (existsSync(nach) && !existsSync(von)) renameSync(nach, von);
}
const text = (pfad: string): string => readFileSync(pfad, "utf8");

/* ── Einstellungs-Tab ─────────────────────────────────────────────────────────────────────────────────────────────── */

interface TabKontext { s: Cdp; fenster: boolean }

async function oeffneTab(cdp: Cdp, port: number): Promise<TabKontext> {
  await cdp.evaluate(`app.setting.open(); await new Promise((r) => setTimeout(r, 500)); app.setting.openTabById(${q(PLUGIN_ID)}); await new Promise((r) => setTimeout(r, 1200)); return true;`);
  return verbindeTab(cdp, port);
}
async function verbindeTab(cdp: Cdp, port: number): Promise<TabKontext> {
  const asModal = await cdp.evaluate<boolean>(`return Boolean(document.querySelector(".modal.mod-settings"));`);
  if (asModal) return { s: cdp, fenster: false };
  const w = await attachTo("settings", port, REPO_NAME);
  if (!w) throw new Error("Einstellungen offen, aber kein Fenster-Ziel gefunden (attachTo settings).");
  return { s: w, fenster: true };
}
async function schliesseTab(cdp: Cdp, ctx: TabKontext): Promise<void> {
  if (ctx.fenster) ctx.s.close();
  await schliesseEinstellungen(cdp).catch(() => undefined);
  await warteBis(cdp, `!document.querySelector(".modal.mod-settings")`, 4000, 200);
}

/** Feld im Tab füllen und verlassen, wie ein Nutzer: Fokus, Wert, blur. `blurMitFokus` sagt, ob das Element den Fokus wirklich hatte. */
async function fuelleFeld(ctx: TabKontext, label: string, wert: string): Promise<{ gefunden: boolean; blurMitFokus: boolean }> {
  return ctx.s.evaluate<{ gefunden: boolean; blurMitFokus: boolean }>(`
    const inp = document.querySelector('[aria-label=' + ${q(q(label))} + ']');
    if (!inp) return { gefunden: false, blurMitFokus: false };
    inp.focus();
    // Ein Fenster ohne Systemfokus feuert bei focus()/blur() keine Ereignisse; dann sendet der Treiber das blur selbst (einmal).
    const hatte = inp.ownerDocument.activeElement === inp && inp.ownerDocument.hasFocus();
    inp.value = ${q(wert)};
    inp.dispatchEvent(new Event("input", { bubbles: true }));
    if (hatte) inp.blur(); else inp.dispatchEvent(new FocusEvent("blur"));
    return { gefunden: true, blurMitFokus: hatte };
  `);
}

async function setzeWurzel(cdp: Cdp, port: number, pfad: string, erwartet = true): Promise<{ root: string; notiz: string | null; ok: boolean }> {
  const ctx = await oeffneTab(cdp, port);
  try {
    const f = await fuelleFeld(ctx, "Source root", pfad);
    if (!f.gefunden) throw new Error("Feld „Source root“ nicht im Tab gefunden");
    const gesetzt = erwartet ? await warteBis(cdp, `${P}.root === ${q(pfad)}`, 4000, 100) : (await sleep(600), true);
    const notiz = await ctx.s.evaluate<string | null>(`const n = Array.from(document.querySelectorAll(".dmr-field-note"))[0]; return n ? (n.textContent || "") : null;`);
    const root = await cdp.evaluate<string>(`return ${P}.root;`);
    return { root, notiz, ok: gesetzt };
  } finally {
    await schliesseTab(cdp, ctx);
  }
}

/* ── Bildaufnahme ─────────────────────────────────────────────────────────────────────────────────────────────────── */

let bilderDir: string | null = null;
async function bild(cdp: Cdp, name: string): Promise<void> {
  if (!bilderDir) return;
  try {
    await sleep(250);
    const png = await capture(cdp);
    mkdirSync(bilderDir, { recursive: true });
    writeFileSync(join(bilderDir, `${name}.png`), png);
  } catch (e) {
    console.log(`  ! Bild ${name} nicht aufgenommen: ${(e as Error).message}`);
  }
}

/* ── Hauptablauf ──────────────────────────────────────────────────────────────────────────────────────────────────── */

/** Einstellung ändern (Fingerabdruck wechselt) und neu planen: der Plan wartet auf Bestätigung. */
async function plane(cdp: Cdp): Promise<boolean> {
  await cdp.evaluate(`await ${P}.updateSettings({ includeDotFolders: !${P}.settings.includeDotFolders }); return true;`);
  await sleep(150);
  if (!(await klick(cdp, PRIMAER))) return false;
  return warteStatus(cdp, "Waiting for confirmation", 15000);
}
/** „Run plan“ → Bestätigung → warten, bis der Lauf durch ist (Status „Up to date“). */
async function fuehreAus(cdp: Cdp): Promise<{ dialog: Dialog | null; fertig: boolean }> {
  if (!(await klick(cdp, PRIMAER))) return { dialog: null, fertig: false };
  const dialog = await leseDialog(cdp);
  if (!dialog) return { dialog: null, fertig: false };
  await klickeDialogKnopf(cdp, "Run plan");
  return { dialog, fertig: await warteStatus(cdp, "Up to date", 60000) };
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  if (args.has("setup")) { setup(args); return; }
  const portArg = args.value("port");
  if (!portArg || !Number.isInteger(Number(portArg))) throw new Error("--port <Port> ist Pflicht (Zweitinstanz, z. B. --port 9392) — kein Standardport.");
  const port = Number(portArg);
  if (port === 9222) throw new Error("Port 9222 ist die reguläre Instanz — nie anfassen. Zweitinstanz verwenden.");
  const ohneGross = args.has("ohne-gross");
  const mutiert = args.has("mutiert");
  bilderDir = args.value("bilder") ?? null;

  console.log(`GUI-Smoke docs-mirror — Obsidian auf Port ${port}${mutiert ? "  [MUTIERTER BUILD — Gegenprobe]" : ""}${ohneGross ? "  [ohne große Quelle]" : ""}`);
  const cdp0 = await attachTo("workspace", port, REPO_NAME);
  if (!cdp0) throw new Error(`Kein Obsidian-Hauptfenster auf Port ${port} für Vault „${REPO_NAME}“. Läuft die Zweitinstanz mit --remote-debugging-port? (siehe Kopfkommentar)`);

  const cdp: Cdp = cdp0;
  const warnungen: string[] = [];
  const zustandZurueck = async (): Promise<void> => {
    try {
      stelleQuellenWiederHer();
      await cdp.send("Emulation.setEmulatedMedia", { features: [] });
      await cdp.evaluate(`
        if (window.__smoke && window.__smoke.undo) window.__smoke.undo();
        for (const d of document.querySelectorAll(".smoke-fueller")) d.remove();
        const b = document.querySelector(".dmr-body"); if (b) b.style.cssText = "";
        return true;
      `);
      await schliesseEinstellungen(cdp);
    } catch { console.log("  ! Aufräumen im Renderer fehlgeschlagen — Emulation/Fenster von Hand prüfen"); }
  };
  const zustand = beimAbbruch(zustandZurueck, "Medien-Emulation, Spione, Füller und Einstellungsfenster zurücksetzen");
  try {
    await requireVisible(cdp);
    const klar = await bereiteInstanzVor(cdp, { pluginIds: [PLUGIN_ID], nurVault: REPO_NAME, sprache: "en" });
    console.log(`  (${klar.hinweis})`);
    await setWindowSize(cdp, 1280, 900);

    const vaultInfo = await cdp.evaluate<{ name: string; basePath: string; configDir: string }>(`
      return window.app ? { name: app.vault.getName(), basePath: app.vault.adapter.basePath, configDir: app.vault.configDir } : { name: "", basePath: "", configDir: "" };
    `);
    if (!vaultInfo.name) throw new Error("Obsidians `app` ist im Renderer nicht erreichbar.");
    console.log(`Vault: ${vaultInfo.name}\n`);
    if (mutiert) warnungen.push("MUTIERTER BUILD: Herkunftsprüfung aus, der Lauf ist eine Gegenprobe und kein Beleg für den Repo-Stand");
    else requireEigenerBuild(join(vaultInfo.basePath, vaultInfo.configDir, "plugins", PLUGIN_ID, "main.js"), join(REPO_ROOT, "main.js"), (m) => warnungen.push(m));
    for (const f of MIRROR) if (!existsSync(join(MAIN, f))) throw new Error(`Quelle nicht aufgebaut (${f} fehlt): erst \`npm run smoke:gui -- --setup\`.`);

    const statusProben: { zustand: string; ansicht: Ansicht }[] = [];
    const probe = async (zustandName: string): Promise<void> => { statusProben.push({ zustand: zustandName, ansicht: await lese(cdp) }); };

    /* ── 0 ─────────────────────────────────────────────────────────────────────────────────────────────────────── */
    console.log("0 · Grundlage");
    await cdp.evaluate(`
      for (const k of ["root", "manifest", "fingerprint", "last"]) app.saveLocalStorage(${q(`${PLUGIN_ID}:`)} + k, null);
      app.workspace.detachLeavesOfType("docs-mirror-view");
      try { await app.plugins.disablePlugin(${q(PLUGIN_ID)}); await app.plugins.enablePlugin(${q(PLUGIN_ID)}); } catch {}
      return true;
    `);
    const g0 = await cdp.evaluate<{ geladen: boolean; root: string; sync: boolean | null; last: unknown; version: string | null }>(`
      const p = ${P};
      return { geladen: Boolean(p), root: p ? p.root : "?", sync: p ? p.settings.syncOnStart : null, last: p ? p.last : "?", version: p ? p.manifest.version : null };
    `);
    rec("0", g0.geladen && g0.root === "" && g0.sync === false && g0.last === null, `geladen=${g0.geladen} · Version ${g0.version} · root=${q(g0.root)} · syncOnStart=${g0.sync} · last=${q(g0.last)} · ${klar.hinweis}`);
    if (!g0.geladen) throw new Error("Ohne geladenes Plugin ist jeder weitere Punkt gegenstandslos.");
    // Spione (Zähler für Speicherzugriffe, Läufe und Notices), vor der ersten Bedienung.
    await cdp.evaluate(`
      const w = window; w.__smoke = { saves: { root: 0, data: 0 }, runs: 0 };
      const app0 = app; const origLs = app0.saveLocalStorage.bind(app0);
      app0.saveLocalStorage = (k, v) => { if (k === ${q(`${PLUGIN_ID}:root`)}) w.__smoke.saves.root += 1; return origLs(k, v); };
      const p = ${P}; const origSave = p.saveData.bind(p);
      p.saveData = (d) => { w.__smoke.saves.data += 1; return origSave(d); };
      const r = p.runner; const origRun = r.run.bind(r);
      r.run = (...a) => { w.__smoke.runs += 1; return origRun(...a); };
      w.__smoke.undo = () => { app0.saveLocalStorage = origLs; p.saveData = origSave; r.run = origRun; };
      return true;
    `);

    /* ── O1 + A ────────────────────────────────────────────────────────────────────────────────────────────────── */
    console.log("\nO1 · Befehl bei eingeklappter Seitenleiste");
    await cdp.evaluate(`app.workspace.rightSplit.collapse(); return true;`);
    await sleep(500);
    const vorher = await cdp.evaluate<{ collapsed: boolean; leaves: number }>(`return { collapsed: app.workspace.rightSplit.collapsed, leaves: app.workspace.getLeavesOfType("docs-mirror-view").length };`);
    await cdp.evaluate(`app.commands.executeCommandById("docs-mirror:open"); return true;`);
    const sichtbar = await warteBis(cdp, `(() => { const v = document.querySelector(".dmr-view"); if (!v) return false; const r = v.getBoundingClientRect(); return r.width > 50 && r.height > 50; })()`, 6000, 100);
    const o1 = await cdp.evaluate<{ collapsed: boolean; w: number; h: number; leaves: number }>(`
      const v = document.querySelector(".dmr-view"); const r = v ? v.getBoundingClientRect() : { width: 0, height: 0 };
      return { collapsed: app.workspace.rightSplit.collapsed, w: Math.round(r.width), h: Math.round(r.height), leaves: app.workspace.getLeavesOfType("docs-mirror-view").length };
    `);
    await cdp.evaluate(`app.commands.executeCommandById("docs-mirror:open"); return true;`);
    await sleep(500);
    const nach2 = await cdp.evaluate<number>(`return app.workspace.getLeavesOfType("docs-mirror-view").length;`);
    rec("O1", vorher.collapsed && vorher.leaves === 0 && sichtbar && !o1.collapsed && o1.w > 100 && o1.h > 100 && o1.leaves === 1 && nach2 === 1,
      `vorher: eingeklappt=${vorher.collapsed}, Blätter=${vorher.leaves} · nachher: eingeklappt=${o1.collapsed}, Ansicht ${o1.w}×${o1.h}px, Blätter=${o1.leaves} · zweiter Aufruf: Blätter=${nach2}`);

    console.log("\nA · Empty-State");
    await warteStatus(cdp, "Not set up", 5000);
    const a = await lese(cdp);
    await probe("not-configured");
    rec("A", a.emptyHeading === "Not set up" && (a.emptyDesc ?? "").startsWith("Set the source root") && a.primary?.text === "Open settings" && a.secondary?.hidden === true && a.groups.length === 0 && a.resultHeading === null,
      `Überschrift=${q(a.emptyHeading)} · Beschreibung=${q(a.emptyDesc)} · Primärknopf=${q(a.primary?.text)} · Sekundär versteckt=${a.secondary?.hidden} · Gruppen=${a.groups.length}`);
    await bild(cdp, "01-empty-state");

    /* ── O9: Einstellungs-Tab ──────────────────────────────────────────────────────────────────────────────────── */
    console.log("\nO9 · Einstellungs-Tab");
    // display-Zähler vor dem Öffnen: sagt, ob Obsidian den deklarativen Pfad nahm oder display() rief.
    await cdp.evaluate(`
      const tab = app.setting.pluginTabs.find((t) => t.id === ${q(PLUGIN_ID)});
      window.__smoke.displayCalls = 0;
      if (tab) { const o = tab.display.bind(tab); tab.display = () => { window.__smoke.displayCalls += 1; return o(); }; window.__smoke.tabFound = true; } else window.__smoke.tabFound = false;
      return true;
    `);
    await klick(cdp, PRIMAER);
    await sleep(1800);
    const aktiv = await cdp.evaluate<{ offen: boolean; tab: string | null; displayCalls: number; tabFound: boolean }>(`
      const s = app.setting; return { offen: Boolean(document.querySelector(".modal.mod-settings")) || Boolean(s.containerEl && s.containerEl.isConnected), tab: s.activeTab ? s.activeTab.id : null, displayCalls: window.__smoke.displayCalls, tabFound: window.__smoke.tabFound };
    `);
    const ctx9 = await verbindeTab(cdp, port);
    try {
      rec("O9a", aktiv.tab === PLUGIN_ID, `activeTab=${q(aktiv.tab)} (Tab gefunden: ${aktiv.tabFound}), Einstellungen als ${ctx9.fenster ? "eigenes Fenster" : "Modal"}`);
      const namen = async (): Promise<string[]> => ctx9.s.evaluate<string[]>(`return Array.from(document.querySelectorAll(".vertical-tab-content .setting-item-name, .setting-item-name")).map((n) => (n.textContent || "").trim()).filter((x, i, a) => a.indexOf(x) === i);`);
      const nativ = await namen();
      const notizNativ = await ctx9.s.evaluate<{ n: number; text: string | null; imBeschreibung: boolean }>(`
        const items = Array.from(document.querySelectorAll(".setting-item")).filter((s) => (s.textContent || "").includes("Source root"));
        const n = document.querySelector(".dmr-field-note");
        return { n: document.querySelectorAll(".dmr-field-note").length, text: n ? (n.textContent || "") : null, imBeschreibung: Boolean(n && n.closest(".setting-item-description")) };
      `);
      // Fallback: display() von Hand, im Kontext des Tabs. Der Kit-Walker zeichnet dieselbe Struktur.
      const aufruf = await cdp.evaluate<{ ok: boolean; fehler: string | null }>(`
        const tab = app.setting.pluginTabs.find((t) => t.id === ${q(PLUGIN_ID)}); try { tab.display(); return { ok: true, fehler: null }; } catch (e) { return { ok: false, fehler: String(e) }; }
      `);
      await sleep(600);
      const fallback = await namen();
      const notizFallback = await ctx9.s.evaluate<{ n: number; text: string | null }>(`const n = document.querySelector(".dmr-field-note"); return { n: document.querySelectorAll(".dmr-field-note").length, text: n ? (n.textContent || "") : null };`);
      const erste = nativ[0];
      const gleich = JSON.stringify(nativ) === JSON.stringify(fallback);
      rec("O9b", aufruf.ok && gleich && nativ.length >= 10 && erste === "Help" && notizNativ.n >= 1 && notizFallback.n >= 1,
        `Pfad: Obsidian rief display() ${aktiv.displayCalls}× selbst (${aktiv.displayCalls === 0 ? "deklarativ" : "display()"}) · nativ ${nativ.length} Zeilen, erste ${q(erste)} · Fallback ${fallback.length} Zeilen, gleich=${gleich}${gleich ? "" : ` (nativ=${q(nativ)} fallback=${q(fallback)})`} · Hinweise nativ ${notizNativ.n}, Fallback ${notizFallback.n}${aufruf.fehler ? ` · Fehler ${aufruf.fehler}` : ""}`);
      await bild(ctx9.s, "02-einstellungen");

      // blur: genau einmal speichern. Erst eine Änderung (Wurzel), dann derselbe Wert nochmal (kein Speichern).
      await cdp.evaluate(`window.__smoke.saves.root = 0; window.__smoke.saves.data = 0; return true;`);
      const f1 = await fuelleFeld(ctx9, "Source root", MAIN);
      await warteBis(cdp, `${P}.root === ${q(MAIN)}`, 4000, 100);
      await sleep(300);
      const s1 = await cdp.evaluate<{ root: number; data: number; stored: string | null }>(`return { root: window.__smoke.saves.root, data: window.__smoke.saves.data, stored: app.loadLocalStorage(${q(`${PLUGIN_ID}:root`)}) };`);
      await cdp.evaluate(`window.__smoke.saves.root = 0; return true;`);
      await fuelleFeld(ctx9, "Source root", MAIN);
      await sleep(400);
      const s2 = await cdp.evaluate<number>(`return window.__smoke.saves.root;`);
      // Zahlenfeld: ungültig → kein Speichern, gültig → ein saveData.
      await cdp.evaluate(`window.__smoke.saves.data = 0; return true;`);
      await fuelleFeld(ctx9, "Largest file", "abc");
      await sleep(400);
      const sUng = await cdp.evaluate<{ data: number; max: number }>(`return { data: window.__smoke.saves.data, max: ${P}.settings.maxFileBytes };`);
      const fehlerNotiz = await ctx9.s.evaluate<string | null>(`const n = Array.from(document.querySelectorAll(".dmr-field-note.is-error"))[0]; return n ? (n.textContent || "") : null;`);
      await fuelleFeld(ctx9, "Largest file", "5");
      await sleep(400);
      const sGueltig = await cdp.evaluate<{ data: number; max: number }>(`return { data: window.__smoke.saves.data, max: ${P}.settings.maxFileBytes };`);
      rec("O9c", s1.root === 1 && s1.stored === MAIN && s2 === 0 && sUng.data === 0 && sUng.max === 5 * 1024 * 1024 && sGueltig.data === 0,
        `Wurzel setzen (${f1.blurMitFokus ? "echtes blur" : "Fenster ohne Systemfokus: blur-Ereignis vom Treiber gesendet"}): ${s1.root} Schreibzugriff(e) auf den Wurzel-Schlüssel, gespeichert=${q(s1.stored === MAIN ? "ja" : s1.stored)} · derselbe Wert nochmal: ${s2} · „Largest file“ ungültig „abc“: saveData ${sUng.data}×, Wert ${sUng.max} · gültig „5“ (gleich dem Stand): saveData ${sGueltig.data}×`);
      rec("O9d", fehlerNotiz !== null && /Enter a valid number/.test(fehlerNotiz),
        `Hinweiszeile nach ungültigem Wert: ${q(fehlerNotiz)} (im Beschreibungsbereich, nach setDesc des Hatch gezeichnet)`);

      // Schalter: echter Klick auf den Schalter „Dot folders“ (ändert den Fingerabdruck nicht dauerhaft: wir klicken zweimal).
      const vorS = await cdp.evaluate<boolean>(`return ${P}.settings.includeDotFolders;`);
      const klickSchalter = (): Promise<boolean> => clickReal(ctx9.s, `(() => { const it = Array.from(document.querySelectorAll(".setting-item")).find((s) => ((s.querySelector(".setting-item-name") || {}).textContent || "").trim() === "Dot folders"); return it ? it.querySelector(".checkbox-container") : null; })()`);
      const k1 = await klickSchalter();
      await sleep(600);
      const nachS = await cdp.evaluate<{ v: boolean; data: string | null }>(`const f = ${q(`.obsidian/plugins/${PLUGIN_ID}/data.json`)}; return { v: ${P}.settings.includeDotFolders, data: (await app.vault.adapter.exists(f)) ? await app.vault.adapter.read(f) : null };`);
      const k2 = await klickSchalter();
      await sleep(600);
      const zurueck = await cdp.evaluate<{ v: boolean; data: string | null }>(`const f = ${q(`.obsidian/plugins/${PLUGIN_ID}/data.json`)}; return { v: ${P}.settings.includeDotFolders, data: (await app.vault.adapter.exists(f)) ? await app.vault.adapter.read(f) : null };`);
      const inData = (d: string | null): boolean | null => { try { return (JSON.parse(d ?? "") as { includeDotFolders?: boolean }).includeDotFolders ?? null; } catch { return null; } };
      rec("O9e", k1 && k2 && vorS === false && nachS.v === true && inData(nachS.data) === true && zurueck.v === false && inData(zurueck.data) === false,
        `Klick 1: Zustand ${vorS}→${nachS.v}, data.json includeDotFolders=${inData(nachS.data)} · Klick 2: Zustand ${zurueck.v}, data.json=${inData(zurueck.data)}`);
    } finally {
      await schliesseTab(cdp, ctx9);
    }
    await cdp.evaluate(`await ${P}.updateSettings({ includeDotFolders: false }); return true;`);

    /* ── B, B2 ─────────────────────────────────────────────────────────────────────────────────────────────────── */
    console.log("\nB · Erster Lauf");
    const vorB = await vaultDateien(cdp);
    await clearNotices(cdp);
    await klick(cdp, PRIMAER); // Primärknopf = „Sync now“
    const wartet = await warteStatus(cdp, "Waiting for confirmation", 20000);
    const b = await lese(cdp);
    await probe("waiting");
    const notizB = await notices(cdp);
    const neuGruppe = b.groups.find((gr) => /new file/.test(gr.summary));
    const nurImVault = b.groups.find((gr) => gr.separate);
    const nachB = await vaultDateien(cdp);
    const gespiegelt = MIRROR.filter((f) => nachB.includes(f));
    const inVorschau = new Set(b.groups.flatMap((gr) => gr.rows));
    const verbotenInVorschau = NOT_MIRRORED.filter((f) => inVorschau.has(f));
    rec("B", wartet && neuGruppe?.summary === `${MIRROR.length} new files` && MIRROR.every((f) => neuGruppe.rows.includes(f)) && verbotenInVorschau.length === 0 &&
      b.reasons.some((r) => /^First run/.test(r)) && gespiegelt.length === 0 && JSON.stringify(vorB) === JSON.stringify(nachB) &&
      b.primary?.text === "Run plan" && b.secondary?.text === "Sync now" && b.secondary.hidden === false && /needs confirmation/.test(notizB),
      `Status ${q(b.statusText)} · Gruppe ${q(neuGruppe?.summary)} (${neuGruppe?.rows.length} Zeilen) · Gründe ${q(b.reasons)} · verbotene Pfade in der Vorschau: ${q(verbotenInVorschau)} · Vault vorher/nachher gleich: ${JSON.stringify(vorB) === JSON.stringify(nachB)} (${nachB.length} Dateien) · Knöpfe ${q(b.primary?.text)}/${q(b.secondary?.text)} · Notice ${q(notizB)}`);
    await bild(cdp, "03-vorschau-erster-lauf");

    console.log("\nB2 · Bestätigung abbrechen");
    await klick(cdp, PRIMAER);
    const dB2 = await leseDialog(cdp);
    await klickeDialogKnopf(cdp, "Cancel");
    await sleep(500);
    const b2 = await lese(cdp);
    const nachB2 = await vaultDateien(cdp);
    rec("B2", dB2 !== null && dB2.title === "Run the plan?" && dB2.paras.some((p) => /^First run/.test(p)) && dB2.paras.some((p) => p === `${MIRROR.length} new files`) && dB2.buttons.map((x) => x.text).join("|") === "Cancel|Run plan" &&
      b2.statusText === "Waiting for confirmation" && JSON.stringify(nachB2) === JSON.stringify(vorB),
      `Dialog ${q(dB2?.title)} mit ${q(dB2?.paras)} · Knöpfe ${q(dB2?.buttons.map((x) => x.text))} · nach „Cancel“: Status ${q(b2.statusText)}, Vault unverändert=${JSON.stringify(nachB2) === JSON.stringify(vorB)}`);
    await bild(cdp, "04-bestaetigung-nach-abbruch");

    /* ── C, D ──────────────────────────────────────────────────────────────────────────────────────────────────── */
    console.log("\nC · Plan ausführen");
    const lauf1 = await fuehreAus(cdp);
    await probe("current");
    const c = await lese(cdp);
    const nachC = await vaultDateien(cdp);
    const fehlende = MIRROR.filter((f) => !nachC.includes(f));
    const verboten = NOT_MIRRORED.filter((f) => nachC.includes(f));
    const ungleich: string[] = [];
    for (const f of MIRROR) {
      if (f.endsWith(".png")) {
        const st = await vaultStat(cdp, f);
        if (st?.size !== statSync(join(MAIN, f)).size) ungleich.push(f);
      } else if ((await vaultLies(cdp, f)) !== text(join(MAIN, f))) ungleich.push(f);
    }
    const tmpRest = await cdp.evaluate<string[]>(`const d = ${q(`.obsidian/plugins/${PLUGIN_ID}/tmp`)}; if (!(await app.vault.adapter.exists(d))) return []; return (await app.vault.adapter.list(d)).files;`);
    rec("C", lauf1.fertig && fehlende.length === 0 && verboten.length === 0 && ungleich.length === 0 && tmpRest.length === 0 &&
      c.counters["New"] === MIRROR.length && c.counters["Skipped"] === 3 && c.counters["Errors"] === 0,
      `Status ${q(c.statusText)} · fehlende Kopien ${q(fehlende)} · verbotene im Vault ${q(verboten)} · Inhalt ungleich ${q(ungleich)} · Temp-Reste ${tmpRest.length} · Zähler New=${c.counters["New"]}, Skipped=${c.counters["Skipped"]} (Symlink, große Datei, Fremdtyp), Errors=${c.counters["Errors"]} · Vault hat ${nachC.length} Dateien`);
    await bild(cdp, "05-ergebnis-erster-lauf");

    console.log("\nD · Zeitstempel");
    const abw: string[] = []; let maxAbw = 0;
    for (const f of MIRROR) {
      const st = await vaultStat(cdp, f);
      const quelle = statSync(join(MAIN, f));
      const d = Math.abs((st?.mtime ?? 0) - Math.floor(quelle.mtimeMs));
      maxAbw = Math.max(maxAbw, d);
      if (d !== 0 || st?.size !== quelle.size) abw.push(`${f}: Vault ${st?.mtime}/${st?.size} Quelle ${Math.floor(quelle.mtimeMs)}/${quelle.size}`);
    }
    rec("D", abw.length === 0, `${MIRROR.length} Dateien, größte Abweichung ${maxAbw} ms${abw.length ? ` · ${abw.join(" · ")}` : ""}`);

    /* ── E ─────────────────────────────────────────────────────────────────────────────────────────────────────── */
    console.log("\nE · Quelle geändert");
    const eFile = "repo-alpha/docs/index.md";
    writeFileSync(join(MAIN, eFile), `${text(join(MAIN, eFile))}\nEine neue Zeile aus der Quelle.\n`);
    const eWartet = await plane(cdp);
    const e = await lese(cdp);
    const eGruppe = e.groups.find((gr) => /changed file/.test(gr.summary));
    const eVorher = await vaultLies(cdp, eFile);
    const eLauf = await fuehreAus(cdp);
    const eNachher = await vaultLies(cdp, eFile);
    const eNach = await lese(cdp);
    rec("E", eWartet && eGruppe?.summary === "1 changed file" && eGruppe.rows.join() === eFile && eVorher !== text(join(MAIN, eFile)) && eLauf.fertig && eNachher === text(join(MAIN, eFile)) && eNach.counters["Changed"] === 1 && e.reasons.some((r) => /^Settings changed/.test(r)),
      `Vorschau ${q(eGruppe?.summary)} ${q(eGruppe?.rows)} · Grund ${q(e.reasons)} · Kopie vor dem Lauf alt=${eVorher !== text(join(MAIN, eFile))}, danach gleich Quelle=${eNachher === text(join(MAIN, eFile))} · Zähler Changed=${eNach.counters["Changed"]}`);

    /* ── F, G ──────────────────────────────────────────────────────────────────────────────────────────────────── */
    console.log("\nF · Quelle gelöscht");
    const fFile = "repo-beta/docs/notes/b.md";
    rmSync(join(MAIN, fFile));
    const fWartet = await plane(cdp);
    const f = await lese(cdp);
    const fGruppe = f.groups.find((gr) => /to delete/.test(gr.summary));
    const nochDa = await vaultExistiert(cdp, fFile);
    await bild(cdp, "06-vorschau-loeschen");
    await klick(cdp, PRIMAER);
    const dF = await leseDialog(cdp);
    const warnKnopf = dF?.buttons.find((x) => x.text === "Run plan")?.cls ?? "";
    await klickeDialogKnopf(cdp, "Run plan");
    const fFertig = await warteStatus(cdp, "Up to date", 30000);
    const weg = !(await vaultExistiert(cdp, fFile));
    const ordnerWeg = !(await cdp.evaluate<boolean>(`return await app.vault.adapter.exists("repo-beta/docs/notes");`));
    const aStehtNoch = await vaultExistiert(cdp, "repo-beta/docs/a.md");
    rec("F", fWartet && fGruppe?.summary === "1 file to delete" && fGruppe.open && fGruppe.rows.join() === fFile && nochDa && (dF?.paras ?? []).includes("1 file to delete") && /mod-(warning|destructive)/.test(warnKnopf) && fFertig && weg && ordnerWeg && aStehtNoch,
      `Vorschau ${q(fGruppe?.summary)} (offen=${fGruppe?.open}) ${q(fGruppe?.rows)} · vor dem Lauf noch da=${nochDa} · Dialog ${q(dF?.paras)} mit Knopf-Klasse ${q(warnKnopf)} · danach Datei weg=${weg}, leerer Ordner weg=${ordnerWeg}, Nachbar a.md bleibt=${aStehtNoch}`);

    console.log("\nG · Fremddatei");
    const nurF = f.groups.find((gr) => gr.separate);
    const fremdDa = await vaultExistiert(cdp, FOREIGN);
    const fremdInhalt = await vaultLies(cdp, FOREIGN);
    const mk = await manifestSchluessel(cdp);
    rec("G", nurF !== undefined && nurF.summary === "1 file only in the vault" && nurF.rows.join() === FOREIGN && fremdDa && fremdInhalt === text(join(FIXTURE_VAULT, "notes", FOREIGN)) && !mk.includes(FOREIGN) &&
      (nurF.hint ?? "").includes("never touched"),
      `Gruppe ${q(nurF?.summary)} ${q(nurF?.rows)} (getrennt=${nurF?.separate}, Hinweis ${q(nurF?.hint)}) · nach dem Löschlauf: Datei da=${fremdDa}, Inhalt unverändert=${fremdInhalt === text(join(FIXTURE_VAULT, "notes", FOREIGN))}, im Manifest=${mk.includes(FOREIGN)}`);

    /* ── H ─────────────────────────────────────────────────────────────────────────────────────────────────────── */
    console.log("\nH · Im Vault verändert");
    const hFile = "repo-gamma/docs/c.md";
    await cdp.evaluate(`await app.vault.adapter.write(${q(hFile)}, "IM VAULT VERAENDERT, nicht aus der Quelle\\n"); return true;`);
    const hWartet = await plane(cdp);
    const h = await lese(cdp);
    const hGruppe = h.groups.find((gr) => /edited in the vault/.test(gr.summary));
    await probe("waiting-h");
    await bild(cdp, "07-vorschau-im-vault-veraendert");
    const hVorher = await vaultLies(cdp, hFile);
    const hLauf = await fuehreAus(cdp);
    const hNachher = await vaultLies(cdp, hFile);
    rec("H", hWartet && hGruppe?.summary === "1 file edited in the vault" && hGruppe.open && hGruppe.rows.join() === hFile && (hGruppe.hint ?? "").includes("overwritten with the source version") && hLauf.fertig && hVorher?.startsWith("IM VAULT") === true && hNachher === text(join(MAIN, hFile)),
      `Vorschau ${q(hGruppe?.summary)} (offen=${hGruppe?.open}) ${q(hGruppe?.rows)} · Hinweis ${q(hGruppe?.hint)} · vor dem Lauf ${q(hVorher?.slice(0, 20))}…, danach gleich Quelle=${hNachher === text(join(MAIN, hFile))}`);

    /* ── O4: Konflikte ─────────────────────────────────────────────────────────────────────────────────────────── */
    console.log("\nO4 · Konflikte und Überschreiben");
    const clash = ["repo-gamma/docs/clash1.md", "repo-gamma/docs/clash2.md"];
    clash.forEach((p, i) => { writeFileSync(join(MAIN, p), `# Konflikt ${i + 1}\n\nFassung aus der Quelle.\n`); });
    for (const p of clash) await cdp.evaluate(`await app.vault.adapter.write(${q(p)}, "Fremde Fassung im Vault\\n"); return true;`);
    await klick(cdp, PRIMAER);
    const o4Wartet = await warteStatus(cdp, "Waiting for confirmation", 15000);
    // Die „Konflikte“-Gruppe ist zu: aufklappen wie ein Nutzer (Klick auf die Zusammenfassung).
    await klick(cdp, `Array.from(document.querySelectorAll(".dmr-group summary")).find((s) => /conflict/.test(s.textContent || ""))`);
    await sleep(300);
    const o4 = await lese(cdp);
    const kGruppe = o4.groups.find((gr) => /conflict/.test(gr.summary));
    await klick(cdp, `Array.from(document.querySelectorAll(".dmr-overwrite-bar button")).find((b) => b.textContent.trim() === "Overwrite all")`);
    await sleep(300);
    const alle = await lese(cdp);
    await klick(cdp, `Array.from(document.querySelectorAll(".dmr-overwrite-bar button")).find((b) => b.textContent.trim() === "Overwrite none")`);
    await sleep(300);
    const keine = await lese(cdp);
    await bild(cdp, "08-konflikte");
    rec("O4a", o4Wartet && kGruppe?.summary === "2 conflicts" && o4.boxes.length === 2 && o4.boxes.every((x) => !x.checked && !x.disabled) &&
      alle.boxes.length === 2 && alle.boxes.every((x) => x.checked && x.disabled) && keine.boxes.every((x) => !x.checked && !x.disabled),
      `Gruppe ${q(kGruppe?.summary)} · Anfang ${q(o4.boxes.map((x) => `${x.checked ? "x" : "-"}${x.disabled ? "d" : "e"}`))} · „Overwrite all“ ${q(alle.boxes.map((x) => `${x.checked ? "x" : "-"}${x.disabled ? "d" : "e"}`))} · „Overwrite none“ ${q(keine.boxes.map((x) => `${x.checked ? "x" : "-"}${x.disabled ? "d" : "e"}`))}`);

    // O4c: Fokus auf einem Körper-Kästchen, dann ein Neuaufbau des Körpers (notify).
    await cdp.evaluate(`const b = document.querySelector(".dmr-overwrite"); b.focus(); return true;`);
    const fokusVor = await cdp.evaluate<{ cls: string | null; label: string | null }>(`const a = document.activeElement; return { cls: a ? a.className : null, label: a ? a.getAttribute("aria-label") : null };`);
    await cdp.evaluate(`${P}.notify(); return true;`);
    await sleep(300);
    const fokusNach = await cdp.evaluate<{ cls: string | null; label: string | null; tag: string | null }>(`const a = document.activeElement; return { cls: a ? a.className : null, label: a ? a.getAttribute("aria-label") : null, tag: a ? a.tagName : null };`);
    rec("O4c", (fokusVor.cls ?? "").split(" ").includes("dmr-overwrite") && (fokusNach.cls ?? "").split(" ").includes("dmr-overwrite") && fokusNach.tag === "INPUT" && fokusNach.label === fokusVor.label,
      `Fokus vor dem Neuaufbau: ${q(fokusVor.label)} (${q(fokusVor.cls)}) · danach: ${q(fokusNach.label)} (<${fokusNach.tag}> ${q(fokusNach.cls)})`);

    // O4b: nur clash1 ankreuzen (echter Klick auf das Kästchen), ausführen.
    await klick(cdp, `document.querySelector('.dmr-overwrite[aria-label$="clash1.md"]')`);
    await sleep(200);
    const mitHaken = await lese(cdp);
    await klick(cdp, PRIMAER);
    const dO4 = await leseDialog(cdp);
    await klickeDialogKnopf(cdp, "Run plan");
    const o4Fertig = await warteStatus(cdp, "Waiting for confirmation", 3000) || await warteStatus(cdp, "Up to date", 20000);
    await sleep(400);
    const i1 = await vaultLies(cdp, clash[0]!); const i2 = await vaultLies(cdp, clash[1]!);
    const nach4 = await lese(cdp);
    rec("O4b", mitHaken.boxes.filter((x) => x.checked).map((x) => x.path).join() === clash[0] && (dO4?.paras ?? []).includes("1 file in the vault will be overwritten with the source version.") && o4Fertig &&
      i1 === text(join(MAIN, clash[0]!)) && i2 === "Fremde Fassung im Vault\n" && nach4.counters["Overwritten"] === 1,
      `angekreuzt ${q(mitHaken.boxes.filter((x) => x.checked).map((x) => x.path))} · Dialog ${q(dO4?.paras.filter((p) => /overwritten/.test(p)))} · danach clash1 gleich Quelle=${i1 === text(join(MAIN, clash[0]!))}, clash2 noch Vault-Fassung=${i2 === "Fremde Fassung im Vault\n"} · Overwritten=${nach4.counters["Overwritten"]} · Status ${q(nach4.statusText)}`);
    // Den zweiten Konflikt auflösen („Overwrite all“), damit er die folgenden Läufe nicht mehr zur Bestätigung zwingt.
    if (nach4.statusText !== "Waiting for confirmation") await klick(cdp, PRIMAER);
    if (await warteStatus(cdp, "Waiting for confirmation", 15000)) {
      await klick(cdp, `Array.from(document.querySelectorAll(".dmr-group summary")).find((s) => /conflict/.test(s.textContent || ""))`);
      await sleep(300);
      await klick(cdp, `Array.from(document.querySelectorAll(".dmr-overwrite-bar button")).find((b) => b.textContent.trim() === "Overwrite all")`);
      await fuehreAus(cdp);
    }
    const alleGeloest = (await vaultLies(cdp, clash[1]!)) === text(join(MAIN, clash[1]!)) && (await cdp.evaluate<boolean>(`return ${P}.runner.pending() === null;`));
    if (!alleGeloest) throw new Error("Vorbedingung für die folgenden Punkte verfehlt: der zweite Konflikt ließ sich nicht auflösen.");

    /* ── O10 ───────────────────────────────────────────────────────────────────────────────────────────────────── */
    console.log("\nO10 · Doppelter Auslöser");
    await warteStatus(cdp, "Up to date", 10000);
    await clearNotices(cdp);
    await cdp.evaluate(`window.__smoke.runs = 0; return true;`);
    await cdp.evaluate(`app.commands.executeCommandById("docs-mirror:sync-now"); app.commands.executeCommandById("docs-mirror:sync-now"); return true;`);
    await sleep(150);
    const nZweiBefehle = await notices(cdp);
    await warteStatus(cdp, "Up to date", 10000);
    await sleep(500);
    const lauefe1 = await cdp.evaluate<number>(`return window.__smoke.runs;`);
    const anz1 = (nZweiBefehle.match(/A sync is already running\./g) ?? []).length;
    await clearNotices(cdp);
    await cdp.evaluate(`window.__smoke.runs = 0; return true;`);
    await cdp.evaluate(`document.querySelector(".dmr-primary").click(); app.commands.executeCommandById("docs-mirror:sync-now"); return true;`);
    await sleep(150);
    const nKnopfBefehl = await notices(cdp);
    await warteStatus(cdp, "Up to date", 10000);
    await sleep(500);
    const lauefe2 = await cdp.evaluate<number>(`return window.__smoke.runs;`);
    const anz2 = (nKnopfBefehl.match(/A sync is already running\./g) ?? []).length;
    rec("O10", lauefe1 === 1 && anz1 === 1 && lauefe2 === 1 && anz2 === 1,
      `Befehl ×2: ${lauefe1} Lauf, „läuft bereits“ ${anz1}× (${q(nZweiBefehle)}) · Knopf+Befehl: ${lauefe2} Lauf, „läuft bereits“ ${anz2}× (${q(nKnopfBefehl)}) · das Ribbon-Icon öffnet nur die Ansicht und löst keinen Lauf aus`);

    // O10c: Startlauf (Timer nach 2 s) und Befehle treffen zusammen; nur über ein Neuladen des Plugins herstellbar.
    console.log("\nO10c · Startlauf gegen Befehl");
    await cdp.evaluate(`await ${P}.updateSettings({ syncOnStart: true }); return true;`);
    await clearNotices(cdp);
    const o10c = await cdp.evaluate<{ gesamt: number; maxGleichzeitig: number; laeuft: number }>(`
      await app.plugins.disablePlugin(${q(PLUGIN_ID)}); await app.plugins.enablePlugin(${q(PLUGIN_ID)});
      const p = ${P}; const r = p.runner; const o = r.run.bind(r);
      const z = { gesamt: 0, aktiv: 0, max: 0, laeuft: 0 };
      r.run = (...a) => { z.gesamt += 1; z.aktiv += 1; z.max = Math.max(z.max, z.aktiv); return o(...a).finally(() => { z.aktiv -= 1; }); };
      window.__smoke.undo = () => { r.run = o; };
      // Befehle im Takt von 20 ms rund um den Startlauf-Timer (2000 ms nach dem Laden)
      const t0 = performance.now();
      while (performance.now() - t0 < 2600) {
        if (performance.now() - t0 > 1700) app.commands.executeCommandById("docs-mirror:sync-now");
        await new Promise((res) => setTimeout(res, 20));
      }
      await new Promise((res) => setTimeout(res, 1500));
      return { gesamt: z.gesamt, maxGleichzeitig: z.max, laeuft: z.aktiv };
    `);
    const o10cNotice = await notices(cdp);
    await cdp.evaluate(`await ${P}.updateSettings({ syncOnStart: false }); return true;`);
    rec("O10c", o10c.maxGleichzeitig === 1 && o10c.laeuft === 0 && o10c.gesamt >= 2,
      `Befehle alle 20 ms von 1,7 s bis 2,6 s nach dem Laden, Startlauf-Timer bei 2 s: ${o10c.gesamt} Aufrufe von runner.run, nie mehr als ${o10c.maxGleichzeitig} gleichzeitig, danach ${o10c.laeuft} laufend · Notices ${q(o10cNotice)} (der Startlauf läuft auch nach einem früheren manuellen Lauf noch einmal: redundant, folgenlos)`);
    // Spione nach dem Neuladen neu setzen (das Plugin-Objekt ist ein neues).
    await cdp.evaluate(`
      const w = window; const p = ${P}; const r = p.runner; const o = r.run.bind(r); w.__smoke.runs = 0;
      r.run = (...a) => { w.__smoke.runs += 1; return o(...a); };
      const os = p.saveData.bind(p); p.saveData = (d) => { w.__smoke.saves.data += 1; return os(d); };
      w.__smoke.undo = () => { r.run = o; p.saveData = os; };
      return true;
    `);
    await cdp.evaluate(`app.commands.executeCommandById("docs-mirror:open"); return true;`);
    await warteStatus(cdp, "Up to date", 10000);

    /* ── I, J ──────────────────────────────────────────────────────────────────────────────────────────────────── */
    /* ── I2, J2: die Quelle verschwindet, Fingerabdruck und Einstellungen bleiben ───────────────────────────────── */
    console.log("\nI2 · Quelle verschwindet bei unverändertem Fingerabdruck");
    // I und J ändern die Wurzel: die Bestätigungspflicht („Settings changed“) fängt dort das Löschen schon vorher. Hier bleibt die Wurzel,
    // der Fingerabdruck gilt, die Löschschwelle (20) ist unterschritten: allein der Löschschutz steht zwischen der Quelle und dem Vault.
    const lastAt = (): Promise<number | null> => cdp.evaluate<number | null>(`return ${P}.last ? ${P}.last.at : null;`);
    const bereit = async (): Promise<{ ok: boolean; detail: string }> => {
      await warteStatus(cdp, "Up to date", 15000);
      const at0 = await lastAt();
      await klick(cdp, PRIMAER);
      const gelaufen = await warteBis(cdp, `${P}.last && ${P}.last.at !== ${q(at0)}`, 15000, 100);
      const st = await lese(cdp);
      const wartet = await cdp.evaluate<boolean>(`return ${P}.runner.pending() !== null;`);
      return { ok: gelaufen && st.statusText === "Up to date" && !wartet, detail: `Vorlauf ohne Bestätigung: gelaufen=${gelaufen}, Status ${q(st.statusText)}, wartender Plan=${wartet}` };
    };
    const vorb = await bereit();
    const vorI2 = await vaultDateien(cdp);
    const mVorI2 = await geraetWert(cdp, "manifest");
    const fpVorI2 = await geraetWert(cdp, "fingerprint");
    const anzI2 = mVorI2 === null ? 0 : Object.keys(JSON.parse(mVorI2) as Record<string, unknown>).length;
    verschiebe(MAIN, `${MAIN}-weg`);
    await clearNotices(cdp);
    await klick(cdp, PRIMAER);
    const i2Status = await warteStatus(cdp, "Source unreachable", 15000);
    await sleep(300);
    const i2Notice = await notices(cdp);
    const nachI2 = await vaultDateien(cdp);
    const mNachI2 = await geraetWert(cdp, "manifest");
    const fpNachI2 = await geraetWert(cdp, "fingerprint");
    await bild(cdp, "09b-quelle-weg-gleicher-fingerabdruck");
    rec("I2", vorb.ok && mVorI2 !== null && anzI2 > 0 && vorI2.length >= 7 && i2Status && /source is unreachable\. Nothing was deleted/.test(i2Notice) && JSON.stringify(vorI2) === JSON.stringify(nachI2) && mVorI2 === mNachI2 && fpVorI2 === fpNachI2,
      `${vorb.detail} · Quelle weggenommen, Wurzel und Einstellungen unverändert, Fingerabdruck vorher/nachher gleich=${fpVorI2 === fpNachI2} · Status ${i2Status ? "\"Source unreachable\"" : "NICHT erreicht"} · Notice ${q(i2Notice)} · Vault vorher ${vorI2.length} / nachher ${nachI2.length} Dateien, gleich=${JSON.stringify(vorI2) === JSON.stringify(nachI2)} · Manifest ${anzI2} Einträge, unverändert=${mVorI2 === mNachI2}`);
    stelleQuellenWiederHer();

    console.log("\nJ2 · Alle Treffer verschwinden");
    const vorb2 = await bereit();
    const vorJ2 = await vaultDateien(cdp);
    const mVorJ2 = await geraetWert(cdp, "manifest");
    const fpVorJ2 = await geraetWert(cdp, "fingerprint");
    const anzJ2 = mVorJ2 === null ? 0 : Object.keys(JSON.parse(mVorJ2) as Record<string, unknown>).length;
    for (const r of ["repo-alpha", "repo-beta", "repo-gamma"]) verschiebe(join(MAIN, r, "docs"), join(SRC_BASE, "docs-weg", r, "docs"));
    await clearNotices(cdp);
    await klick(cdp, PRIMAER);
    const j2Status = await warteStatus(cdp, "Error", 15000);
    await sleep(300);
    const j2Notice = await notices(cdp);
    const j2Ansicht = await lese(cdp);
    const nachJ2 = await vaultDateien(cdp);
    const mNachJ2 = await geraetWert(cdp, "manifest");
    const fpNachJ2 = await geraetWert(cdp, "fingerprint");
    rec("J2", vorb2.ok && mVorJ2 !== null && anzJ2 > 0 && vorJ2.length >= 7 && j2Status && /source is empty\. Nothing was deleted/.test(j2Notice) && (j2Ansicht.error ?? "").includes("the source is empty") && JSON.stringify(vorJ2) === JSON.stringify(nachJ2) && mVorJ2 === mNachJ2 && fpVorJ2 === fpNachJ2,
      `${vorb2.detail} · die drei docs-Ordner weggenommen, Wurzel besteht, Fingerabdruck gleich=${fpVorJ2 === fpNachJ2} · Status ${q(j2Ansicht.statusText)}, Fehlerzeile ${q(j2Ansicht.error)} · Notice ${q(j2Notice)} · Vault vorher ${vorJ2.length} / nachher ${nachJ2.length} Dateien, gleich=${JSON.stringify(vorJ2) === JSON.stringify(nachJ2)} · Manifest ${anzJ2} Einträge, unverändert=${mVorJ2 === mNachJ2}`);
    stelleQuellenWiederHer();
    await klick(cdp, PRIMAER);
    await warteStatus(cdp, "Up to date", 15000);

    console.log("\nI · Wurzel nicht vorhanden");
    const vorI = await vaultDateien(cdp);
    const mVorI = await geraetWert(cdp, "manifest");
    const mVorIAnzahl = mVorI === null ? 0 : Object.keys(JSON.parse(mVorI) as Record<string, unknown>).length;
    const wI = await setzeWurzel(cdp, port, MISSING);
    await clearNotices(cdp);
    await klick(cdp, PRIMAER);
    const iStatus = await warteStatus(cdp, "Source unreachable", 15000);
    await sleep(300);
    const iNotice = await notices(cdp);
    const iAnsicht = await lese(cdp);
    await probe("unreachable");
    await bild(cdp, "09-quelle-nicht-erreichbar");
    const nachI = await vaultDateien(cdp);
    const mNachI = await geraetWert(cdp, "manifest");
    rec("I", wI.ok && iStatus && /source is unreachable\. Nothing was deleted/.test(iNotice) && JSON.stringify(vorI) === JSON.stringify(nachI) && mVorI !== null && mVorIAnzahl > 0 && mVorI === mNachI && iAnsicht.error === "Source unreachable",
      `Wurzel ${wI.ok ? "gesetzt" : "NICHT gesetzt"} · Status ${q(iAnsicht.statusText)} · Fehlerzeile ${q(iAnsicht.error)} · Notice ${q(iNotice)} · Vault vorher ${vorI.length} / nachher ${nachI.length} Dateien, gleich=${JSON.stringify(vorI) === JSON.stringify(nachI)} · Manifest unverändert=${mVorI === mNachI} (${mVorIAnzahl} Einträge vorher)`);

    console.log("\nJ · Wurzel leerer Ordner");
    await setzeWurzel(cdp, port, EMPTY);
    await clearNotices(cdp);
    await klick(cdp, PRIMAER);
    const jStatus = await warteStatus(cdp, "Error", 15000);
    await sleep(300);
    const jNotice = await notices(cdp);
    const jAnsicht = await lese(cdp);
    await probe("error");
    await bild(cdp, "10-quelle-leer");
    const nachJ = await vaultDateien(cdp);
    const mNachJ = await geraetWert(cdp, "manifest");
    rec("J", jStatus && /source is empty\. Nothing was deleted/.test(jNotice) && JSON.stringify(vorI) === JSON.stringify(nachJ) && mVorI !== null && mVorIAnzahl > 0 && mVorI === mNachJ && (jAnsicht.error ?? "").includes("the source is empty"),
      `Status ${q(jAnsicht.statusText)} · Fehlerzeile ${q(jAnsicht.error)} · Notice ${q(jNotice)} · Vault ${nachJ.length} Dateien, gleich=${JSON.stringify(vorI) === JSON.stringify(nachJ)} · Manifest unverändert=${mVorI === mNachJ} (${mVorIAnzahl} Einträge vorher)`);
    // Zurück auf die echte Quelle: nichts wurde verloren, der Lauf braucht keine Bestätigung.
    await setzeWurzel(cdp, port, MAIN);
    await klick(cdp, PRIMAER);
    const zurueckOk = await warteStatus(cdp, "Up to date", 15000);
    const zr = await lese(cdp);
    console.log(`  (zurück auf die Quelle: ${zurueckOk ? "Up to date" : zr.statusText}, Zähler ${q(zr.counters)})`);

    /* ── O11 ───────────────────────────────────────────────────────────────────────────────────────────────────── */
    console.log("\nO11 · Wurzel „/“");
    const w11 = await setzeWurzel(cdp, port, "/");
    // Kein Lauf: die Wurzel wird sofort zurückgesetzt.
    await setzeWurzel(cdp, port, MAIN);
    rec("O11", w11.ok && w11.root === "/" && /file system root/.test(w11.notiz ?? ""), `Wurzel ${q(w11.root)} · Hinweiszeile ${q(w11.notiz)} · (kein Lauf, Wurzel zurückgesetzt)`);

    /* ── O12 ───────────────────────────────────────────────────────────────────────────────────────────────────── */
    console.log("\nO12 · Plattform");
    const plat = await cdp.evaluate<{ hatGlobal: boolean; isDesktopApp: boolean | null; ueberModul: boolean | null }>(`
      let m = null; try { m = window.require ? window.require("obsidian") : null; } catch { m = null; }
      const g = (typeof Platform !== "undefined") ? Platform : null;
      return { hatGlobal: Boolean(g), isDesktopApp: g ? Boolean(g.isDesktopApp) : null, ueberModul: m && m.Platform ? Boolean(m.Platform.isDesktopApp) : null };
    `);
    skip("O12", `Platform.isDesktopApp lässt sich in der Zweitinstanz nicht auf false stellen: das Plugin bindet \`Platform\` aus dem Modul „obsidian“, das Obsidian nur den Plugins bereitstellt (window.require("obsidian") im Renderer: ${plat.ueberModul === null ? "nicht auflösbar" : "isDesktopApp=" + plat.ueberModul}; globales Platform: ${plat.hatGlobal ? "da" : "fehlt"}); der Mobil-Fall ist gegen den Mock getestet (tests/main.test.ts), im Container ist die Linux-Desktop-App ebenfalls isDesktopApp=true`);

    /* ── K (Status in allen Zuständen) ─────────────────────────────────────────────────────────────────────────── */
    {
      const erwartung: Record<string, { text: string; cls: string }> = {
        "not-configured": { text: "Not set up", cls: "is-warning" },
        waiting: { text: "Waiting for confirmation", cls: "is-warning" },
        "waiting-h": { text: "Waiting for confirmation", cls: "is-warning" },
        current: { text: "Up to date", cls: "is-ok" },
        unreachable: { text: "Source unreachable", cls: "is-error" },
        error: { text: "Error", cls: "is-error" },
      };
      const mangel: string[] = [];
      for (const p of statusProben) {
        const w = erwartung[p.zustand];
        const a = p.ansicht;
        if (!w) { mangel.push(`${p.zustand}: keine Erwartung`); continue; }
        if (a.statusText !== w.text) mangel.push(`${p.zustand}: Text ${q(a.statusText)}`);
        if (a.aria !== `Status: ${w.text}`) mangel.push(`${p.zustand}: aria ${q(a.aria)}`);
        if (!a.svg) mangel.push(`${p.zustand}: kein Icon`);
        if (!(a.statusCls ?? "").includes(w.cls)) mangel.push(`${p.zustand}: Klasse ${q(a.statusCls)}`);
      }
      const formen = new Set(statusProben.map((p) => p.ansicht.svgCls));
      const nur = new Set(statusProben.map((p) => p.zustand));
      rec("K", mangel.length === 0 && nur.size >= 5 && formen.size >= 3,
        `${statusProben.length} Proben in ${nur.size} Zuständen (${[...nur].join(", ")}) · verschiedene Icon-Formen ${formen.size} · ${mangel.length === 0 ? "Text, svg, aria-label und Klasse stimmen überein" : `Mängel ${q(mangel)}`} (Zustand „running“ misst K2)`);
    }

    /* ── L: Verdeckungsprobe ───────────────────────────────────────────────────────────────────────────────────── */
    console.log("\nL · Aktionszeile");
    // Eine Vorschau mit beiden Knöpfen: Einstellung ändern, planen.
    await plane(cdp);
    const breiteVorher = await cdp.evaluate<number>(`return Math.round(app.workspace.rightSplit.containerEl.getBoundingClientRect().width);`);
    const breiten: { name: string; breite: number | null }[] = [{ name: "Standardbreite", breite: null }, { name: "schmal", breite: 220 }, { name: "sehr schmal", breite: 140 }];
    const lMessungen: string[] = []; let lOk = true;
    let schmalErreicht = false;
    for (const b of breiten) {
      if (b.breite !== null) {
        await cdp.evaluate(`app.workspace.rightSplit.setSize ? app.workspace.rightSplit.setSize(${b.breite}) : null; const el = app.workspace.rightSplit.containerEl; if (el) el.style.width = ${q(`${b.breite}px`)}; return true;`);
        await sleep(600);
      }
      const geo = await cdp.evaluate<{ breite: number; aktionenH: number; primTop: number; sekTop: number; bodyTop: number; aktionenUnten: number; umbruch: boolean; bodyScroll: boolean }>(`
        const a = document.querySelector(".dmr-actions").getBoundingClientRect(); const p = document.querySelector(".dmr-primary").getBoundingClientRect();
        const s = document.querySelector(".dmr-secondary").getBoundingClientRect(); const bo = document.querySelector(".dmr-body");
        return { breite: Math.round(document.querySelector(".dmr-view").getBoundingClientRect().width), aktionenH: Math.round(a.height), primTop: Math.round(p.top), sekTop: Math.round(s.top),
          bodyTop: Math.round(bo.getBoundingClientRect().top), aktionenUnten: Math.round(a.bottom), umbruch: Math.round(s.top) > Math.round(p.top) + 4, bodyScroll: bo.scrollHeight > bo.clientHeight };
      `);
      if (b.breite !== null && geo.breite < 330) schmalErreicht = true;
      const ur = await messeErreichbarkeit(cdp, {
        selektoren: [".dmr-primary", ".dmr-secondary", ".dmr-status"],
        fuelle: { in: ".dmr-body", zeilen: 120 },
        erforderlich: [".dmr-primary", ".dmr-secondary", ".dmr-status"],
      });
      const unterhalb = geo.bodyTop >= geo.aktionenUnten - 1;
      lMessungen.push(`${b.name}: Ansicht ${geo.breite}px · Aktionszeile ${geo.aktionenH}px hoch${geo.umbruch ? " (Knöpfe umbrechen untereinander)" : " (Knöpfe nebeneinander)"} · Körper beginnt bei ${geo.bodyTop}px, Aktionszeile endet bei ${geo.aktionenUnten}px (darunter=${unterhalb}) · ${ur.urteil}: ${ur.detail}`);
      if (ur.urteil !== "gruen" || !unterhalb) lOk = false;
      if (b.breite !== null) await bild(cdp, `11-seitenleiste-${b.breite}`);
    }
    // Rollt der Körper darunter weg? Mit Füller auf Endposition scrollen, die Aktionszeile darf sich nicht bewegen.
    const scroll = await cdp.evaluate<{ vorher: number; nachher: number; scrollTop: number; max: number }>(`
      const bo = document.querySelector(".dmr-body"); const f = bo.createDiv({ cls: "smoke-fueller" });
      for (let i = 0; i < 150; i++) { const z = document.createElement("div"); z.textContent = "Fuellzeile " + i; f.appendChild(z); }
      const top = () => Math.round(document.querySelector(".dmr-actions").getBoundingClientRect().top);
      const vorher = top(); bo.scrollTop = bo.scrollHeight; const st = bo.scrollTop; const nachher = top();
      f.remove(); return { vorher, nachher, scrollTop: Math.round(st), max: Math.round(bo.scrollHeight) };
    `);
    lMessungen.push(`Körper gescrollt auf ${scroll.scrollTop}px: Aktionszeile oben ${scroll.vorher}→${scroll.nachher}px`);
    if (scroll.vorher !== scroll.nachher || scroll.scrollTop === 0) lOk = false;
    if (!schmalErreicht) lOk = false;
    // Breite zurück
    await cdp.evaluate(`const sp = app.workspace.rightSplit; const el = sp.containerEl; if (el) el.style.width = ${q(`${breiteVorher}px`)}; if (sp.setSize) sp.setSize(${breiteVorher}); return true;`);
    await sleep(500);
    const breiteNachher = await cdp.evaluate<number>(`return Math.round(app.workspace.rightSplit.containerEl.getBoundingClientRect().width);`);
    lMessungen.push(`Seitenleiste ${breiteVorher}px → zurückgestellt ${breiteNachher}px`);
    if (Math.abs(breiteNachher - breiteVorher) > 4) lOk = false;
    zeichneL(lOk, lMessungen, schmalErreicht);

    console.log("\nL2 · Gegenprobe");
    // Der Körper schiebt sich über die Aktionszeile (der Defekt, vor dem L schützt): die Probe MUSS rot werden.
    await cdp.evaluate(`const bo = document.querySelector(".dmr-body"); bo.style.cssText = "position:relative;z-index:5;margin-top:-90px;background:var(--background-primary);"; return true;`);
    await sleep(300);
    const gegen = await messeErreichbarkeit(cdp, { selektoren: [".dmr-primary", ".dmr-secondary"], fuelle: { in: ".dmr-body", zeilen: 120 }, erforderlich: [".dmr-primary", ".dmr-secondary"] });
    await bild(cdp, "12-gegenprobe-verdeckung");
    await cdp.evaluate(`const bo = document.querySelector(".dmr-body"); bo.style.cssText = ""; return true;`);
    await sleep(300);
    const wieder = await messeErreichbarkeit(cdp, { selektoren: [".dmr-primary", ".dmr-secondary"], fuelle: { in: ".dmr-body", zeilen: 120 }, erforderlich: [".dmr-primary", ".dmr-secondary"] });
    rec("L2", gegen.urteil === "rot" && wieder.urteil === "gruen", `mit überdeckendem Körper: ${gegen.urteil} (${gegen.detail}) · Mutation zurück: ${wieder.urteil}`);
    // Die Vorschau wartet weiter; den Plan ausführen, damit der Rest vom Normalzustand ausgeht.
    await fuehreAus(cdp);

    /* ── Große Quelle ──────────────────────────────────────────────────────────────────────────────────────────── */
    const grossPunkte = ["O2", "N0", "N", "O6", "M", "O5", "K2", "O3a", "O3b", "O7", "P", "O8"];
    if (ohneGross) {
      for (const p of grossPunkte) skip(p, "per Flag --ohne-gross abgewählt (kurzer Mutationslauf)");
    } else {
      await grossePhase();
    }

    /* ── Abschluss ─────────────────────────────────────────────────────────────────────────────────────────────── */
    async function grossePhase(): Promise<void> {
      const bigFiles = Array.from({ length: BIG_COUNT }, (_, i) => `bigrepo/docs/d${i % 30}/f${String(i).padStart(4, "0")}.md`);
      const zaehleGross = (liste: string[]): number => liste.filter((f) => f.startsWith("bigrepo/")).length;

      /* N0 */
      console.log("\nN0 · Startlauf aus");
      await setzeWurzel(cdp, port, BIG);
      await clearNotices(cdp);
      await cdp.evaluate(`
        window.__smoke.undo && window.__smoke.undo();
        await app.plugins.disablePlugin(${q(PLUGIN_ID)}); await app.plugins.enablePlugin(${q(PLUGIN_ID)});
        window.__smoke.sawRunning = false;
        const p = ${P}; window.__smoke.iv = setInterval(() => { if (p.running) window.__smoke.sawRunning = true; }, 50);
        return true;
      `);
      await sleep(4500);
      const n0 = await cdp.evaluate<{ gesehen: boolean; pending: boolean; syncOnStart: boolean }>(`clearInterval(window.__smoke.iv); return { gesehen: window.__smoke.sawRunning, pending: ${P}.runner.pending() !== null, syncOnStart: ${P}.settings.syncOnStart };`);
      const n0Notice = await notices(cdp);
      rec("N0", !n0.gesehen && !n0.pending && !n0.syncOnStart && n0Notice === "", `Schalter aus, Plugin neu geladen, 4,5 s beobachtet: Lauf gesehen=${n0.gesehen}, wartender Plan=${n0.pending}, Notice ${q(n0Notice)}`);

      /* N + O6 */
      console.log("\nN · Startlauf an");
      const ctxN = await oeffneTab(cdp, port);
      const klickN = await clickReal(ctxN.s, `(() => { const it = Array.from(document.querySelectorAll(".setting-item")).find((s) => ((s.querySelector(".setting-item-name") || {}).textContent || "").trim() === "Sync when the vault starts"); return it ? it.querySelector(".checkbox-container") : null; })()`);
      await sleep(600);
      await schliesseTab(cdp, ctxN);
      const sonN = await cdp.evaluate<boolean>(`return ${P}.settings.syncOnStart;`);
      await clearNotices(cdp);
      const messN = await cdp.evaluate<{ ladeMs: number; startMs: number | null; warteMs: number | null; ruckler: number; modal: boolean; notice: string; pending: boolean; status: string | null }>(`
        const w = window; const gaps = []; let last = performance.now(); let modal = false;
        const iv = setInterval(() => { const n = performance.now(); gaps.push(n - last); last = n; if (document.querySelector(".modal-container")) modal = true; }, 25);
        await app.plugins.disablePlugin(${q(PLUGIN_ID)});
        const t0 = performance.now(); await app.plugins.enablePlugin(${q(PLUGIN_ID)}); const ladeMs = performance.now() - t0;
        const p = ${P}; let startMs = null; let warteMs = null; let notice = "";
        while (performance.now() - t0 < 30000) {
          if (startMs === null && p.running) startMs = performance.now() - t0;
          const ns = Array.from(document.querySelectorAll(".notice")).map((n) => (n.textContent || "").trim()).join(" | ");
          if (ns) notice = ns;
          if (!p.running && p.runner.pending() !== null) { warteMs = performance.now() - t0; break; }
          await new Promise((r) => setTimeout(r, 20));
        }
        await new Promise((r) => setTimeout(r, 400));
        clearInterval(iv);
        return { ladeMs: Math.round(ladeMs), startMs: startMs === null ? null : Math.round(startMs), warteMs: warteMs === null ? null : Math.round(warteMs), ruckler: Math.round(Math.max(...gaps)), modal,
          notice: Array.from(document.querySelectorAll(".notice")).map((n) => (n.textContent || "").trim()).join(" | ") || notice, pending: p.runner.pending() !== null, status: null };
      `);
      await cdp.evaluate(`app.commands.executeCommandById("docs-mirror:open"); return true;`);
      await warteStatus(cdp, "Waiting for confirmation", 10000);
      const nAnsicht = await lese(cdp);
      rec("N", klickN && sonN && messN.pending && !messN.modal && /needs confirmation/.test(messN.notice) && nAnsicht.statusText === "Waiting for confirmation",
        `Schalter im Tab angeklickt (${klickN}) → syncOnStart=${sonN} · nach dem Neuladen: Modal gesehen=${messN.modal} · Notice ${q(messN.notice)} · wartender Plan=${messN.pending} · Ansicht ${q(nAnsicht.statusText)} (${nAnsicht.groups.map((gr) => gr.summary).join(", ")})`);
      await bild(cdp, "13-startlauf-wartet");
      rec("O6", messN.ladeMs < 1000 && messN.startMs !== null && messN.startMs >= 1800 && messN.ruckler < 500,
        `Plugin-Ladezeit (enablePlugin) ${messN.ladeMs} ms · Lauf beginnt nach ${messN.startMs} ms (STARTUP_DELAY_MS 2000) · Plan fertig nach ${messN.warteMs} ms (Quelle mit ${BIG_COUNT} Dateien) · größter Ruckler der Oberfläche (Takt 25 ms) ${messN.ruckler} ms`);
      await cdp.evaluate(`await ${P}.updateSettings({ syncOnStart: false }); return true;`);

      /* O2 */
      console.log("\nO2 · details und Scrollposition");
      const o2v = await lese(cdp);
      const neu = o2v.groups.find((gr) => /new file/.test(gr.summary));
      const kappung = neu?.rows.length ?? 0;
      await klick(cdp, `Array.from(document.querySelectorAll(".dmr-group summary")).find((s) => /new file/.test(s.textContent || ""))`);
      await sleep(300);
      const offen1 = await cdp.evaluate<{ open: boolean; sc: number; max: number; zeilen: number }>(`
        const d = Array.from(document.querySelectorAll(".dmr-group")).find((x) => /new file/.test(x.querySelector("summary").textContent || "")); const bo = document.querySelector(".dmr-body");
        bo.scrollTop = 600; return { open: d.open, sc: Math.round(bo.scrollTop), max: Math.round(bo.scrollHeight - bo.clientHeight), zeilen: d.querySelectorAll(".dmr-row").length };
      `);
      await sleep(200);
      await cdp.evaluate(`${P}.notify(); return true;`);
      await sleep(400);
      const nachNotify = await cdp.evaluate<{ open: boolean; sc: number; zeilen: number }>(`
        const d = Array.from(document.querySelectorAll(".dmr-group")).find((x) => /new file/.test(x.querySelector("summary").textContent || "")); const bo = document.querySelector(".dmr-body");
        return { open: d ? d.open : false, sc: Math.round(bo.scrollTop), zeilen: d ? d.querySelectorAll(".dmr-row").length : -1 };
      `);
      await bild(cdp, "14-vorschau-gross-aufgeklappt");
      await klick(cdp, `Array.from(document.querySelectorAll(".dmr-group summary")).find((s) => /new file/.test(s.textContent || ""))`);
      await sleep(300);
      await cdp.evaluate(`${P}.notify(); return true;`);
      await sleep(400);
      const zu = await cdp.evaluate<boolean>(`const d = Array.from(document.querySelectorAll(".dmr-group")).find((x) => /new file/.test(x.querySelector("summary").textContent || "")); return d ? d.open : true;`);
      // Die Löschgruppe war von Anfang an offen: zuklappen und neu aufbauen, sie bleibt zu.
      rec("O2", offen1.open && offen1.zeilen === 200 && offen1.sc >= 500 && nachNotify.open && Math.abs(nachNotify.sc - offen1.sc) <= 2 && zu === false,
        `Gruppe „neu“ ${q(neu?.summary)} (zunächst ${kappung} Zeilen sichtbar gekappt auf 200) per Klick aufgeklappt=${offen1.open}, ${offen1.zeilen} Zeilen · Körper auf ${offen1.sc}px (max ${offen1.max}) gerollt · nach notify(): offen=${nachNotify.open}, Scrollposition ${nachNotify.sc}px (Abweichung ${Math.abs(nachNotify.sc - offen1.sc)}px) · zugeklappt + notify(): offen=${zu}`);

      /* M, O5: Entladen mitten im Lauf */
      console.log("\nM · Entladen mitten im Lauf");
      const vorMVault = await vaultDateien(cdp);
      await klick(cdp, PRIMAER);
      const dM = await leseDialog(cdp);
      await klickeDialogKnopf(cdp, "Run plan");
      const laeuft = await warteBis(cdp, `(() => { const e = document.querySelector(".dmr-status-text"); const m = e && (e.textContent || "").match(/(\\d+) of (\\d+) files/); return m && Number(m[1]) >= 30; })()`, 30000, 40);
      const progressText = await cdp.evaluate<string | null>(`const e = document.querySelector(".dmr-status-text"); return e ? (e.textContent || "").trim() : null;`);
      await bild(cdp, "15-lauf-laeuft");
      await cdp.evaluate(`await app.plugins.disablePlugin(${q(PLUGIN_ID)}); return true;`);
      const z1 = zaehleGross(await vaultDateien(cdp));
      await sleep(700);
      const z2 = zaehleGross(await vaultDateien(cdp));
      await sleep(1500);
      const z3 = zaehleGross(await vaultDateien(cdp));
      const dateienM = await vaultDateien(cdp);
      const tmpM = await cdp.evaluate<string[]>(`const d = ${q(`.obsidian/plugins/${PLUGIN_ID}/tmp`)}; if (!(await app.vault.adapter.exists(d))) return []; return (await app.vault.adapter.list(d)).files;`);
      const halbe: string[] = [];
      for (const f of dateienM.filter((x) => x.startsWith("bigrepo/"))) {
        if ((await vaultLies(cdp, f)) !== text(join(BIG, f))) halbe.push(f);
      }
      const mkM = (await manifestSchluessel(cdp)).filter((k) => k.startsWith("bigrepo/"));
      const imVaultM = dateienM.filter((x) => x.startsWith("bigrepo/"));
      const lastM = await geraetWert(cdp, "last");
      const fpM = await geraetWert(cdp, "fingerprint");
      const stehtStill = z1 === z2 && z2 === z3;
      if (!laeuft || z3 >= BIG_COUNT) {
        unm("M", `Gegenstand nicht erreicht: der Lauf war nicht mitten im Gang (Fortschritt gesehen=${laeuft}, ${z3} von ${BIG_COUNT} Dateien nach dem Entladen)`);
        unm("O5", "wie M: kein Entladen mitten im Lauf");
      } else {
        rec("M", dM !== null && stehtStill && tmpM.length === 0 && halbe.length === 0 && z3 > 0 && z3 < BIG_COUNT,
          `Fortschritt beim Entladen ${q(progressText)} · geschriebene Dateien direkt danach ${z1}, +0,7 s ${z2}, +2,2 s ${z3} (Lauf endet=${stehtStill}) von ${BIG_COUNT} · Temp-Reste ${tmpM.length} ${q(tmpM)} · halbe/ungleiche Dateien ${halbe.length} ${q(halbe.slice(0, 3))}`);
        let mkPasst = mkM.length === imVaultM.length && mkM.every((k) => imVaultM.includes(k));
        let lastTxt = "";
        try { const l = JSON.parse(lastM ?? "") as { ok: boolean; counts: { created: number } }; lastTxt = `last: ok=${l.ok}, created=${l.counts.created}`; mkPasst = mkPasst && l.counts.created === imVaultM.length; } catch { lastTxt = "last nicht lesbar"; mkPasst = false; }
        rec("O5", mkPasst, `Manifest-Einträge unter bigrepo ${mkM.length} · Dateien im Vault ${imVaultM.length} (gleiche Menge=${mkM.length === imVaultM.length && mkM.every((k) => imVaultM.includes(k))}) · ${lastTxt} · gespeicherter Fingerabdruck wird beim Abbruch nicht gesetzt (Wert ${fpM === null ? "keiner" : "aus dem früheren Lauf"})`);
      }
      void vorMVault;
      // Plugin wieder an; die Ansicht neu öffnen.
      await cdp.evaluate(`await app.plugins.enablePlugin(${q(PLUGIN_ID)}); return true;`);
      await cdp.evaluate(`
        const w = window; const p = ${P}; const r = p.runner; const o = r.run.bind(r); w.__smoke.runs = 0;
        r.run = (...a) => { w.__smoke.runs += 1; return o(...a); };
        w.__smoke.undo = () => { r.run = o; };
        app.commands.executeCommandById("docs-mirror:open"); return true;
      `);
      await sleep(800);

      /* K2, O3, O7 in einem Lauf */
      console.log("\nK2/O3/O7 · Lauf mit Zeitreihe");
      await warteStatus(cdp, "Up to date", 5000);
      await klick(cdp, PRIMAER);
      const wartet2 = await warteStatus(cdp, "Waiting for confirmation", 40000);
      const vorLauf = zaehleGross(await vaultDateien(cdp));
      if (!wartet2) {
        for (const p of ["K2", "O3a", "O3b", "O7", "O8"]) unm(p, "Gegenstand nicht erreicht: der Plan wartete nicht auf Bestätigung");
        return;
      }
      await klick(cdp, PRIMAER);
      await leseDialog(cdp);
      await klickeDialogKnopf(cdp, "Run plan");
      const l1 = await warteBis(cdp, `(() => { const e = document.querySelector(".dmr-status-text"); const m = e && (e.textContent || "").match(/(\\d+) of (\\d+) files/); return m && Number(m[1]) >= 5; })()`, 30000, 40);
      // P: eine Quelldatei wird WÄHREND des Laufs gelöscht, eine andere verlängert. Beide stehen am Ende der Reihenfolge (d9, Pfad-Sortierung)
      // und sind jetzt, bei den ersten Dateien, noch nicht geschrieben: der Lauf trifft sie erst nach der Änderung.
      const P_WEG = "bigrepo/docs/d9/f3999.md"; const P_LANG = "bigrepo/docs/d9/f3849.md"; const P_DANACH = "bigrepo/docs/d9/f3969.md";
      const pOrigWeg = text(join(BIG, P_WEG)); const pOrigLang = text(join(BIG, P_LANG));
      const pStart = { laeuft: await cdp.evaluate<boolean>(`return ${P}.running;`), weg: await vaultExistiert(cdp, P_WEG), lang: await vaultExistiert(cdp, P_LANG) };
      rmSync(join(BIG, P_WEG));
      writeFileSync(join(BIG, P_LANG), `${pOrigLang}\nWährend des Laufs verlängert.\n`);
      const lauf1m = await cdp.evaluate<{ animationName: string | null; anim: number; zeit: number | null; spielt: string | null; kl: string | null; aria: string | null; text: string | null; primaer: string | null; sek: boolean | null; trans: string | null }>(`
        const svg = document.querySelector(".dmr-status-icon svg"); window.__smoke.svg1 = svg; if (svg) svg.__smokeMarke = 1;
        const a = document.getAnimations().filter((x) => x.animationName === "dmr-spin");
        window.__smoke.t1 = a[0] ? a[0].currentTime : null; window.__smoke.stamp1 = performance.now();
        return { animationName: svg ? getComputedStyle(svg).animationName : null, anim: a.length, zeit: a[0] ? Number(a[0].currentTime) : null, spielt: a[0] ? a[0].playState : null, kl: document.querySelector(".dmr-status").className,
          aria: document.querySelector(".dmr-status").getAttribute("aria-label"), text: (document.querySelector(".dmr-status-text").textContent || "").trim(),
          primaer: document.querySelector(".dmr-primary").textContent, sek: document.querySelector(".dmr-secondary").classList.contains("dmr-hidden"), trans: svg ? getComputedStyle(svg).transform : null };
      `);
      await bild(cdp, "16-lauf-laeuft-2");
      // O10 während des Laufs: ein weiterer Auslöser.
      await clearNotices(cdp);
      await cdp.evaluate(`app.commands.executeCommandById("docs-mirror:sync-now"); return true;`);
      await sleep(150);
      const nWaehrend = await notices(cdp);
      await sleep(500);
      const lauf2m = await cdp.evaluate<{ gleich: boolean; zeit: number | null; verstrichen: number; trans: string | null; text: string | null; spielt: string | null }>(`
        const svg = document.querySelector(".dmr-status-icon svg"); const a = document.getAnimations().filter((x) => x.animationName === "dmr-spin");
        return { gleich: svg === window.__smoke.svg1 && Boolean(svg && svg.__smokeMarke === 1), zeit: a[0] ? Number(a[0].currentTime) : null, verstrichen: performance.now() - window.__smoke.stamp1, trans: svg ? getComputedStyle(svg).transform : null,
          text: (document.querySelector(".dmr-status-text").textContent || "").trim(), spielt: a[0] ? a[0].playState : null };
      `);
      // Zwei Proben im Abstand von 230 ms (die Periode ist 1 s: zwei Proben genau eine Periode auseinander sähen gleich aus).
      const dreh1 = await cdp.evaluate<string | null>(`const svg = document.querySelector(".dmr-status-icon svg"); return svg ? getComputedStyle(svg).transform : null;`);
      await sleep(230);
      const dreh2 = await cdp.evaluate<string | null>(`const svg = document.querySelector(".dmr-status-icon svg"); return svg ? getComputedStyle(svg).transform : null;`);
      const nochA = await cdp.evaluate<boolean>(`return ${P}.running;`);
      const t1 = lauf1m.zeit ?? -1; const t2 = lauf2m.zeit ?? -1;
      recL(nochA, "K2", l1 && lauf1m.animationName === "dmr-spin" && lauf1m.anim >= 1 && lauf1m.spielt === "running" && /is-checking/.test(lauf1m.kl ?? "") && lauf1m.aria === `Status: ${lauf1m.text?.split(" · ")[0]}` && lauf1m.primaer === "Cancel" && lauf1m.sek === true && dreh1 !== null && dreh1 !== dreh2,
        `Status ${q(lauf1m.text)} (Klasse ${q(lauf1m.kl)}, aria ${q(lauf1m.aria)}) · animationName=${q(lauf1m.animationName)} · Animationen dmr-spin ${lauf1m.anim}, Zustand ${q(lauf1m.spielt)} · Drehung im Abstand von 230 ms ${q(dreh1)} → ${q(dreh2)} · Primärknopf ${q(lauf1m.primaer)}, Sekundärknopf versteckt=${lauf1m.sek}`);
      recL(nochA, "O3a", lauf2m.gleich && t2 > t1 && t1 >= 0 && lauf2m.spielt === "running" && Math.abs((t2 - t1) - lauf2m.verstrichen) < 250,
        `nach ${Math.round(lauf2m.verstrichen)} ms und etlichen Fortschritts-Neuaufbauten: gleiches svg-Element=${lauf2m.gleich} · Animations-Uhr ${Math.round(t1)}→${Math.round(t2)} ms (Zuwachs ${Math.round(t2 - t1)} ms, erwartet ~${Math.round(lauf2m.verstrichen)}) · Status danach ${q(lauf2m.text)} · „läuft bereits“ bei weiterem Befehl: ${q(nWaehrend)}`);
      // O3b: prefers-reduced-motion
      await cdp.send("Emulation.setEmulatedMedia", { features: [{ name: "prefers-reduced-motion", value: "reduce" }] });
      await sleep(300);
      const reduziert = await cdp.evaluate<{ animationName: string | null; anim: number; media: boolean }>(`
        const svg = document.querySelector(".dmr-status-icon svg"); return { animationName: svg ? getComputedStyle(svg).animationName : null, anim: document.getAnimations().filter((x) => x.animationName === "dmr-spin").length, media: window.matchMedia("(prefers-reduced-motion: reduce)").matches };
      `);
      const nochB = await cdp.evaluate<boolean>(`return ${P}.running;`);
      await cdp.send("Emulation.setEmulatedMedia", { features: [] });
      await sleep(300);
      const normal = await cdp.evaluate<{ animationName: string | null; media: boolean }>(`const svg = document.querySelector(".dmr-status-icon svg"); return { animationName: svg ? getComputedStyle(svg).animationName : null, media: window.matchMedia("(prefers-reduced-motion: reduce)").matches };`);
      recL(nochB, "O3b", reduziert.media && reduziert.animationName === "none" && reduziert.anim === 0 && !normal.media && normal.animationName === "dmr-spin",
        `reduce: media=${reduziert.media}, animationName=${q(reduziert.animationName)}, laufende Animationen ${reduziert.anim} · zurück: media=${normal.media}, animationName=${q(normal.animationName)}`);

      // O7: Wurzel MITTEN im Lauf wechseln; der Lauf muss den alten Baum zu Ende lesen.
      await cdp.evaluate(`${P}.setRoot(${q(SOLO)}); return true;`);
      const mitten = await cdp.evaluate<{ root: string; running: boolean }>(`return { root: ${P}.root, running: ${P}.running };`);
      const fertig7 = await warteBis(cdp, `(() => { const e = document.querySelector(".dmr-status-text"); const t = e ? (e.textContent || "").trim() : ""; return t.startsWith("Up to date") || t.startsWith("Error"); })()`, 90000, 100);
      await sleep(600);
      const nach7 = await vaultDateien(cdp);
      const ans7 = await lese(cdp);
      const grossN = zaehleGross(nach7);
      recL(mitten.running, "O7", mitten.running && mitten.root === SOLO && fertig7 && grossN === BIG_COUNT - 2 && !nach7.includes("solo/docs/only.md"),
        `Wurzel mitten im Lauf gewechselt (Lauf läuft=${mitten.running}, Wurzel ${mitten.root === SOLO ? "= solo" : q(mitten.root)}) · danach ${grossN} von ${BIG_COUNT} Dateien aus dem alten Baum (zwei von P bewusst gestört; vorher ${vorLauf}), Datei der neuen Wurzel im Vault=${nach7.includes("solo/docs/only.md")} · Zähler ${q(ans7.counters)}`);

      console.log("\nP · Quelle ändert sich während des Laufs");
      const mkP = await manifestSchluessel(cdp);
      const pNachher = { weg: nach7.includes(P_WEG), lang: nach7.includes(P_LANG), danach: nach7.includes(P_DANACH) };
      const pMan = { weg: mkP.includes(P_WEG), lang: mkP.includes(P_LANG), danach: mkP.includes(P_DANACH), gross: mkP.filter((k) => k.startsWith("bigrepo/")).length };
      recL(pStart.laeuft && !pStart.weg && !pStart.lang, "P",
        fertig7 && ans7.counters["Errors"] === 2 && ans7.statusText === "Error" && (ans7.error ?? "").startsWith("Sync finished with errors") &&
        !pNachher.weg && !pNachher.lang && !pMan.weg && !pMan.lang && pNachher.danach && pMan.danach && pMan.gross === BIG_COUNT - 2,
        `beim Eingriff: Lauf läuft=${pStart.laeuft}, die beiden Dateien noch nicht im Vault (gelöscht ${!pStart.weg}, verlängert ${!pStart.lang}) · danach: Status ${q(ans7.statusText)}, Fehlerzeile ${q(ans7.error)}, Zähler Errors=${ans7.counters["Errors"]}, Created=${ans7.counters["New"]} · gelöschte Datei im Vault=${pNachher.weg}, im Manifest=${pMan.weg} · verlängerte Datei im Vault=${pNachher.lang}, im Manifest=${pMan.lang} · eine spätere Datei (${P_DANACH}) im Vault=${pNachher.danach}, im Manifest=${pMan.danach} · Manifest-Einträge unter bigrepo ${pMan.gross} von ${BIG_COUNT - 2} erwartet`);
      // Quelle wiederherstellen (das nächste --setup baut sie ohnehin neu).
      writeFileSync(join(BIG, P_WEG), pOrigWeg);
      writeFileSync(join(BIG, P_LANG), pOrigLang);

      /* O8 */
      console.log("\nO8 · Wurzelwechsel in der Wartephase");
      const vorO8 = await vaultDateien(cdp);
      await klick(cdp, PRIMAER); // Wurzel ist solo, Manifest trägt die große Quelle: viele Löschungen
      const wartet8 = await warteStatus(cdp, "Waiting for confirmation", 40000);
      const o8a = await lese(cdp);
      await bild(cdp, "17-vorschau-viele-loeschungen");
      const loeschGruppe = o8a.groups.find((gr) => /to delete/.test(gr.summary));
      await setzeWurzel(cdp, port, MAIN); // ändert die Wurzel, während der Plan für solo wartet
      await klick(cdp, PRIMAER); // „Run plan“ mit dem veralteten Plan
      const dO8 = await leseDialog(cdp);
      await klickeDialogKnopf(cdp, "Run plan");
      const wieder8 = await warteStatus(cdp, "Waiting for confirmation", 40000);
      await sleep(500);
      const o8b = await lese(cdp);
      const nachO8 = await vaultDateien(cdp);
      rec("O8", wartet8 && (loeschGruppe?.summary ?? "").endsWith("files to delete") && o8a.reasons.some((r) => /threshold/.test(r)) && dO8 !== null && wieder8 && o8b.reasons.some((r) => /^Settings changed/.test(r)) && JSON.stringify(vorO8) === JSON.stringify(nachO8) && o8b.statusText === "Waiting for confirmation",
        `Plan für solo: ${q(loeschGruppe?.summary)}, Gründe ${q(o8a.reasons)} · Wurzel im Warten auf MAIN gewechselt, „Run plan“ bestätigt (Dialog ${q(dO8?.title)}) → Status ${q(o8b.statusText)}, neue Gründe ${q(o8b.reasons)}, Gruppen ${q(o8b.groups.map((gr) => gr.summary))} · Vault vorher ${vorO8.length} / nachher ${nachO8.length} Dateien, gleich=${JSON.stringify(vorO8) === JSON.stringify(nachO8)}`);
      await bild(cdp, "18-nach-wurzelwechsel");
      void bigFiles;
    }

    await cdp.evaluate(`window.__smoke && window.__smoke.undo && window.__smoke.undo(); return true;`);
    await schliesseEinstellungen(cdp).catch(() => undefined);
  } finally {
    await zustand.schliesse();
    if (istAbgebrochen()) return;
    cdp.close();
  }

  for (const w of warnungen) console.log(`  ⚠ ${w}`);
  bilanz.abschluss();

  function zeichneL(ok: boolean, teile: string[], schmal: boolean): void {
    rec("L", ok, `${teile.join(" ‖ ")}${schmal ? "" : " ‖ SCHMALE BREITE NICHT ERREICHT (Seitenleiste ließ sich nicht unter 330px stellen): die schmale Probe ist ungültig"}`);
  }
}

void zeichnePflicht;
void gegenprobeErreichbarkeit;
void readdirSync;

runDriver(main);
