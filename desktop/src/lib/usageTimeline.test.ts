import { describe, expect, it } from "vitest";
import { buildUsageTimeline } from "./usageTimeline";

const TODAY = new Date(2026, 6, 30, 12);

describe("usage timeline", () => {
  it("builds a stable trailing year and fills inactive days with zero", () => {
    const result = buildUsageTimeline(
      [{ date: "2026-07-29", activities: 2, estimatedTokens: 120 }],
      "daily",
      TODAY,
    );

    expect(result).toHaveLength(365);
    expect(result[0]?.date).toBe("2025-07-31");
    expect(result.at(-1)?.date).toBe("2026-07-30");
    expect(result.at(-2)).toEqual({
      date: "2026-07-29",
      activities: 2,
      estimatedTokens: 120,
    });
    expect(result.at(-1)?.estimatedTokens).toBe(0);
  });

  it("computes cumulative totals without changing the source dates", () => {
    const result = buildUsageTimeline(
      [
        { date: "2026-07-29", activities: 2, estimatedTokens: 120 },
        { date: "2026-07-30", activities: 1, estimatedTokens: 30 },
      ],
      "cumulative",
      TODAY,
    );

    expect(result.at(-1)).toEqual({
      date: "2026-07-30",
      activities: 3,
      estimatedTokens: 150,
    });
  });

  it("uses the same Sunday-to-Saturday total across a displayed week", () => {
    const result = buildUsageTimeline(
      [
        { date: "2026-07-27", activities: 1, estimatedTokens: 40 },
        { date: "2026-07-29", activities: 2, estimatedTokens: 60 },
      ],
      "weekly",
      TODAY,
    );

    const monday = result.find((day) => day.date === "2026-07-27");
    const thursday = result.find((day) => day.date === "2026-07-30");
    expect(monday?.estimatedTokens).toBe(100);
    expect(thursday?.estimatedTokens).toBe(100);
  });
});
