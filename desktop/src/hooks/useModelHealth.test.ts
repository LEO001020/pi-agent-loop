import { describe, expect, it } from "vitest";
import { indexModelHealth } from "./useModelHealth";

describe("indexModelHealth", () => {
  it("indexes exact models and keeps missing failure rate honest", () => {
    expect(indexModelHealth([
      {
        providerId: "openai",
        modelId: "openai/gpt-5",
        sampleCount: 4,
        successCount: 4,
        failureCount: 0,
        averageLatencyMs: 220,
        failureRate: null,
      },
      {
        providerId: "anthropic",
        modelId: "anthropic/sonnet",
        sampleCount: 5,
        successCount: 4,
        failureCount: 1,
        averageLatencyMs: 480,
        failureRate: 0.2,
      },
    ])).toEqual({
      "openai/gpt-5": { averageLatencyMs: 220, failureRate: null },
      "anthropic/sonnet": { averageLatencyMs: 480, failureRate: 0.2 },
    });
  });
});

