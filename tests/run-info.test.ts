import { describe, expect, it } from "vitest";
import { parseRunInfo, statusOf, type RunInfo } from "../src/core/run-info";

const counts = { created: 1, updated: 2, unchanged: 3, deleted: 4, overwritten: 5, skipped: 6, errors: 0 };
const run = (over: Partial<RunInfo> = {}): RunInfo => ({ at: 1000, ok: true, counts, fingerprint: "fp", ...over });
const base = { configured: true, running: false, waiting: false, last: run(), reachable: true };

describe("parseRunInfo", () => {
  it("übernimmt eine gültige Lauf-Info", () => {
    expect(parseRunInfo(run())).toEqual(run());
    expect(parseRunInfo(run({ ok: false, error: "x" }))).toEqual(run({ ok: false, error: "x" }));
  });

  it("liefert null bei Müll, fehlenden oder negativen Zählern", () => {
    expect(parseRunInfo("x")).toBeNull();
    expect(parseRunInfo(null)).toBeNull();
    expect(parseRunInfo({ ...run(), counts: { ...counts, created: -1 } })).toBeNull();
    expect(parseRunInfo({ ...run(), counts: undefined })).toBeNull();
    expect(parseRunInfo({ ...run(), fingerprint: 3 })).toBeNull();
    expect(parseRunInfo({ ...run(), at: "gestern" })).toBeNull();
  });
});

describe("statusOf", () => {
  it("kennt alle sieben Stellungen", () => {
    expect(statusOf({ ...base, configured: false })).toBe("not-configured");
    expect(statusOf({ ...base, running: true })).toBe("running");
    expect(statusOf({ ...base, waiting: true })).toBe("waiting");
    expect(statusOf({ ...base, reachable: false })).toBe("unreachable");
    expect(statusOf({ ...base, last: null })).toBe("never");
    expect(statusOf({ ...base, last: run({ ok: false, error: "e" }) })).toBe("error");
    expect(statusOf(base)).toBe("current");
  });

  it("hält bei gleichzeitig zutreffenden Stellungen die feste Reihenfolge", () => {
    const all = { configured: false, running: true, waiting: true, last: null, reachable: false };
    expect(statusOf(all)).toBe("not-configured");
    expect(statusOf({ ...all, configured: true })).toBe("running");
    expect(statusOf({ ...all, configured: true, running: false })).toBe("waiting");
    expect(statusOf({ ...all, configured: true, running: false, waiting: false })).toBe("unreachable");
    expect(statusOf({ ...all, configured: true, running: false, waiting: false, reachable: true })).toBe("never");
    expect(statusOf({ ...base, reachable: false, last: run({ ok: false }) })).toBe("unreachable");
  });
});
