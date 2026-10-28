import { createCooperativeYield, type NowPort } from "../vendor/kit/cooperative-yield";
import { sha256Hex } from "../vendor/kit/sha256";
import type { Manifest, ManifestEntry } from "./manifest";
import type { Plan, PlanItem, VaultPort } from "./plan";
import type { RunCounts } from "./run-info";

export interface ApplyIo {
  vault: VaultPort;
  /** Liest eine Quelldatei (Pfad wie in `PlanItem.path`); wirft, wenn sie fehlt. */
  readSource(path: string): Promise<Uint8Array>;
  yieldToUi: () => Promise<void>;
  signal: AbortSignal;
  onProgress(done: number, total: number): void;
  saveManifest(m: Manifest): Promise<void>;
}

export interface ApplyOptions {
  /** Konflikte mit Inhaltsabweichung, die überschrieben werden dürfen (Pfad im Plan) oder alle. */
  overwrite: ReadonlySet<string> | "all";
  /** Das Manifest wird nach jeweils so vielen erledigten Einträgen zwischengespeichert. */
  saveEvery: number;
  /** Schrittweite des kooperativen Zeittors (Standard 250 ms); `0` = jede Runde. */
  yieldEveryMs?: number;
  clock?: NowPort;
}

export interface ApplyResult {
  manifest: Manifest;
  counts: RunCounts;
  aborted: boolean;
  errors: { path: string; message: string }[];
}

const message = (e: unknown): string => (e instanceof Error ? e.message : String(e));
const parentOf = (p: string): string => p.split("/").slice(0, -1).join("/");
const sameBytes = (a: Uint8Array, b: Uint8Array): boolean => a.byteLength === b.byteLength && sha256Hex(a) === sha256Hex(b);

/** Führt einen Plan aus. Zuerst alle Löschungen, dann alle Schreibungen (eine Case-Umbenennung darf eine frisch
 *  geschriebene Datei nicht löschen). Jede Datei: Eltern anlegen, Temp-Datei schreiben, Temp gegen die gelesenen Bytes
 *  prüfen, bei bestehendem Ziel `remove`, dann `replace`. Ausfallmodus ist „Datei fehlt“, nie „Datei halb“.
 *  Löscht nur, was im Manifest steht; `vault-only` und nicht überschreibbare Konflikte (Groß-/Kleinschreibung,
 *  Typwechsel) fasst es nie an. Am Ende (auch nach Abbruch) wird das Teil-Manifest gespeichert. */
