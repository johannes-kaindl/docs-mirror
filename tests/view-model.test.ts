import { afterEach, describe, expect, it } from "vitest";
import { setLang } from "../src/vendor/kit/i18n";
import { buildViewModel, guardTexts, isOverwritable, MAX_PATHS_PER_GROUP, type ViewModel } from "../src/core/view-model";
import type { Plan, PlanClass, PlanItem } from "../src/core/plan";
import type { RunInfo, RunStatus } from "../src/core/run-info";

const fmt = { time: (ms: number): string => `T${ms}` };
const COUNTS = { created: 3, updated: 2, unchanged: 7, deleted: 1, overwritten: 0, skipped: 4, errors: 0 };
const INFO: RunInfo = { at: 42, ok: true, counts: COUNTS, fingerprint: "fp" };

function plan(items: PlanItem[], over: Partial<Plan> = {}): Plan {
  const counts = { new: 0, changed: 0, unchanged: 0, delete: 0, "vault-modified": 0, conflict: 0, "vault-only": 0 } as Record<PlanClass, number>;
  for (const it of items) counts[it.cls]++;
  return { items, counts, totalBytes: 0, mirrorBytes: 0, skipped: { symlinks: 0, tooBig: 0, otherType: 0 }, sourceState: "ok", unchecked: 0, forget: [], ...over };
}
const item = (path: string, cls: PlanClass, extra: Partial<PlanItem> = {}): PlanItem => ({ path, cls, ...extra });
const src = { path: "x", size: 1, mtime: 1 };

function vm(over: Partial<Parameters<typeof buildViewModel>[0]> = {}): ViewModel {
  return buildViewModel({ status: "current", last: INFO, plan: null, progress: null, waiting: false, reasons: [], ...over }, fmt);
}
const group = (m: ViewModel, cls: PlanClass) => m.groups.find((g) => g.cls === cls);

afterEach(() => setLang("en"));

describe("buildViewModel: Status (Form UND Text, nie Farbe allein)", () => {
  const table: [RunStatus, string, string, string, string][] = [
    ["not-configured", "alert-triangle", "is-warning", "Not set up", "Status: Not set up"],
    ["never", "alert-triangle", "is-warning", "Never run", "Status: Never run"],
    ["running", "loader", "is-checking", "Running", "Status: Running"],
    ["waiting", "alert-triangle", "is-warning", "Waiting for confirmation", "Status: Waiting for confirmation"],
    ["unreachable", "circle-x", "is-error", "Source unreachable", "Status: Source unreachable"],
    ["error", "circle-x", "is-error", "Error", "Status: Error"],
    ["current", "circle-check", "is-ok", "Up to date", "Status: Up to date"],
  ];
  it.each(table)("%s: Icon %s, Klasse %s, Text und aria-label gesetzt", (status, icon, cls, text, aria) => {
    const m = vm({ status });
    expect(m.status).toBe(status);
    expect(m.statusIcon).toBe(icon);
    expect(m.statusClass).toBe(cls);
    expect(m.statusText).toBe(text);
    expect(m.statusAria).toBe(aria);
  });

  it("jeder Status hat einen Text, der nicht leer ist (zweiter Kanal neben Farbe)", () => {
    for (const [status] of table) expect(vm({ status }).statusText.trim()).not.toBe("");
  });

  it("DE: Text folgt der Sprache", () => {
    setLang("de");
    expect(vm({ status: "waiting" }).statusText).toBe("Wartet auf Bestätigung");
    expect(vm({ status: "current" }).statusAria).toBe("Status: Aktuell");
  });
});

