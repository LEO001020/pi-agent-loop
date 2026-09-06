import { describe, expect, it } from "vitest";
import type { GhPullRequest } from "@/lib/api";
import {
  PR_SEEN_STORAGE_KEY,
  buildPrSweepPrompt,
  isPrAutomation,
  loadSeenPrs,
  markPullsSeen,
  saveSeenPrs,
  unseenPulls,
  type SeenStorage,
} from "./prSweep";

function memoryStorage(
  initial: Record<string, string> = {},
): SeenStorage & { map: Record<string, string> } {
  const map = { ...initial };
  return {
    map,
    getItem: (k) => (k in map ? map[k]! : null),
    setItem: (k, v) => {
      map[k] = v;
    },
  };
}

function pr(number: number, over: Partial<GhPullRequest> = {}): GhPullRequest {
  return {
    number,
    title: `PR ${number}`,
    author: "someone",
    baseRef: "main",
    headRef: `feat/${number}`,
    isDraft: false,
    url: `https://github.com/o/r/pull/${number}`,
    ...over,
  };
}

describe("seen storage", () => {
  it("round-trips", () => {
    const s = memoryStorage();
    saveSeenPrs(s, { a: [1, 2] });
    expect(loadSeenPrs(s)).toEqual({ a: [1, 2] });
  });

  it("returns empty for absent or malformed data", () => {
    expect(loadSeenPrs(memoryStorage())).toEqual({});
    expect(loadSeenPrs(memoryStorage({ [PR_SEEN_STORAGE_KEY]: "{oops" }))).toEqual({});
    expect(loadSeenPrs(memoryStorage({ [PR_SEEN_STORAGE_KEY]: "[1,2]" }))).toEqual({});
  });

  it("drops entries that are not positive integers", () => {
    const s = memoryStorage({
      [PR_SEEN_STORAGE_KEY]: JSON.stringify({
        a: [1, "2", -3, 0, 4.5, 6],
        b: "nope",
        c: [],
      }),
    });
    expect(loadSeenPrs(s)).toEqual({ a: [1, 6] });
  });

  it("does not throw when storage refuses to write", () => {
    const throwing: SeenStorage = {
      getItem: () => null,
      setItem() {
        throw new Error("quota");
      },
    };
    expect(() => saveSeenPrs(throwing, { a: [1] })).not.toThrow();
  });
});

describe("unseenPulls", () => {
  it("returns only pull requests this automation has not handled", () => {
    const out = unseenPulls([pr(1), pr(2), pr(3)], { auto: [2] }, "auto");
    expect(out.map((p) => p.number)).toEqual([1, 3]);
  });

  it("keeps state per automation", () => {
    const seen = { one: [1], two: [2] };
    expect(unseenPulls([pr(1), pr(2)], seen, "one").map((p) => p.number)).toEqual([2]);
    expect(unseenPulls([pr(1), pr(2)], seen, "two").map((p) => p.number)).toEqual([1]);
  });

  it("skips drafts so a sweep does not interrupt work in progress", () => {
    const out = unseenPulls([pr(1, { isDraft: true }), pr(2)], {}, "auto");
    expect(out.map((p) => p.number)).toEqual([2]);
  });

  it("returns nothing when everything is known", () => {
    expect(unseenPulls([pr(1)], { auto: [1] }, "auto")).toEqual([]);
    expect(unseenPulls([], {}, "auto")).toEqual([]);
  });
});

describe("markPullsSeen", () => {
  it("merges without duplicating and leaves other automations alone", () => {
    const next = markPullsSeen({ a: [1], b: [9] }, "a", [1, 2]);
    expect(next.a).toEqual([1, 2]);
    expect(next.b).toEqual([9]);
  });

  it("keeps the most recent numbers when the list would grow unbounded", () => {
    const many = Array.from({ length: 250 }, (_, i) => i + 1);
    const next = markPullsSeen({}, "a", many, 200);
    expect(next.a).toHaveLength(200);
    expect(next.a!.at(-1)).toBe(250);
    expect(next.a!.at(0)).toBe(51);
  });

  it("is a no-op for an empty batch", () => {
    expect(markPullsSeen({ a: [1] }, "a", []).a).toEqual([1]);
  });
});

describe("buildPrSweepPrompt", () => {
  it("lists each pull request with the context needed to fetch it", () => {
    const out = buildPrSweepPrompt("o/r", [pr(7), pr(8)]);
    expect(out).toContain("New pull requests in o/r");
    expect(out).toContain("#7");
    expect(out).toContain("#8");
    expect(out).toContain("feat/7 → main");
  });

  it("does not inline diffs, which would blow the context window", () => {
    expect(buildPrSweepPrompt("o/r", [pr(1)])).not.toContain("```diff");
  });

  it("appends user instructions only when present", () => {
    expect(buildPrSweepPrompt("o/r", [pr(1)], "  ")).not.toContain(
      "Additional instructions",
    );
    expect(buildPrSweepPrompt("o/r", [pr(1)], "focus on tests")).toContain(
      "focus on tests",
    );
  });
});

describe("isPrAutomation", () => {
  it("keys off a non-empty repository", () => {
    expect(isPrAutomation({ repo: "o/r" })).toBe(true);
    expect(isPrAutomation({ repo: "  " })).toBe(false);
    expect(isPrAutomation({ repo: null })).toBe(false);
    expect(isPrAutomation({})).toBe(false);
  });
});
