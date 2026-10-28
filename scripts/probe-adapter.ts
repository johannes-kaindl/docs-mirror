/**
 * Adapter-Messung (Task 10, Step 1) — misst am LAUFENDEN Obsidian, wie `app.vault.adapter` sich bei den Schreib-
 * operationen verhält, auf die `createVaultPort` und die Schreibfolge aus `src/core/apply.ts` bauen.
 * Braucht das Plugin nicht (die Aufrufe gehen direkt an den Adapter). Schreibt nur unter `dmr-probe/` und
 * `.obsidian/plugins/dmr-probe/` des Staging-Vaults und räumt beides am Ende weg.
 *
 * ## Zweitinstanz (eigenes Profil, eigener Port — NICHT die reguläre Instanz anfassen; `--port` ist Pflicht)
 *
 *   UD=/tmp/obs-test-docs-mirror; mkdir -p "$UD"; mkdir -p "$STAGING_VAULTS_DIR/docs-mirror/.obsidian"
 *   lsof -nP -iTCP:9391 -sTCP:LISTEN && echo "Port belegt"
 *   node -e 'const p=process.env.STAGING_VAULTS_DIR+"/docs-mirror";require("fs").writeFileSync(process.argv[1]+"/obsidian.json",JSON.stringify({vaults:{"docs-mirror":{path:p,ts:Date.now(),open:true}},language:"en"}))' "$UD"
 *   cp ~/Library/Application\ Support/obsidian/obsidian-*.asar "$UD"/
 *   /Applications/Obsidian.app/Contents/MacOS/Obsidian --user-data-dir="$UD" --remote-debugging-port=9391 &
 *   python3 ~/.claude/hooks/obsidian-cdp-lock.py acquire --label docs-mirror --intent "Adapter-Messung" --exclusive focus --port 9391 --ttl 900
 *   npm run probe:adapter -- --port 9391
 *   python3 ~/.claude/hooks/obsidian-cdp-lock.py release --port 9391
 *
 * Ausgabe: je Frage „gemessen / nicht gemessen“ mit Rohbefund (genaue Fehlermeldungen).
 */
import { parseArgs, runDriver } from "../../tools/obsidian-cdp/bilanz.js";
import { attachTo, bereiteInstanzVor, requireVisible } from "../../tools/obsidian-cdp/cdp.js";

const REPO_NAME = "docs-mirror";