export async function applyPlan(plan: Plan, manifest: Manifest, io: ApplyIo, opts: ApplyOptions): Promise<ApplyResult> {
  const next: Manifest = { ...manifest };
  const counts: RunCounts = {
    created: 0, updated: 0, unchanged: 0, deleted: 0, overwritten: 0,
    skipped: plan.skipped.symlinks + plan.skipped.tooBig + plan.skipped.otherType, errors: 0,
  };
  const errors: { path: string; message: string }[] = [];
  const fail = (path: string, e: unknown): void => {
    errors.push({ path, message: message(e) });
    counts.errors++;
  };

  try {
    await io.vault.clearTemp();
  } catch (e) {
    fail("", e);
  }

  for (const p of plan.forget) delete next[p];
  for (const it of plan.items) {
    if (it.cls === "unchanged" && it.entry) {
      next[it.path] = it.entry;
      counts.unchanged++;
    } else if (it.cls === "unchanged") counts.unchanged++;
  }

  const mayOverwrite = (it: PlanItem): boolean =>
    it.cls === "conflict" && it.src !== undefined && it.reason === undefined &&
    (opts.overwrite === "all" || opts.overwrite.has(it.path));
  const deletes = plan.items.filter((it) => it.cls === "delete");
  const writes = plan.items.filter((it) => {
    if (!it.src) return false;
    return it.cls === "new" || it.cls === "changed" || it.cls === "vault-modified" || it.cls === "conflict";
  });
  const work = [...deletes, ...writes];
  const total = work.length;

  let tempSeq = 0;
  const removeTemp = async (name: string): Promise<void> => {
    try { await io.vault.remove(name); } catch { /* best effort; clearTemp des nächsten Laufs räumt auf */ }
  };

  async function deleteOne(it: PlanItem): Promise<void> {
    // Nur Dateien aus dem Manifest dürfen gehen.
    if (!next[it.path]) { counts.skipped++; return; }
    const target = it.vaultPath ?? it.path;
    try {
      await io.vault.remove(target);
    } catch (e) {
      fail(it.path, e);
      return;
    }
    delete next[it.path];
    counts.deleted++;
    // Leere Ordner von innen nach außen; removeIfEmpty lässt Ordner mit Inhalt stehen.
    try {
      let dir = parentOf(target);
      while (dir !== "") {
        await io.vault.removeIfEmpty(dir);
        dir = parentOf(dir);
      }
    } catch (e) {
      fail(it.path, e);
    }
  }

  async function writeOne(it: PlanItem): Promise<void> {
    const src = it.src;
    if (!src) return;
    if (it.cls === "conflict" && !mayOverwrite(it)) { counts.skipped++; return; }
    let bytes: Uint8Array;
    try {
      bytes = await io.readSource(it.path);
    } catch (e) {
      fail(it.path, e);
      return;
    }
    if (bytes.byteLength !== src.size) {
      fail(it.path, new Error(`source changed during the run: ${bytes.byteLength} bytes read, ${src.size} scanned`));
      return;
    }
    const hash = sha256Hex(bytes);
    const target = it.vaultPath ?? it.path;
    const exists = it.vaultPath !== undefined;
    const temp = `.dmr-tmp-${tempSeq++}`;
    try {
      const dir = parentOf(target);
      if (dir !== "") await io.vault.mkdirp(dir);
      await io.vault.writeTemp(temp, bytes, src.mtime);
      const back = await io.vault.read(temp);
      if (!sameBytes(back, bytes)) throw new Error("temp file does not match the source bytes");
    } catch (e) {
      await removeTemp(temp);
      fail(it.path, e);
      return;
    }
    try {
      if (exists) await io.vault.remove(target);
    } catch (e) {
      await removeTemp(temp);
      fail(it.path, e);
      return;
    }
    try {
      await io.vault.replace(temp, target);
    } catch (e) {
      // Das Ziel fehlt jetzt (falls es vorher da war): der Eintrag entfällt, der nächste Lauf heilt es als new.
      delete next[it.path];
      await removeTemp(temp);
      fail(it.path, e);
      return;
    }
    let st: { size: number; mtime: number } | null = null;
    try { st = await io.vault.stat(target); } catch { st = null; }
    const entry: ManifestEntry = {
      path: it.path, srcSize: src.size, srcMtime: src.mtime,
      size: st?.size ?? bytes.byteLength, mtime: st?.mtime ?? src.mtime, hash,
    };
    next[it.path] = entry;
    if (it.cls === "new") counts.created++;
    else if (it.cls === "conflict") counts.overwritten++;
    else counts.updated++;
  }

  const pacer = createCooperativeYield({ yieldToUi: io.yieldToUi, everyMs: opts.yieldEveryMs, clock: opts.clock });
  let aborted = false;
  let done = 0;
  for (const it of work) {
    if (io.signal.aborted) { aborted = true; break; }
    try {
      if (it.cls === "delete") await deleteOne(it);
      else await writeOne(it);
    } catch (e) {
      fail(it.path, e);
    }
    done++;
    if (opts.saveEvery > 0 && done % opts.saveEvery === 0) {
      try { await io.saveManifest({ ...next }); } catch (e) { fail("", e); }
    }
    await pacer.tick(() => io.onProgress(done, total));
  }
  if (!aborted) io.onProgress(done, total);
  await io.saveManifest({ ...next });
  return { manifest: next, counts, aborted, errors };
}
