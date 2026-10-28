import type { App } from "obsidian";
import { parseManifest, type Manifest } from "../core/manifest";
import { parseRunInfo } from "../core/run-info";
import type { DeviceState } from "../core/runner";

/** Ab dieser serialisierten Größe meldet der Zustand ein zu großes Manifest (localStorage ist klein). */
export const MANIFEST_WARN_BYTES = 2 * 1024 * 1024;

export interface DeviceStateOptions {
  /** Wird mit der Größe in Bytes gerufen, wenn das gespeicherte Manifest `MANIFEST_WARN_BYTES` überschreitet. */
  onLargeManifest?: (bytes: number) => void;
}

/** Gerätelokaler Zustand über `app.loadLocalStorage`/`saveLocalStorage` (je Vault und Gerät, nie im Sync).
 *  Ein Schlüssel je Wert, mit Plugin-ID als Präfix; Manifest und letzter Lauf liegen als JSON-Text, damit ein
 *  defekter Wert (`JSON.parse` wirft) zu `null` wird statt den Start zu brechen. `save` fängt einen Wurf von
 *  `saveLocalStorage` (Speicher voll) bewusst nicht ab: der Runner meldet ihn als Fehler (`trySave`). */
export function createDeviceState(app: App, pluginId: string, opts: DeviceStateOptions = {}): DeviceState & { setRoot(root: string): void } {
  const key = (name: string): string => `${pluginId}:${name}`;

  function readJson(name: string): unknown {
    const raw: unknown = app.loadLocalStorage(key(name));
    if (typeof raw !== "string") return null;
    try {
      return JSON.parse(raw);
    } catch {
      return null;
    }
  }

  return {
    setRoot(root) {
      app.saveLocalStorage(key("root"), root);
    },
    load() {
      const root: unknown = app.loadLocalStorage(key("root"));
      const rawManifest = readJson("manifest");
      const manifest: Manifest | null =
        typeof rawManifest === "object" && rawManifest !== null && !Array.isArray(rawManifest) ? parseManifest(rawManifest).manifest : null;
      const fp: unknown = app.loadLocalStorage(key("fingerprint"));
      return Promise.resolve({
        root: typeof root === "string" ? root : "",
        manifest,
        fingerprint: typeof fp === "string" ? fp : null,
        last: parseRunInfo(readJson("last")),
      });
    },
    save(p) {
      if (p.manifest !== undefined) {
        const json = JSON.stringify(p.manifest);
        const bytes = new TextEncoder().encode(json).length;
        if (bytes > MANIFEST_WARN_BYTES) opts.onLargeManifest?.(bytes);
        app.saveLocalStorage(key("manifest"), json);
      }
      if (p.fingerprint !== undefined) app.saveLocalStorage(key("fingerprint"), p.fingerprint);
      if (p.last !== undefined) app.saveLocalStorage(key("last"), JSON.stringify(p.last));
      return Promise.resolve();
    },
  };
}