/** Läuft im Renderer. Gibt eine Liste { id, frage, status, roh } zurück. */
const PROBE = `
const a = app.vault.adapter;
const cfg = app.vault.configDir;
const PD = cfg + "/plugins/dmr-probe";
const D = "dmr-probe";
const out = [];
const rec = (id, frage, status, roh) => out.push({ id, frage, status, roh });
const err = (e) => (e && e.message) ? String(e.message) : String(e);
const enc = (s) => new TextEncoder().encode(s).buffer;
const dec = (b) => new TextDecoder().decode(b);
const tryit = async (f) => { try { return { ok: true, v: await f() }; } catch (e) { return { ok: false, e: err(e) }; } };
const cleanup = async () => {
  await tryit(() => a.rmdir(D, true));
  await tryit(() => a.rmdir(PD, true));
};
await cleanup();
await a.mkdir(PD);
await a.mkdir(D);

// (1) read/readBinary/remove im Plugin-Ordner
{
  await a.writeBinary(PD + "/t1.tmp", enc("hallo"));
  const r1 = await tryit(() => a.read(PD + "/t1.tmp"));
  const r2 = await tryit(async () => dec(await a.readBinary(PD + "/t1.tmp")));
  const s = await tryit(() => a.stat(PD + "/t1.tmp"));
  const rm = await tryit(() => a.remove(PD + "/t1.tmp"));
  const ex = await tryit(() => a.exists(PD + "/t1.tmp"));
  rec("1", "read/readBinary/stat/remove einer Datei im Plugin-Ordner", (r1.ok && r2.ok && s.ok && rm.ok && ex.ok && ex.v === false) ? "gemessen" : "gemessen (Abweichung)", JSON.stringify({ read: r1, readBinary: r2, stat: s, remove: rm, existsNach: ex }));
}

// (4)+(8) writeBinary mtime, Auflösung
{
  const want = 1700000000123;
  await a.writeBinary(D + "/m.bin", enc("x"), { mtime: want });
  const s = await a.stat(D + "/m.bin");
  const want2 = 1700000000000;
  await a.writeBinary(D + "/m2.bin", enc("x"), { mtime: want2 });
  const s2 = await a.stat(D + "/m2.bin");
  const want3 = 1700000000999;
  await a.writeBinary(D + "/m3.bin", enc("x"), { mtime: want3 });
  const s3 = await a.stat(D + "/m3.bin");
  const wantOld = 946684800000;
  await a.writeBinary(D + "/m4.bin", enc("x"), { mtime: wantOld });
  const s4 = await a.stat(D + "/m4.bin");
  rec("4", "writeBinary(path, buf, { mtime }) honoriert mtime", s.mtime === want ? "gemessen: ja" : "gemessen: NEIN", JSON.stringify({ want, got: s.mtime, want2, got2: s2.mtime, want3, got3: s3.mtime, wantOld, gotOld: s4.mtime }));
  rec("8", "mtime-Auflösung nach writeBinary (ms oder s)", "gemessen", JSON.stringify({ ms123: s.mtime === want, sub: [s.mtime, s2.mtime, s3.mtime], ctime: s.ctime }));
}

// (2) rename Plugin-Ordner -> Vault-Pfad: neues Ziel, Elternordner fehlt, bestehendes Ziel
{
  await a.writeBinary(PD + "/r1.tmp", enc("r1"), { mtime: 1700000001000 });
  const noParent = await tryit(() => a.rename(PD + "/r1.tmp", D + "/neu/sub/r1.md"));
  const parentExists = await tryit(() => a.exists(D + "/neu"));
  const stillThere = await tryit(() => a.exists(PD + "/r1.tmp"));
  await a.mkdir(D + "/neu2");
  const withParent = await tryit(() => a.rename(PD + "/r1.tmp", D + "/neu2/r1.md"));
  const st = await tryit(() => a.stat(D + "/neu2/r1.md"));
  const content = await tryit(async () => dec(await a.readBinary(D + "/neu2/r1.md")));
  rec("2a", "rename Plugin-Ordner -> Vault, Elternordner fehlt (mkdirp nötig?)", noParent.ok ? "gemessen: legt Eltern an" : "gemessen: wirft -> mkdirp nötig", JSON.stringify({ noParent, elternDanach: parentExists, quelleNochDa: stillThere }));
  rec("2b", "rename Plugin-Ordner -> Vault, Elternordner da", withParent.ok ? "gemessen: ok" : "gemessen: wirft", JSON.stringify({ withParent, stat: st, content }));

  // (3) stat direkt nach rename: oben bereits stat nach rename, nochmal frisch mit mtime
  await a.writeBinary(PD + "/r3.tmp", enc("r3"), { mtime: 1700000003000 });
  await a.rename(PD + "/r3.tmp", D + "/neu2/r3.md");
  const st3 = await tryit(() => a.stat(D + "/neu2/r3.md"));
  const lst = await tryit(() => a.list(D + "/neu2"));
  const tf = app.vault.getAbstractFileByPath(D + "/neu2/r3.md");
  rec("3", "stat(target) direkt nach rename: sofort da, welche mtime", st3.ok && st3.v ? "gemessen" : "gemessen: NICHT da", JSON.stringify({ want: 1700000003000, stat: st3, list: lst, tfileSofort: tf ? { mtime: tf.stat.mtime, size: tf.stat.size } : null }));

  // (2c) rename auf existierendes Ziel
  await a.writeBinary(PD + "/r4.tmp", enc("neu-inhalt"), { mtime: 1700000004000 });
  const exist = await tryit(() => a.rename(PD + "/r4.tmp", D + "/neu2/r3.md"));
  const after = await tryit(async () => dec(await a.readBinary(D + "/neu2/r3.md")));
  rec("2c", "rename auf bestehendes Ziel wirft", exist.ok ? "gemessen: wirft NICHT (überschreibt?)" : "gemessen: wirft", JSON.stringify({ rename: exist, zielInhaltDanach: after }));
  await tryit(() => a.remove(PD + "/r4.tmp"));

  // (d) remove + rename -> Inhalt und Zeit
  await a.writeBinary(D + "/neu2/d.md", enc("alt"), { mtime: 1600000000000 });
  await a.writeBinary(PD + "/d.tmp", enc("neuer"), { mtime: 1700000005000 });
  const rm = await tryit(() => a.remove(D + "/neu2/d.md"));
  const rn = await tryit(() => a.rename(PD + "/d.tmp", D + "/neu2/d.md"));
  const ds = await tryit(() => a.stat(D + "/neu2/d.md"));
  const dc = await tryit(async () => dec(await a.readBinary(D + "/neu2/d.md")));
  rec("d", "remove + rename ergibt Zielinhalt und -zeit wie erwartet", (rm.ok && rn.ok && dc.v === "neuer" && ds.v && ds.v.mtime === 1700000005000) ? "gemessen: ja" : "gemessen: Abweichung", JSON.stringify({ remove: rm, rename: rn, stat: ds, content: dc, wantMtime: 1700000005000 }));
}

// (5) adapter.list nennt configDir-Dateien
{
  const root = await tryit(() => a.list(""));
  const cfgList = await tryit(() => a.list(cfg));
  const tree = [];
  const walk = async (dir, depth) => { const l = await a.list(dir); for (const f of l.files) tree.push(f); if (depth < 6) for (const d of l.folders) await walk(d, depth + 1); };
  await walk("", 0);
  const inCfg = tree.filter((f) => f.startsWith(cfg + "/"));
  rec("5", "adapter.list nennt Dateien in configDir", inCfg.length > 0 ? "gemessen: ja (Port muss filtern)" : "gemessen: nein", JSON.stringify({ configDir: cfg, rootFolders: root.ok ? root.v.folders : root, cfgListFiles: cfgList.ok ? cfgList.v.files.slice(0, 5) : cfgList, rekursivInCfg: inCfg.slice(0, 5), pluginTmpDrin: tree.filter((f) => f.includes("dmr-probe")).slice(0, 5) }));
}

// (6) Groß-/Kleinschreibung und NFD
{
  const nfc = "caf\\u00e9.md";
  const nfd = "cafe\\u0301.md";
  await a.writeBinary(D + "/" + nfc, enc("nfc"));
  const lst = await a.list(D);
  const names = lst.files.map((f) => f.slice(D.length + 1));
  const ex_nfd = await tryit(() => a.exists(D + "/" + nfd));
  const st_nfd = await tryit(() => a.stat(D + "/" + nfd));
  const rd_nfd = await tryit(() => a.read(D + "/" + nfd));
  await a.writeBinary(D + "/Gross.md", enc("g"));
  const ex_lc = await tryit(() => a.exists(D + "/gross.md"));
  const st_lc = await tryit(() => a.stat(D + "/gross.md"));
  const rd_lc = await tryit(() => a.read(D + "/gross.md"));
  const lst2 = (await a.list(D)).files.map((f) => f.slice(D.length + 1));
  const cp = (s) => Array.from(s).map((c) => c.codePointAt(0).toString(16)).join(" ");
  rec("6", "stat/exists mit anderer Schreibweise (Groß/Klein, NFD) trifft dieselbe Datei", "gemessen", JSON.stringify({
    nfcAngelegt: cp(nfc), listNennt: names.filter((n) => n.startsWith("caf")).map(cp),
    nfdExists: ex_nfd, nfdStat: st_nfd, nfdRead: rd_nfd,
    gross: "Gross.md", lcExists: ex_lc, lcStat: st_lc, lcRead: rd_lc, listNachCase: lst2.filter((n) => /gross/i.test(n)),
  }));
}

// (7) remove/rename/rmdir auf Ordner, mit Zustand nach jedem Schritt
{
  const state = async (label) => ({ label, ordner: await a.exists(D + "/ord"), datei: await a.exists(D + "/ord/f.md"), ord2: await a.exists(D + "/ord2") });
  const steps = [];
  await a.mkdir(D + "/ord");
  await a.writeBinary(D + "/ord/f.md", enc("f"));
  steps.push(await state("angelegt"));
  const rmdirNonEmpty = await tryit(() => a.rmdir(D + "/ord", false));
  steps.push(await state("nach rmdir(ord,false) auf nicht leeren Ordner"));
  await tryit(() => a.mkdir(D + "/ord"));
  await tryit(() => a.writeBinary(D + "/ord/f.md", enc("f")));
  const rmFolder = await tryit(() => a.remove(D + "/ord"));
  steps.push(await state("nach remove(ord) auf nicht leeren Ordner"));
  await tryit(() => a.mkdir(D + "/ord"));
  await tryit(() => a.writeBinary(D + "/ord/f.md", enc("f")));
  const rnFolder = await tryit(() => a.rename(D + "/ord", D + "/ord2"));
  steps.push(await state("nach rename(ord,ord2) nicht leer"));
  await tryit(() => a.rmdir(D + "/ord2", true));
  await tryit(() => a.mkdir(D + "/ord"));
  const rmdirEmpty = await tryit(() => a.rmdir(D + "/ord", false));
  steps.push(await state("nach rmdir(ord,false) auf leeren Ordner"));
  await a.mkdir(D + "/ord3");
  const rnEmpty = await tryit(() => a.rename(D + "/ord3", D + "/ord4"));
  rec("7", "remove/rename auf ORDNER; rmdir(path,false) auf nicht leeren/leeren Ordner", "gemessen", JSON.stringify({ rmdirNonEmpty, removeOnFolder: rmFolder, renameFolderNonEmpty: rnFolder, rmdirEmpty, renameEmptyFolder: rnEmpty, steps }));
}

// (9) Zusatz: writeBinary in fehlenden Elternordner, mkdir auf vorhandenen, remove auf fehlende Datei, stat auf fehlende
{
  const wNoParent = await tryit(() => a.writeBinary(D + "/nope/x.bin", enc("x")));
  const mkExisting = await tryit(() => a.mkdir(D));
  const mkDeep = await tryit(() => a.mkdir(D + "/deep/a/b"));
  const rmMissing = await tryit(() => a.remove(D + "/gibtsnicht.md"));
  const stMissing = await tryit(() => a.stat(D + "/gibtsnicht.md"));
  const rdMissing = await tryit(() => a.readBinary(D + "/gibtsnicht.md"));
  rec("9", "Zusatz: writeBinary ohne Elternordner, mkdir vorhanden/tief, remove/stat/read fehlend", "gemessen", JSON.stringify({ writeNoParent: wNoParent, mkdirExisting: mkExisting, mkdirDeep: mkDeep, removeMissing: rmMissing, statMissing: stMissing, readMissing: rdMissing }));
}

// (10) Zusatz: Dateien im Plugin-Ordner im Vault-Index? (getAbstractFileByPath), clearTemp-Muster per list+remove
{
  await a.writeBinary(PD + "/.dmr-tmp-0", enc("t"));
  const lst = await tryit(() => a.list(PD));
  const tf = app.vault.getAbstractFileByPath(PD + "/.dmr-tmp-0");
  const hidden = await tryit(() => a.exists(PD + "/.dmr-tmp-0"));
  rec("10", "Zusatz: Punkt-Datei im Plugin-Ordner: list nennt sie, Vault-Index kennt sie nicht", "gemessen", JSON.stringify({ list: lst, existsDotfile: hidden, inVaultIndex: !!tf }));
}

await cleanup();
const rest = await tryit(() => a.exists(D));
rec("end", "Aufräumen", rest.ok && rest.v === false ? "gemessen: sauber" : "gemessen: Reste", JSON.stringify(rest));
return out;
`;

interface Befund { id: string; frage: string; status: string; roh: string }

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const portArg = args.value("port");
  if (!portArg || !Number.isInteger(Number(portArg))) throw new Error("--port <Port> ist Pflicht (Zweitinstanz, z. B. --port 9391) — kein Standardport.");
  const port = Number(portArg);
  if (port === 9222) throw new Error("Port 9222 ist die reguläre Instanz — nie anfassen. Zweitinstanz verwenden.");

  const cdp = await attachTo("workspace", port, REPO_NAME);
  if (!cdp) throw new Error(`Kein Obsidian-Hauptfenster auf Port ${port} für Vault „${REPO_NAME}“.`);
  try {
    await requireVisible(cdp);
    await bereiteInstanzVor(cdp, { pluginIds: [], nurVault: REPO_NAME, sprache: "en" });
    const title = await cdp.evaluate<string>(`return document.title;`);
    console.log(`Fenster: ${title}`);
    const befunde = await cdp.evaluate<Befund[]>(PROBE);
    for (const b of befunde) console.log(`\n[${b.id}] ${b.frage}\n  -> ${b.status}\n  ${b.roh}`);
  } finally {
    cdp.close();
  }
}

runDriver(main);
