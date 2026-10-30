import { describe, it, expect } from "vitest";
import { matchIgnore, parsePatterns } from "../src/vendor/kit/ignore";

describe("Ordnermuster: geschweifte Klammern gelten wörtlich", () => {
  it("`**/{docs,doc}` trifft weder docs noch doc, nur einen Ordner mit genau diesem Namen", () => {
    const { rules } = parsePatterns("**/{docs,doc}");
    expect(matchIgnore(rules, "repo/docs")).toBeNull();
    expect(matchIgnore(rules, "repo/doc")).toBeNull();
    expect(matchIgnore(rules, "repo/{docs,doc}")).not.toBeNull();
  });

  it("zwei Zeilen leisten, was die Klammer nicht leistet", () => {
    const { rules } = parsePatterns("**/docs\n**/doc");
    expect(matchIgnore(rules, "repo/docs")).not.toBeNull();
    expect(matchIgnore(rules, "repo/doc")).not.toBeNull();
  });
});
