import { describe, expect, it } from "vitest";
import {
  cacheChipView,
  cacheBreakCause,
  cacheNote,
  cacheNoteKey,
  cacheStanding,
  formatCacheRate,
  formatCost,
  formatTokens,
  type UsagePayload,
} from "./cacheUsage";

const measured = (rate: number, modelId = "openai/gpt") => ({
  sessionId: "s1",
  modelId,
  turn: { input: 1, output: 1, cacheRead: 1, cacheWrite: 0, totalTokens: 2 },
  total: { input: 1, output: 1, cacheRead: 1, cacheWrite: 0, totalTokens: 2 },
  cacheHitRate: rate,
});

describe("cacheBreakCause", () => {
  it("attributes a sharp drop to a model switch when the host can prove it", () => {
    expect(cacheBreakCause(measured(0.9, "openai/gpt"), measured(0.4, "anthropic/sonnet"))).toBe("model");
  });

  it("keeps the heuristic honest for attachment and unknown changes", () => {
    expect(cacheBreakCause(measured(0.9), measured(0.5), { attachmentsChanged: true })).toBe("attachments");
    expect(cacheBreakCause(measured(0.9), measured(0.5))).toBe("unknown");
  });
});

describe("cacheStanding", () => {
  it("splits the range into cost-meaningful bands", () => {
    expect(cacheStanding(0)).toBe("cold");
    expect(cacheStanding(0.33)).toBe("cold");
    expect(cacheStanding(0.34)).toBe("warming");
    expect(cacheStanding(0.66)).toBe("warming");
    expect(cacheStanding(0.67)).toBe("good");
    expect(cacheStanding(1)).toBe("good");
  });
});

describe("formatCacheRate", () => {
  it("rounds to whole percent", () => {
    expect(formatCacheRate(0.923)).toBe("92%");
    expect(formatCacheRate(0.5)).toBe("50%");
  });

  it("never reports a real hit as zero, or a partial miss as perfect", () => {
    expect(formatCacheRate(0.004)).toBe("<1%");
    expect(formatCacheRate(0.999)).toBe(">99%");
    expect(formatCacheRate(0)).toBe("0%");
    expect(formatCacheRate(1)).toBe("100%");
  });
});

describe("formatTokens", () => {
  it("keeps small counts exact", () => {
    expect(formatTokens(0)).toBe("0");
    expect(formatTokens(999)).toBe("999");
  });

  it("compacts thousands and millions", () => {
    expect(formatTokens(1234)).toBe("1.2k");
    expect(formatTokens(45_000)).toBe("45k");
    expect(formatTokens(1_200_000)).toBe("1.2M");
    expect(formatTokens(8000)).toBe("8k");
    expect(formatTokens(2_000_000)).toBe("2M");
    expect(formatTokens(12_000_000)).toBe("12M");
  });

  it("does not produce nonsense from bad input", () => {
    expect(formatTokens(-5)).toBe("0");
    expect(formatTokens(NaN)).toBe("0");
  });
});

describe("formatCost", () => {
  it("distinguishes free, negligible and real", () => {
    expect(formatCost(0)).toBe("$0.00");
    expect(formatCost(0.004)).toBe("<$0.01");
    expect(formatCost(1.239)).toBe("$1.24");
  });

  it("returns null when the provider reported nothing", () => {
    expect(formatCost(null)).toBeNull();
    expect(formatCost(undefined)).toBeNull();
    expect(formatCost(NaN)).toBeNull();
  });
});

function payload(over: Partial<UsagePayload> = {}): UsagePayload {
  return {
    sessionId: "s1",
    turn: {
      input: 0,
      output: 0,
      cacheRead: 0,
      cacheWrite: 0,
      totalTokens: 0,
    },
    total: {
      input: 2000,
      output: 500,
      cacheRead: 8000,
      cacheWrite: 100,
      totalTokens: 10_500,
      costTotal: 0.42,
    },
    cacheHitRate: 0.8,
    ...over,
  };
}