describe("buildViewModel: letzter Lauf, Zähler, Fortschritt", () => {
  it("lastRun trägt die formatierte Zeit, ohne Lauf ist es null", () => {
    expect(vm().lastRun).toBe("Last run: T42");
    expect(vm({ last: null }).lastRun).toBeNull();
    expect(vm({ last: null }).counters).toBeNull();
    expect(vm({ last: null }).counterRows).toEqual([]);
  });

  it("showResult: die Karte des letzten Laufs gilt nur, solange kein Lauf läuft; Beschriftung und Zeit einzeln", () => {
    expect(vm().showResult).toBe(true);
    expect(vm({ status: "waiting", waiting: true, plan: plan([]) }).showResult).toBe(true);
    expect(vm({ status: "running" }).showResult).toBe(false);
    expect(vm({ last: null }).showResult).toBe(false);
    expect([vm().lastRunLabel, vm().lastRunTime]).toEqual(["Last run", "T42"]);
    expect([vm({ last: null }).lastRunLabel, vm({ last: null }).lastRunTime]).toEqual([null, null]);
  });

  it("Zähler stehen als Zeilen mit Beschriftung, ohne Nullzeilen nicht gefiltert (alle sieben)", () => {
    const m = vm();
    expect(m.counters).toEqual(COUNTS);
    expect(m.counterRows.map((r) => [r.key, r.label, r.value])).toEqual([
      ["created", "New", 3], ["updated", "Changed", 2], ["unchanged", "Unchanged", 7], ["deleted", "Deleted", 1],
      ["overwritten", "Overwritten", 0], ["skipped", "Skipped", 4], ["errors", "Errors", 0],
    ]);
  });

  it("lastError übersetzt den Schlüssel eines fehlgeschlagenen Laufs, nur bei ok=false", () => {
    expect(vm({ last: { ...INFO, ok: false, error: "status.unreachable" } }).lastError).toBe("Source unreachable");
    expect(vm({ last: { ...INFO, ok: false, error: "notice.failed" } }).lastError).toBe("Sync failed. Nothing was deleted by the failed step.");
    expect(vm({ last: { ...INFO, ok: false, error: "irgendwas.fremdes" } }).lastError).toBe("Sync failed. Nothing was deleted by the failed step.");
    expect(vm({ last: { ...INFO, ok: false, error: "settings.root" } }).lastError).toBe("Sync failed. Nothing was deleted by the failed step.");
    expect(vm({ last: { ...INFO, ok: false, error: "notice.blocked.empty" } }).lastError).toBe("Sync blocked: the source is empty. Nothing was deleted.");
    expect(vm({ last: { ...INFO, ok: false } }).lastError).toBeNull();
    expect(vm({ last: { ...INFO, ok: true, error: "notice.partial" } }).lastError).toBeNull();
    expect(vm({ last: null }).lastError).toBeNull();
  });

  it("Fortschritt nur im Lauf, mit Text", () => {
    const m = vm({ status: "running", progress: { done: 3, total: 10 } });
    expect(m.progress).toEqual({ done: 3, total: 10 });
    expect(m.progressText).toBe("3 of 10 files");
    expect(vm({ status: "current", progress: { done: 3, total: 10 } }).progress).toBeNull();
    expect(vm({ status: "current", progress: { done: 3, total: 10 } }).progressText).toBeNull();
    expect(vm({ status: "running", progress: null }).progress).toBeNull();
  });

  it("Fortschritt im Scan: Gesamtzahl unbekannt (null) → Text nennt die gelesenen Einträge", () => {
    const m = vm({ status: "running", progress: { done: 1234, total: null } });
    expect(m.progress).toEqual({ done: 1234, total: null });
    expect(m.progressText).toBe("1234 entries read");
    expect(vm({ status: "current", progress: { done: 5, total: null } }).progressText).toBeNull();
  });
});

