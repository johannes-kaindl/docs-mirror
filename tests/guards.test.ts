import { describe, expect, it } from "vitest";
import { checkGuards } from "../src/core/guards";
import type { Plan, PlanClass } from "../src/core/plan";
import { DEFAULT_SETTINGS } from "../src/core/settings";

function planOf(counts: Partial<Record<PlanClass, number>> = {}, over: Partial<Plan> = {}): Plan {
  return {
    items: [],
    counts: { new: 0, changed: 0, unchanged: 0, delete: 0, "vault-modified": 0, conflict: 0, "vault-only": 0, ...counts },
    totalBytes: 0,
    skipped: { symlinks: 0, tooBig: 0, otherType: 0 },
    sourceState: "ok",
    unchecked: 0,
    forget: [],
    ...over,
  };
}
const ctx = (over: Partial<{ hadManifest: boolean; manifestSize: number; fingerprintChanged: boolean }> = {}) => ({
  hadManifest: true, manifestSize: 100, fingerprintChanged: false, ...over,
});
const S = DEFAULT_SETTINGS; // 20 Dateien und 20 Prozent, 1 GB

describe("checkGuards", () => {
  it("ruhiger Lauf: keine Sperre, keine Bestätigung", () => {
    expect(checkGuards(planOf({ new: 3, changed: 2 }), ctx(), S)).toEqual({ blocked: null, confirm: [] });
  });

  it("erster Lauf (kein Manifest) fragt", () => {
    expect(checkGuards(planOf({ new: 3 }), ctx({ hadManifest: false, manifestSize: 0 }), S).confirm).toEqual(["first-run"]);
  });

  it("Schwelle: 19 Löschungen bei Manifest 40 fragen nicht (Anzahl unter der Schwelle)", () => {
    expect(checkGuards(planOf({ delete: 19 }), ctx({ manifestSize: 40 }), S).confirm).toEqual([]);
  });

  it("Schwelle: 20 Löschungen bei Manifest 100 fragen (Grenze zählt mit)", () => {
    expect(checkGuards(planOf({ delete: 20 }), ctx({ manifestSize: 100 }), S).confirm).toEqual(["threshold"]);
  });

  it("Schwelle braucht BEIDE Bedingungen: 20 Löschungen bei Manifest 1000 fragen nicht", () => {
    expect(checkGuards(planOf({ delete: 20 }), ctx({ manifestSize: 1000 }), S).confirm).toEqual([]);
  });

  it("Schwelle braucht BEIDE Bedingungen: 19 Löschungen bei Manifest 19 (100 Prozent) fragen nicht", () => {
    expect(checkGuards(planOf({ delete: 19 }), ctx({ manifestSize: 19 }), S).confirm).toEqual([]);
  });

  it("Prozentgrenze: 20 von 101 (19,8 Prozent) fragen nicht, 20 von 100 (20 Prozent) fragen", () => {
    expect(checkGuards(planOf({ delete: 20 }), ctx({ manifestSize: 101 }), S).confirm).toEqual([]);
    expect(checkGuards(planOf({ delete: 20 }), ctx({ manifestSize: 100 }), S).confirm).toEqual(["threshold"]);
  });

  it("leeres Manifest: keine Division durch null", () => {
    const r = checkGuards(planOf({ delete: 25 }), ctx({ manifestSize: 0 }), S);
    expect(r.confirm).toEqual([]);
  });

  it("Schwelle null Löschungen fragt nie, auch bei Schwelle 0", () => {
    const s = { ...S, deleteThresholdFiles: 0, deleteThresholdPercent: 0 };
    expect(checkGuards(planOf({ delete: 0 }), ctx(), s).confirm).toEqual([]);
  });

  it("geänderter Fingerabdruck fragt, auch bei null Löschungen", () => {
    expect(checkGuards(planOf(), ctx({ fingerprintChanged: true }), S).confirm).toEqual(["settings-changed"]);
  });

  it("Gesamtgröße über der Grenze fragt, genau auf der Grenze nicht", () => {
    expect(checkGuards(planOf({}, { totalBytes: S.maxTotalBytes + 1 }), ctx(), S).confirm).toEqual(["total-size"]);
    expect(checkGuards(planOf({}, { totalBytes: S.maxTotalBytes }), ctx(), S).confirm).toEqual([]);
  });

  it("ein Konflikt im Plan fragt", () => {
    expect(checkGuards(planOf({ conflict: 1 }), ctx(), S).confirm).toEqual(["conflicts"]);
  });

  it("Gründe stehen in fester Reihenfolge", () => {
    const r = checkGuards(
      planOf({ delete: 30, conflict: 2 }, { totalBytes: S.maxTotalBytes + 1 }),
      ctx({ hadManifest: false, manifestSize: 50, fingerprintChanged: true }),
      S,
    );
    expect(r.confirm).toEqual(["first-run", "threshold", "settings-changed", "total-size", "conflicts"]);
  });

  it.each([
    ["unreachable", "source-unreachable"],
    ["empty", "source-empty"],
  ] as const)("Quelle %s sperrt und hat Vorrang vor allem anderen", (state, blocked) => {
    const r = checkGuards(
      planOf({ delete: 30, conflict: 2 }, { sourceState: state, totalBytes: S.maxTotalBytes + 1 }),
      ctx({ hadManifest: false, fingerprintChanged: true }),
      S,
    );
    expect(r).toEqual({ blocked, confirm: [] });
  });
});
