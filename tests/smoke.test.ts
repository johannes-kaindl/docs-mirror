import { describe, expect, it } from "vitest";
import { CORE_NAME } from "../src/core/index";

describe("smoke", () => {
  it("lädt den Kern", () => {
    expect(CORE_NAME).toBe("docs-mirror");
  });
});
