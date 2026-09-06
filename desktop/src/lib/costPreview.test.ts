import { describe, expect, it } from "vitest";
import { promptCostPreview } from "./costPreview";

describe("promptCostPreview", () => {
  it("counts roughly four characters per token", () => {
    const preview = promptCostPreview("sonnet", "a".repeat(400));
    expect(preview.promptTokens).toBe(100);
  });

  it("reports nothing to show for an empty draft", () => {
    expect(promptCostPreview("sonnet", "").promptTokens).toBe(0);
  });

  /**
   * Regression: a first-match lookup billed `gpt-4o-mini` at the `gpt-4` rate,
   * overstating it by more than thirty times. The narrower id has to win.
   */
  it("prices a narrow model id on its own rate, not a broader one's", () => {
    expect(promptCostPreview("gpt-4o-mini", "x").pricePerMillion).toBe(0.15);
    expect(promptCostPreview("gpt-5-mini", "x").pricePerMillion).toBe(0.25);
    expect(promptCostPreview("gpt-4-turbo", "x").pricePerMillion).toBe(5);
    expect(promptCostPreview("gpt-5.6", "x").pricePerMillion).toBe(2.5);
  });

  it("matches a provider-prefixed id", () => {
    expect(promptCostPreview("anthropic/claude-opus-4", "x").pricePerMillion).toBe(15);
    expect(promptCostPreview("ANTHROPIC/Claude-Haiku", "x").pricePerMillion).toBe(0.8);
  });

  it("returns no cost for a model it has no price for", () => {
    const preview = promptCostPreview("some-local-llama", "hello");
    expect(preview.pricePerMillion).toBeNull();
    expect(preview.estimatedCost).toBeNull();
    expect(preview.promptTokens).toBeGreaterThan(0);
  });

  /**
   * Attachments travel as `@/path` references, not inlined bytes, so a long
   * path costs a little and a large file costs nothing until the agent reads it.
   */
  it("charges an attachment for its reference, not its file size", () => {
    const bare = promptCostPreview("sonnet", "review this");
    const withFile = promptCostPreview("sonnet", "review this", [
      "/Users/me/project/src/very/deep/module.ts",
    ]);
    expect(withFile.promptTokens).toBeGreaterThan(bare.promptTokens);
    expect(withFile.promptTokens - bare.promptTokens).toBeLessThan(15);
  });

  it("scales cost with the price of the model", () => {
    const text = "y".repeat(4_000_000);
    const opus = promptCostPreview("opus", text).estimatedCost!;
    const haiku = promptCostPreview("haiku", text).estimatedCost!;
    expect(opus / haiku).toBeCloseTo(15 / 0.8, 5);
  });
});
