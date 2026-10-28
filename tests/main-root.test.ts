import { beforeEach, describe, expect, it, vi } from "vitest";
import { makeFakeApp } from "./vendor/kit/obsidian-mock";
import type { SourcePort } from "../src/core/scan";
import { createRunner } from "../src/core/runner";
import { fakeSource } from "./helpers/fake-source";
import { fakeVault } from "./helpers/fake-vault";

const enc = new TextEncoder();
const TREES: Record<string, Record<string, string>> = {
  "/a": { "repoA/docs/a.md": "alpha" },
  "/b": { "repoB/docs/b.md": "beta" },
};
const reads: string[] = [];
let gate: Promise<void> | null = null;

vi.mock("../src/obsidian/source-fs", () => ({
  createSourcePort: (root: string): SourcePort & { readFile(rel: string): Promise<Uint8Array> } => ({
    async readdir(rel: string) {
      reads.push(`${root}|readdir|${rel}`);
      if (gate) await gate;
      return fakeSource(TREES[root]).readdir(rel);
    },
    readFile(rel: string) {
      reads.push(`${root}|readFile|${rel}`);
      return Promise.resolve(enc.encode(TREES[root][rel] ?? ""));
    },
  }),
}));

const { default: DocsMirrorPlugin } = await import("../src/main");

beforeEach(() => { reads.length = 0; gate = null; });

describe("Wurzel gilt je Lauf", () => {
  it("ein Wurzelwechsel mitten im Lauf liest weiter aus dem alten Baum, der nächste Lauf aus dem neuen", async () => {
    const app = makeFakeApp();
    app.vault.configDir = ".obsidian";
    const store = new Map<string, unknown>([["docs-mirror:root", "/a"]]);
    app.loadLocalStorage = (k: string) => store.get(k) ?? null;
    app.saveLocalStorage = (k: string, v: unknown) => { store.set(k, v); };
    const plugin = new DocsMirrorPlugin(app as never, { id: "docs-mirror" } as never);
    plugin.makeRunner = (d) => createRunner({ ...d, vault: fakeVault(), yieldToUi: () => Promise.resolve() });

    await plugin.onload();
    let release!: () => void;
    gate = new Promise<void>((r) => { release = r; });
    const run = plugin.sync();
    for (let i = 0; i < 20; i++) await Promise.resolve();
    expect(plugin.setRoot("/b").ok).toBe(true);
    release();
    await run;
    expect(reads.length).toBeGreaterThan(0);
    expect(reads.every((r) => r.startsWith("/a|"))).toBe(true);
    expect(reads.some((r) => r.includes("readdir|repoA"))).toBe(true);

    reads.length = 0;
    gate = null;
    await plugin.sync();
    expect(reads.length).toBeGreaterThan(0);
    expect(reads.every((r) => r.startsWith("/b|"))).toBe(true);
  });
});