describe("cacheChipView", () => {
  it("summarises a measured session", () => {
    const v = cacheChipView(payload())!;
    expect(v.rateLabel).toBe("80%");
    expect(v.standing).toBe("good");
    expect(v.promptTokens).toBe("10k"); // input + cacheRead
    expect(v.cachedTokens).toBe("8k");
    expect(v.outputTokens).toBe("500");
    expect(v.costLabel).toBe("$0.42");
  });

  /**
   * Before the first billed turn there is nothing to report, and a "0%" badge
   * would read as a cache that is failing rather than one not yet exercised.
   */
  it("shows nothing until prompt tokens have been measured", () => {
    expect(cacheChipView(null)).toBeNull();
    expect(cacheChipView(payload({ cacheHitRate: null }))).toBeNull();
  });

  /**
   * Switching chats must not leave the previous one's numbers on screen. The
   * guard lives here so no navigation path can forget to clear state.
   */
  it("hides figures that belong to a different session", () => {
    expect(cacheChipView(payload(), "s1")).not.toBeNull();
    expect(cacheChipView(payload(), "other")).toBeNull();
    expect(cacheChipView(payload(), null)).toBeNull();
    // Omitting the argument keeps the unguarded behaviour for callers that
    // have already narrowed by session.
    expect(cacheChipView(payload())).not.toBeNull();
  });

  it("reports a genuinely cold cache rather than hiding it", () => {
    const v = cacheChipView(
      payload({
        cacheHitRate: 0,
        total: {
          input: 5000,
          output: 100,
          cacheRead: 0,
          cacheWrite: 0,
          totalTokens: 5100,
          costTotal: null,
        },
      }),
    )!;
    expect(v.rateLabel).toBe("0%");
    expect(v.standing).toBe("cold");
    expect(v.costLabel).toBeNull();
  });
});

describe("cacheNote", () => {
  /** A turn whose figures are the whole session total — i.e. the first one. */
  function firstTurn(input: number, cacheRead: number): UsagePayload {
    const usage = {
      input,
      output: 20,
      cacheRead,
      cacheWrite: 0,
      totalTokens: input + cacheRead + 20,
    };
    return {
      sessionId: "s1",
      turn: usage,
      total: { ...usage },
      cacheHitRate: cacheRead / (input + cacheRead),
    };
  }

  /** A later turn: the session total already carries earlier turns. */
  function laterTurn(
    input: number,
    cacheRead: number,
    over: Partial<UsagePayload> = {},
  ): UsagePayload {
    const usage = {
      input,
      output: 20,
      cacheRead,
      cacheWrite: 0,
      totalTokens: input + cacheRead + 20,
    };
    return {
      sessionId: "s1",
      turn: usage,
      total: {
        ...usage,
        input: input + 15_000,
        cacheRead: cacheRead + 40_000,
        totalTokens: 0,
      },
      cacheHitRate: cacheRead / (input + cacheRead),
      ...over,
    };
  }

  /**
   * The regression this whole lint exists for. Measuring first turns over and
   * over is how a healthy session-keyed provider looks like one that never
   * caches — xAI routes on `prompt_cache_key`, so a fresh chat starts on a cold
   * server, and the next turns in that same chat reused over 99%.
   */
  it("calls a cold first turn the cost of opening a session, not a fault", () => {
    const note = cacheNote(null, firstTurn(15_057, 0));
    expect(note).toEqual({ kind: "opening" });
  });

  it("says nothing when the first turn is already warm", () => {
    // A prefix-caching provider can hit on turn one; that needs no excuse.
    expect(cacheNote(null, firstTurn(394, 10_496))).toBeNull();
  });

  /** Opening is checked first, so a cold turn one is never blamed on a switch. */
  it("does not blame a model switch for the first turn being cold", () => {
    const previous = laterTurn(100, 9000, { modelId: "a" });
    const note = cacheNote(previous, {
      ...firstTurn(15_057, 0),
      modelId: "b",
    });
    expect(note).toEqual({ kind: "opening" });
  });

  it("blames a sharp drop on the model switch that caused it", () => {
    const previous = laterTurn(1000, 9000, { modelId: "a" });
    const current = laterTurn(9000, 1000, { modelId: "b" });
    expect(cacheNote(previous, current)).toEqual({
      kind: "broken",
      cause: "model",
    });
  });

  it("flags a session that is still cold several turns in", () => {
    const previous = laterTurn(9000, 500);
    expect(cacheNote(previous, laterTurn(9000, 400))).toEqual({
      kind: "notEngaging",
    });
  });

  it("stays quiet on a healthy warm session", () => {
    const previous = laterTurn(500, 9500);
    expect(cacheNote(previous, laterTurn(400, 9600))).toBeNull();
  });

  it("says nothing before anything has been measured", () => {
    expect(
      cacheNote(null, { ...firstTurn(0, 0), cacheHitRate: null }),
    ).toBeNull();
  });

  it("maps each note to its own message", () => {
    expect(cacheNoteKey({ kind: "opening" })).toBe("cache.note.opening");
    expect(cacheNoteKey({ kind: "notEngaging" })).toBe("cache.note.notEngaging");
    expect(cacheNoteKey({ kind: "broken", cause: "model" })).toBe(
      "cache.break.model",
    );
  });
});