describe("buildViewModel: Primärknopf (Aktion, kein Toggle)", () => {
  it("sync im Normalfall, mit Beschriftung", () => {
    for (const status of ["never", "unreachable", "error", "current"] as RunStatus[]) {
      const m = vm({ status });
      expect(m.primary, status).toBe("sync");
      expect(m.primaryLabel).toBe("Sync now");
      expect(m.secondary).toBeNull();
    }
  });
  it("execute NUR bei waiting; dann bleibt sync als zweiter Knopf", () => {
    const m = vm({ status: "waiting", waiting: true, plan: plan([]) });
    expect(m.primary).toBe("execute");
    expect(m.primaryLabel).toBe("Run plan");
    expect(m.secondary).toBe("sync");
    expect(vm({ status: "current", waiting: false }).primary).not.toBe("execute");
    expect(vm({ status: "never", waiting: false }).primary).not.toBe("execute");
  });
  it("cancel NUR im Lauf, auch wenn waiting noch gesetzt ist; kein zweiter Knopf", () => {
    const m = vm({ status: "running", waiting: true });
    expect(m.primary).toBe("cancel");
    expect(m.primaryLabel).toBe("Cancel");
    expect(m.secondary).toBeNull();
    for (const status of ["not-configured", "never", "waiting", "unreachable", "error", "current"] as RunStatus[]) {
      expect(vm({ status, waiting: status === "waiting" }).primary, status).not.toBe("cancel");
    }
  });
  it("settings statt sync, solange nichts eingerichtet ist", () => {
    const m = vm({ status: "not-configured", last: null });
    expect(m.primary).toBe("settings");
    expect(m.primaryLabel).toBe("Open settings");
    expect(m.secondary).toBeNull();
  });
});

