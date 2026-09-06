import { describe, expect, it } from "vitest";
import {
  buildAgentBranchName,
  buildPrReviewPrompt,
  parsePullRequestRef,
  splitPrTitleAndBody,
  type PrDiffLike,
} from "./ghReview";

describe("parsePullRequestRef", () => {
  it("accepts bare, hashed and prefixed numbers", () => {
    expect(parsePullRequestRef("123")).toEqual({ number: 123 });
    expect(parsePullRequestRef(" #123 ")).toEqual({ number: 123 });
    expect(parsePullRequestRef("pr 123")).toEqual({ number: 123 });
    expect(parsePullRequestRef("PR#7")).toEqual({ number: 7 });
  });

  it("accepts full URLs and keeps owner/repo", () => {
    expect(
      parsePullRequestRef("https://github.com/AJSubrizi/Pi-App/pull/42"),
    ).toEqual({ number: 42, owner: "AJSubrizi", repo: "Pi-App" });
    expect(
      parsePullRequestRef("https://github.com/o/r/pull/9/files#diff-abc"),
    ).toEqual({ number: 9, owner: "o", repo: "r" });
  });

  it("rejects anything without a usable number", () => {
    expect(parsePullRequestRef("")).toBeNull();
    expect(parsePullRequestRef("   ")).toBeNull();
    expect(parsePullRequestRef("review my branch")).toBeNull();
    expect(parsePullRequestRef("#0")).toBeNull();
    expect(parsePullRequestRef("https://github.com/o/r/issues/5")).toBeNull();
  });
});

function pr(over: Partial<PrDiffLike> = {}): PrDiffLike {
  return {
    number: 12,
    title: "Fix the lock file",
    body: "",
    baseRef: "main",
    headRef: "fix/lock",
    url: "https://github.com/o/r/pull/12",
    diff: "diff --git a/x b/x\n+ok\n",
    truncated: false,
    changedFiles: 3,
    ...over,
  };
}

describe("buildPrReviewPrompt", () => {
  it("puts instructions before the diff and fences the diff", () => {
    const out = buildPrReviewPrompt(pr());
    expect(out.indexOf("## What I want")).toBeLessThan(out.indexOf("## Diff"));
    expect(out).toContain("```diff");
    expect(out).toContain("Review pull request #12: Fix the lock file");
    expect(out).toContain("`fix/lock` → `main`");
    expect(out).toContain("Files changed: 3");
  });

  it("flags truncation so the agent can qualify its conclusions", () => {
    expect(buildPrReviewPrompt(pr({ truncated: true }))).toContain(
      "truncated",
    );
    expect(buildPrReviewPrompt(pr())).not.toContain("truncated");
  });

  it("includes the author description only when there is one", () => {
    expect(buildPrReviewPrompt(pr({ body: "  " }))).not.toContain(
      "Author's description",
    );
    expect(buildPrReviewPrompt(pr({ body: "why" }))).toContain(
      "Author's description",
    );
  });

  it("survives an empty title", () => {
    expect(buildPrReviewPrompt(pr({ title: "" }))).toContain("(no title)");
  });
});

describe("buildAgentBranchName", () => {
  it("slugifies and prefixes", () => {
    expect(buildAgentBranchName("Fix the Lock File!")).toBe(
      "pi/fix-the-lock-file",
    );
  });

  it("collapses punctuation runs and trims stray dashes", () => {
    expect(buildAgentBranchName("  --Hello,,, World--  ")).toBe(
      "pi/hello-world",
    );
  });

  it("respects a custom prefix and length cap", () => {
    const out = buildAgentBranchName("a".repeat(200), {
      prefix: "agent",
      maxLength: 20,
    });
    expect(out.startsWith("agent/")).toBe(true);
    expect(out.length).toBeLessThanOrEqual(20);
    expect(out.endsWith("-")).toBe(false);
  });

  it("falls back to a timestamp when nothing survives slugification", () => {
    const out = buildAgentBranchName("!!! ???", {
      now: new Date("2026-07-30T09:15:00Z"),
    });
    expect(out).toBe("pi/task-202607300915");
  });

  it("never emits a name git would reject", () => {
    for (const title of ["…", "日本語", "a/b\\c", "--", " "]) {
      const out = buildAgentBranchName(title, {
        now: new Date("2026-01-02T03:04:00Z"),
      });
      expect(out).toMatch(/^[a-zA-Z0-9._-]+\/[a-z0-9-]+$/);
      expect(out).not.toContain("..");
      expect(out.endsWith("-")).toBe(false);
    }
  });
});

describe("splitPrTitleAndBody", () => {
  it("takes the first non-empty line as the title", () => {
    expect(splitPrTitleAndBody("\n\nAdd retries\n\nDetails here")).toEqual({
      title: "Add retries",
      body: "Details here",
    });
  });

  it("strips markdown heading markers", () => {
    expect(splitPrTitleAndBody("## Add retries\nbody").title).toBe(
      "Add retries",
    );
  });

  it("caps long titles on a word boundary", () => {
    const { title } = splitPrTitleAndBody(
      "This is a very long pull request title that goes well past the limit",
      30,
    );
    expect(title.length).toBeLessThanOrEqual(31);
    expect(title.endsWith("…")).toBe(true);
    expect(title).not.toMatch(/\s…$/);
  });

  it("returns empties for blank input", () => {
    expect(splitPrTitleAndBody("   \n  ")).toEqual({ title: "", body: "" });
  });
});
