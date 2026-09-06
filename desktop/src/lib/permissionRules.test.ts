import { describe, expect, it } from "vitest";
import {
  addRule,
  bucketFor,
  dedupeRules,
  flattenRules,
  normalizeRuleAction,
  normalizeRuleText,
  normalizeRules,
  removeRule,
  rulePlaceholder,
  ruleRowKey,
  rulesCount,
} from "./permissionRules";

describe("normalizeRuleAction / text", () => {
  it("normalizes actions", () => {
    expect(normalizeRuleAction("ALLOW")).toBe("allow");
    expect(normalizeRuleAction(" Ask ")).toBe("ask");
    expect(normalizeRuleAction("deny")).toBe("deny");
    expect(normalizeRuleAction("maybe")).toBeNull();
    expect(normalizeRuleAction("")).toBeNull();
  });

  it("trims rule text", () => {
    expect(normalizeRuleText("  Bash(git *)  ")).toBe("Bash(git *)");
    expect(normalizeRuleText("   ")).toBeNull();
    expect(normalizeRuleText(null)).toBeNull();
  });
});

describe("dedupe / normalize", () => {
  it("dedupes preserving order", () => {
    expect(dedupeRules(["a", " a ", "b", "", "b"])).toEqual(["a", "b"]);
  });

  it("normalizes all buckets", () => {
    const n = normalizeRules({
      allow: ["Bash(git *)", " Bash(git *) "],
      deny: ["Bash(rm *)"],
      ask: [],
    });
    expect(n.allow).toEqual(["Bash(git *)"]);
    expect(n.deny).toEqual(["Bash(rm *)"]);
    expect(n.ask).toEqual([]);
  });
});

describe("addRule / removeRule", () => {
  it("adds and dedupes", () => {
    const base = normalizeRules({});
    const a = addRule(base, "deny", "Bash(rm *)");
    expect(a?.deny).toEqual(["Bash(rm *)"]);
    const a2 = addRule(a!, "deny", "Bash(rm *)");
    expect(a2?.deny).toHaveLength(1);
    expect(addRule(base, "nope", "x")).toBeNull();
    expect(addRule(base, "allow", "  ")).toBeNull();
  });

  it("removes exact rule", () => {
    const base = normalizeRules({
      allow: ["Bash(git *)"],
      deny: ["Bash(rm *)"],
    });
    const next = removeRule(base, "deny", "Bash(rm *)");
    expect(next?.deny).toEqual([]);
    expect(next?.allow).toEqual(["Bash(git *)"]);
  });
});

describe("flatten / misc", () => {
  it("flattens deny → ask → allow", () => {
    const flat = flattenRules({
      allow: ["Read"],
      deny: ["Bash(rm *)"],
      ask: ["Edit"],
    });
    expect(flat.map((r) => r.action)).toEqual(["deny", "ask", "allow"]);
    expect(flat.map((r) => r.rule)).toEqual([
      "Bash(rm *)",
      "Edit",
      "Read",
    ]);
  });

  it("bucket / key / count / placeholder", () => {
    const r = normalizeRules({ allow: ["a"], deny: ["b"], ask: ["c"] });
    expect(bucketFor(r, "allow")).toEqual(["a"]);
    expect(ruleRowKey("deny", "x")).toBe("deny:x");
    expect(rulesCount(r)).toBe(3);
    expect(rulePlaceholder("allow")).toContain("git");
    expect(rulePlaceholder("deny")).toContain("rm");
  });
});
