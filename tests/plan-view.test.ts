import { afterEach, describe, expect, it } from "vitest";
import { makeFakeEl } from "./vendor/kit/obsidian-mock";
import { setLang } from "../src/vendor/kit/i18n";
import { buildViewModel } from "../src/core/view-model";
import type { Plan, PlanClass, PlanItem } from "../src/core/plan";
import { renderPlan, type OverwriteSelection } from "../src/obsidian/plan-view";

const src = { path: "x", size: 1, mtime: 1 };
const item = (path: string, cls: PlanClass, extra: Partial<PlanItem> = {}): PlanItem => ({ path, cls, ...extra });

function plan(items: PlanItem[], over: Partial<Plan> = {}): Plan {
  const counts = { new: 0, changed: 0, unchanged: 0, delete: 0, "vault-modified": 0, conflict: 0, "vault-only": 0 } as Record<PlanClass, number>;
  for (const it of items) counts[it.cls]++;
  return { items, counts, totalBytes: 0, mirrorBytes: 0, skipped: { symlinks: 0, tooBig: 0, otherType: 0 }, sourceState: "ok", unchecked: 0, forget: [], ...over };
}

function render(items: PlanItem[], sel: OverwriteSelection = { all: false, paths: new Set() }, reasons: Parameters<typeof buildViewModel>[0]["reasons"] = []) {
  const vm = buildViewModel({ status: "waiting", last: null, plan: plan(items), progress: null, waiting: true, reasons }, { time: String });
  const root = makeFakeEl();
  renderPlan(root, vm, sel);
  return { root, sel };
}
const all = (root: any, sel: string): any[] => root.querySelectorAll(sel);
const detailsOf = (root: any, label: RegExp): any => all(root, "details").find((d: any) => label.test(d.children[0].textContent));

afterEach(() => setLang("en"));

describe("renderPlan", () => {
  const items = [
    item("a/n.md", "new", { src }), item("a/d.md", "delete"), item("a/m.md", "vault-modified", { src }),
    item("a/c1.md", "conflict", { src }), item("a/c2.md", "conflict", { src, reason: "case-collision" }),
    item("a/o.md", "vault-only"), item("a/u.md", "unchanged", { src }),
  ];

  it("ein <details> je Gruppe; nur zu löschen und im Vault verändert tragen open", () => {
    const { root } = render(items);
    const ds = all(root, "details");
    expect(ds.map((d: any) => d.children[0].textContent)).toEqual([
      "1 new file", "1 file to delete", "1 file edited in the vault", "2 conflicts", "1 file only in the vault",
    ]);
    expect(ds.map((d: any) => d.getAttribute("open") !== null)).toEqual([false, true, true, false, false]);
    expect(all(root, "summary")).toHaveLength(5);
  });

  it("nur im Vault steht getrennt (is-separate) mit dem Hinweis „nie angefasst“; die anderen nicht", () => {
    const { root } = render(items);
    const only = detailsOf(root, /only in the vault/);
    expect(only.hasClass("is-separate")).toBe(true);
    expect(only.textContent).toContain("never touched");
    expect(all(root, "details").filter((d: any) => d.hasClass("is-separate"))).toHaveLength(1);
  });

  it("Karte nennt Gründe, Hinweise und die unveränderten Dateien", () => {
    const { root } = render(items, undefined, ["conflicts"]);
    const text = root.textContent as string;
    expect(text).toContain("Some files already exist in the vault");
    expect(text).toContain("The vault would be 0 B afterwards");
    expect(text).toContain("1 unchanged file");
    expect(all(root, "h3")[0].textContent).toBe("Sync plan");
  });

  it("Konflikte: Kästchen nur ohne reason; mit reason steht die Begründung und es gibt keine Auswahl", () => {
    const { root } = render(items);
    const conflicts = detailsOf(root, /conflicts/);
    const rows = all(conflicts, ".dmr-row");
    expect(rows).toHaveLength(2);
    expect(all(rows[0], "input")).toHaveLength(1);
    expect(all(rows[1], "input")).toHaveLength(0);
    expect(rows[1].textContent).toContain("not overwritten");
    expect(all(root, "input")).toHaveLength(1);
    expect(all(root, "input")[0].getAttribute("type")).toBe("checkbox");
    expect(all(root, "input")[0].getAttribute("aria-label")).toBe("Overwrite: a/c1.md");
  });

  it("Kästchen ankreuzen und abwählen pflegt die Auswahl", () => {
    const sel = { all: false, paths: new Set<string>() };
    const { root } = render(items, sel);
    const box = all(root, "input")[0];
    box.checked = true;
    box.dispatchEvent({ type: "change" });
    expect([...sel.paths]).toEqual(["a/c1.md"]);
    box.checked = false;
    box.dispatchEvent({ type: "change" });
    expect(sel.paths.size).toBe(0);
  });

  it("„Alle überschreiben“ setzt all und sperrt die Kästchen, „Keine“ löst beides", () => {
    const sel = { all: false, paths: new Set<string>(["a/c1.md"]) };
    const { root } = render(items, sel);
    const [allBtn, noneBtn] = all(detailsOf(root, /conflicts/), "button");
    expect(allBtn.textContent).toBe("Overwrite all");
    allBtn.click();
    expect(sel.all).toBe(true);
    expect(all(root, "input")[0].checked).toBe(true);
    expect(all(root, "input")[0].disabled).toBe(true);
    noneBtn.click();
    expect(sel.all).toBe(false);
    expect(sel.paths.size).toBe(0);
    expect(all(root, "input")[0].checked).toBe(false);
    expect(all(root, "input")[0].disabled).toBe(false);
  });

  it("ein gesperrtes Kästchen ändert bei all die Auswahl nicht", () => {
    const sel = { all: true, paths: new Set<string>() };
    const { root } = render(items, sel);
    const box = all(root, "input")[0];
    box.checked = true;
    box.dispatchEvent({ type: "change" });
    expect(sel.paths.size).toBe(0);
    expect(sel.all).toBe(true);
  });

  it("eine Auswahl vom vorigen Rendern erscheint wieder angekreuzt", () => {
    const { root } = render(items, { all: false, paths: new Set(["a/c1.md"]) });
    expect(all(root, "input")[0].checked).toBe(true);
  });

  it("Gruppen ohne überschreibbaren Konflikt haben keine Auswahlleiste", () => {
    const { root } = render([item("a/c2.md", "conflict", { src, reason: "type-change" }), item("a/d.md", "delete")]);
    expect(all(root, "button")).toHaveLength(0);
    expect(all(root, "input")).toHaveLength(0);
  });

  it("2.400 Pfade: höchstens 200 Zeilen im DOM plus „… und 2200 weitere“", () => {
    const many = Array.from({ length: 2400 }, (_, i) => item(`r/${String(i).padStart(5, "0")}.md`, "new", { src }));
    const { root } = render(many);
    expect(all(root, ".dmr-row")).toHaveLength(200);
    expect(all(root, ".dmr-more")[0].textContent).toBe("… and 2200 more");
    expect(all(root, "summary")[0].textContent).toBe("2400 new files");
  });

  it("DE: die Gruppen heißen deutsch", () => {
    setLang("de");
    const { root } = render(items);
    expect(all(root, "summary")[1].textContent).toBe("1 zu löschende Datei");
  });
});