describe("buildViewModel: Gruppen", () => {
  const items: PlanItem[] = [
    item("a/new.md", "new", { src }), item("a/miss.md", "new", { src, reason: "vault-missing" }),
    item("a/ch.md", "changed", { src }), item("a/same.md", "unchanged", { src }),
    item("a/del.md", "delete"), item("a/mod.md", "vault-modified", { src }),
    item("a/c1.md", "conflict", { src }), item("a/c2.md", "conflict", { src, reason: "case-collision" }),
    item("a/only.md", "vault-only"), item("a/orphan.md", "vault-only", { reason: "orphan-modified" }),
  ];
  const m = vm({ status: "waiting", waiting: true, plan: plan(items) });

  it("Reihenfolge fest, unverändert und leere Klassen fehlen, nur im Vault zuletzt", () => {
    expect(m.groups.map((g) => g.cls)).toEqual(["new", "changed", "delete", "vault-modified", "conflict", "vault-only"]);
    expect(m.unchanged).toBe(1);
    expect(vm({ status: "waiting", waiting: true, plan: plan([item("x.md", "new", { src })]) }).groups.map((g) => g.cls)).toEqual(["new"]);
  });

  it("open: nur zu löschen und im Vault verändert sind aufgeklappt", () => {
    expect(m.groups.map((g) => [g.cls, g.open])).toEqual([
      ["new", false], ["changed", false], ["delete", true], ["vault-modified", true], ["conflict", false], ["vault-only", false],
    ]);
  });

  it("Beschriftung zählt mit Zählform", () => {
    expect(group(m, "new")?.label).toBe("2 new files");
    expect(group(m, "delete")?.label).toBe("1 file to delete");
    expect(group(m, "delete")?.count).toBe(1);
    setLang("de");
    const de = vm({ status: "waiting", waiting: true, plan: plan(items) });
    expect(group(de, "delete")?.label).toBe("1 zu löschende Datei");
    expect(group(de, "conflict")?.label).toBe("2 Konflikte");
  });

  it("paths und rows sind deckungsgleich", () => {
    const g = group(m, "new");
    expect(g?.paths).toEqual(["a/new.md", "a/miss.md"]);
    expect(g?.rows.map((r) => r.path)).toEqual(g?.paths);
  });

  it("neu mit Grund vault-missing trägt den Grund als Notiz, die gewöhnliche neue Datei keinen", () => {
    const rows = group(m, "new")?.rows ?? [];
    expect(rows.find((r) => r.path === "a/miss.md")?.note).toBe("Missing in the vault: written again.");
    expect(rows.find((r) => r.path === "a/new.md")?.note).toBeNull();
  });

  it("im Vault verändert: Hinweis, dass die Quelle überschreibt", () => {
    expect(group(m, "vault-modified")?.hint).toBe("These files are overwritten with the source version.");
  });

  it("nur im Vault: getrennt, mit dem Hinweis „nie angefasst“, nie überschreibbar", () => {
    const g = group(m, "vault-only");
    expect(g?.separate).toBe(true);
    expect(g?.hint).toBe("Files that exist only in the vault are never touched.");
    expect(g?.rows.every((r) => !r.overwritable)).toBe(true);
    expect(g?.rows.find((r) => r.path === "a/orphan.md")?.note).toBe("Source deleted, edited in the vault: stays in place.");
    for (const other of m.groups.filter((x) => x.cls !== "vault-only")) expect(other.separate).toBe(false);
    setLang("de");
    expect(group(vm({ status: "waiting", waiting: true, plan: plan(items) }), "vault-only")?.hint).toBe("Dateien, die nur im Vault liegen, werden nie angefasst.");
  });

  it("Konflikt: nur ohne reason und mit Quelle überschreibbar; mit reason nie, mit Begründung", () => {
    const rows = group(m, "conflict")?.rows ?? [];
    const free = rows.find((r) => r.path === "a/c1.md");
    const tied = rows.find((r) => r.path === "a/c2.md");
    expect(free?.overwritable).toBe(true);
    expect(free?.note).toBe("Already in the vault and not created by this plugin.");
    expect(tied?.overwritable).toBe(false);
    expect(tied?.note).toBe("Another file differs only in case or Unicode form: not overwritten.");
  });

  it("jede reason eines Konflikts ist nie überschreibbar und hat eine eigene Begründung", () => {
    const reasons = ["type-change", "case-collision", "unreadable"] as const;
    const notes = new Set<string | null>();
    for (const reason of reasons) {
      const g = group(vm({ status: "waiting", waiting: true, plan: plan([item("c.md", "conflict", { src, reason })]) }), "conflict");
      expect(g?.rows[0]?.overwritable, reason).toBe(false);
      expect(g?.rows[0]?.note, reason).not.toBeNull();
      notes.add(g?.rows[0]?.note ?? null);
    }
    expect(notes.size).toBe(3);
  });

  it("ein Konflikt ohne Quelle ist nicht überschreibbar (Kollisionsmitglied aus dem Scan)", () => {
    const g = group(vm({ status: "waiting", waiting: true, plan: plan([item("c.md", "conflict")]) }), "conflict");
    expect(g?.rows[0]?.overwritable).toBe(false);
  });

  it("Konflikt-Gruppe nennt, dass nur angehakte Dateien überschrieben werden", () => {
    expect(group(m, "conflict")?.hint).toBe("Conflicts are only overwritten if you tick them.");
  });
});

describe("buildViewModel: Kappung (eine Gruppe mit 2.400 Pfaden friert die Ansicht nicht ein)", () => {
  const many = (n: number): PlanItem[] => Array.from({ length: n }, (_, i) => item(`r/${String(i).padStart(5, "0")}.md`, "new", { src }));

  it("zeigt höchstens 200 Pfade und „… und N weitere“", () => {
    expect(MAX_PATHS_PER_GROUP).toBe(200);
    const g = group(vm({ status: "waiting", waiting: true, plan: plan(many(2400)) }), "new");
    expect(g?.count).toBe(2400);
    expect(g?.paths).toHaveLength(200);
    expect(g?.rows).toHaveLength(200);
    expect(g?.more).toBe("… and 2200 more");
    expect(g?.label).toBe("2400 new files");
  });
  it("genau 200 Pfade: keine Kappung; 201: ein weiterer", () => {
    expect(group(vm({ status: "waiting", waiting: true, plan: plan(many(200)) }), "new")?.more).toBeNull();
    const g = group(vm({ status: "waiting", waiting: true, plan: plan(many(201)) }), "new");
    expect(g?.paths).toHaveLength(200);
    expect(g?.more).toBe("… and 1 more");
  });
  it("DE: „… und N weitere“", () => {
    setLang("de");
    expect(group(vm({ status: "waiting", waiting: true, plan: plan(many(250)) }), "new")?.more).toBe("… und 50 weitere");
  });
});

