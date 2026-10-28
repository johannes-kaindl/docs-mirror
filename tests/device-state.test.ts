import { describe, expect, it, vi } from "vitest";
import type { App } from "obsidian";
import { createDeviceState } from "../src/obsidian/device-state";
import type { Manifest } from "../src/core/manifest";

function fakeApp(): { app: App; store: Map<string, unknown> } {
  const store = new Map<string, unknown>();
  const app = {
    loadLocalStorage: (k: string) => (store.has(k) ? store.get(k) : null),
    saveLocalStorage: (k: string, v: unknown) => { if (v === null) store.delete(k); else store.set(k, v); },
  } as unknown as App;
  return { app, store };
}

const entry = (path: string) => ({ path, srcSize: 3, srcMtime: 10, size: 3, mtime: 11, hash: "abc" });
const manifest: Manifest = { "r/a.md": entry("r/a.md") };
const info = { at: 5, ok: true, fingerprint: "fp", counts: { created: 1, updated: 0, unchanged: 0, deleted: 0, overwritten: 0, skipped: 0, errors: 0 } };

describe("createDeviceState", () => {
  it("zweites Gerät ohne Schlüssel: root \"\", alles andere null", async () => {
    const { app } = fakeApp();
    expect(await createDeviceState(app, "docs-mirror").load()).toEqual({ root: "", manifest: null, fingerprint: null, last: null });
  });

  it("Round-Trip für Wurzel, Manifest, Fingerabdruck und letzten Lauf", async () => {
    const { app } = fakeApp();
    const st = createDeviceState(app, "docs-mirror");
    st.setRoot("/quelle");
    await st.save({ manifest, fingerprint: "fp", last: info });
    const again = await createDeviceState(app, "docs-mirror").load();
    expect(again).toEqual({ root: "/quelle", manifest, fingerprint: "fp", last: info });
  });

  it("save mit Teilmenge lässt die anderen Schlüssel stehen", async () => {
    const { app } = fakeApp();
    const st = createDeviceState(app, "docs-mirror");
    await st.save({ manifest, fingerprint: "fp" });
    await st.save({ fingerprint: "neu" });
    const l = await st.load();
    expect(l.manifest).toEqual(manifest);
    expect(l.fingerprint).toBe("neu");
  });

  it("defektes JSON: Manifest und letzter Lauf werden null statt zu werfen", async () => {
    const { app, store } = fakeApp();
    store.set("docs-mirror:manifest", "{kaputt");
    store.set("docs-mirror:last", "[1,");
    const l = await createDeviceState(app, "docs-mirror").load();
    expect(l.manifest).toBeNull();
    expect(l.last).toBeNull();
  });

  it("Manifest, das kein Objekt ist, wird null; defekte Einträge fallen heraus", async () => {
    const { app, store } = fakeApp();
    store.set("docs-mirror:manifest", "[1,2]");
    expect((await createDeviceState(app, "docs-mirror").load()).manifest).toBeNull();
    store.set("docs-mirror:manifest", JSON.stringify({ "r/a.md": entry("r/a.md"), "r/b.md": { path: "x" } }));
    expect((await createDeviceState(app, "docs-mirror").load()).manifest).toEqual({ "r/a.md": entry("r/a.md") });
  });

  it("Schlüssel tragen die Plugin-ID (zwei Plugins teilen sich nichts)", async () => {
    const { app, store } = fakeApp();
    const st = createDeviceState(app, "docs-mirror");
    st.setRoot("/x");
    await st.save({ fingerprint: "f" });
    expect([...store.keys()].every((k) => k.startsWith("docs-mirror:"))).toBe(true);
    expect((await createDeviceState(app, "anderes").load()).root).toBe("");
  });

  it("meldet ein Manifest über 2 MB über den Rückruf, speichert aber trotzdem", async () => {
    const { app } = fakeApp();
    const warn = vi.fn();
    const st = createDeviceState(app, "docs-mirror", { onLargeManifest: warn });
    await st.save({ manifest });
    expect(warn).not.toHaveBeenCalled();
    const big: Manifest = {};
    for (let i = 0; i < 12000; i++) big[`r/datei-${i}-${"x".repeat(150)}.md`] = entry(`r/datei-${i}-${"x".repeat(150)}.md`);
    await st.save({ manifest: big });
    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn.mock.calls[0][0]).toBeGreaterThan(2 * 1024 * 1024);
    // Bytes, nicht Zeichen: Umlaute zählen doppelt
    const umlaut: Manifest = {};
    for (let i = 0; i < 6000; i++) umlaut[`r/ä${i}${"ö".repeat(100)}.md`] = entry(`r/ä${i}${"ö".repeat(100)}.md`);
    const json = JSON.stringify(umlaut);
    expect(json.length).toBeLessThan(2 * 1024 * 1024);
    expect(new TextEncoder().encode(json).length).toBeGreaterThan(2 * 1024 * 1024);
    warn.mockClear();
    await st.save({ manifest: umlaut });
    expect(warn).toHaveBeenCalledTimes(1);
    expect(Object.keys((await st.load()).manifest ?? {}).length).toBe(6000);
  });
});
