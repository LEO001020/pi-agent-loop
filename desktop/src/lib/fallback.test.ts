import { describe, expect, it } from "vitest";
import { isTransientFallbackError, nextFallbackModel } from "./fallback";

describe("provider fallback", () => {
  it("only treats transient provider failures as fallbackable", () => {
    expect(isTransientFallbackError("QUOTA_EXCEEDED")).toBe(true);
    expect(isTransientFallbackError("NETWORK_PROVIDER", "503")).toBe(true);
    expect(isTransientFallbackError("AUTH_FAILED", "model entitlement")).toBe(false);
    expect(isTransientFallbackError(undefined, "subscription payment required")).toBe(false);
  });

  it("advances through a role chain and skips unavailable ids", () => {
    const roles = { review: "openai/gpt-5" };
    const chains = { review: ["openai/gpt-5", "anthropic/claude", "local/qwen"] };
    expect(nextFallbackModel("openai/gpt-5", roles, chains, ["openai/gpt-5", "local/qwen"]))
      .toEqual({ modelId: "local/qwen", role: "review" });
  });

  it("does not invent a chain for a model without a role", () => {
    expect(nextFallbackModel("openai/gpt-5", { fast: "openai/gpt-4" }, {}, ["openai/gpt-5"]))
      .toBeNull();
  });

  /**
   * Regression: two roles naming each other handed the turn back and forth
   * forever, billing a real request on every hop.
   */
  it("never returns a model the turn has already spent a request on", () => {
    const roles = { fast: "a", deep: "b" };
    const chains = { fast: ["a", "b"], deep: ["b", "a"] };
    const available = ["a", "b"];

    const first = nextFallbackModel("a", roles, chains, available, ["a"]);
    expect(first).toEqual({ modelId: "b", role: "fast" });

    // From b, the only chain entry left is a — which already failed.
    expect(nextFallbackModel("b", roles, chains, available, ["a", "b"])).toBeNull();
  });

  it("walks past an exhausted candidate to a fresh one", () => {
    const roles = { review: "a" };
    const chains = { review: ["a", "b", "c"] };
    expect(nextFallbackModel("a", roles, chains, ["a", "b", "c"], ["a", "b"])).toEqual({
      modelId: "c",
      role: "review",
    });
  });
});