describe("buildViewModel: Hinweise zum Plan", () => {
  it("ohne Plan: keine Gruppen, keine Hinweise", () => {
    const m = vm();
    expect(m.groups).toEqual([]);
    expect(m.notes).toEqual([]);
    expect(m.reasons).toEqual([]);
    expect(m.unchanged).toBe(0);
    expect(m.hasPlan).toBe(false);
  });
  it("mit Plan: hasPlan, Größe des Vaults danach, nicht geprüfte Dateien", () => {
    const m = vm({ status: "waiting", waiting: true, plan: plan([item("a.md", "new", { src })], { mirrorBytes: 63_201_294, unchecked: 3 }) });
    expect(m.hasPlan).toBe(true);
    expect(m.notes).toEqual(["Not checked: 3 files in unreadable folders", "The vault would be 63.2 MB afterwards"]);
  });
  it("nicht geprüft: Einzahl; keine Zeile bei 0", () => {
    expect(vm({ status: "waiting", waiting: true, plan: plan([], { unchecked: 1 }) }).notes[0]).toBe("Not checked: 1 file in an unreadable folder");
    expect(vm({ status: "waiting", waiting: true, plan: plan([], { unchecked: 0 }) }).notes).toEqual(["The vault would be 0 B afterwards"]);
  });
  it("DE: Größe mit Komma", () => {
    setLang("de");
    expect(vm({ status: "waiting", waiting: true, plan: plan([], { mirrorBytes: 63_201_294 }) }).notes).toEqual(["Der Vault wäre danach 63,2 MB groß"]);
  });
  it("ohne Angabe von reasons gibt es keine Gründe", () => {
    expect(buildViewModel({ status: "current", last: null, plan: null, progress: null, waiting: false }, fmt).reasons).toEqual([]);
  });
  it("Gründe der Bestätigung in fester Folge, mit Text je Grund", () => {
    const m = vm({ status: "waiting", waiting: true, plan: plan([]), reasons: ["first-run", "threshold", "settings-changed", "total-size", "conflicts"] });
    expect(m.reasons).toEqual([
      "First run: check the plan before anything is written.",
      "This run deletes at least as many files as the threshold, and at least 20 percent of the recorded files.",
      "Settings changed since the last run, or the state of this device is unknown.",
      "The files to mirror exceed the total size limit.",
      "Some files already exist in the vault and were not created by this plugin.",
    ]);
  });
});

describe("guardTexts und isOverwritable", () => {
  it("guardTexts: ein Satz je Grund, in der Reihenfolge der Eingabe", () => {
    expect(guardTexts(["conflicts", "first-run"])).toEqual([
      "Some files already exist in the vault and were not created by this plugin.",
      "First run: check the plan before anything is written.",
    ]);
    expect(guardTexts([])).toEqual([]);
  });
  it("isOverwritable: nur Konflikt, ohne reason, mit Quelle", () => {
    expect(isOverwritable(item("a", "conflict", { src }))).toBe(true);
    expect(isOverwritable(item("a", "conflict"))).toBe(false);
    for (const reason of ["type-change", "case-collision", "unreadable"] as const) expect(isOverwritable(item("a", "conflict", { src, reason }))).toBe(false);
    for (const cls of ["new", "changed", "delete", "vault-modified", "vault-only", "unchanged"] as PlanClass[]) expect(isOverwritable(item("a", cls, { src }))).toBe(false);
  });
});
