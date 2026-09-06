/**
 * Presenting the real token usage Pi reports.
 *
 * The host emits `session://usage` with the turn, a running session total and
 * a cache hit rate. This module decides what is worth showing — pure, so the
 * judgement calls are testable without a running agent.
 */

export type TokenUsage = {
  input: number;
  output: number;
  cacheRead: number;
  cacheWrite: number;
  totalTokens: number;
  costTotal?: number | null;
};

export type UsagePayload = {
  sessionId: string;
  modelId?: string | null;
  turn: TokenUsage;
  total: TokenUsage;
  /** `0..1`, or null when no prompt tokens have been counted yet. */
  cacheHitRate: number | null;
};

export type CacheBreakCause = "model" | "attachments" | "prompt" | "unknown";

/**
 * Explain a material cache-rate drop without pretending the provider exposes
 * its cache key. The caller supplies the few local signals the shell can know.
 */
export function cacheBreakCause(
  previous: UsagePayload | null,
  current: UsagePayload,
  signals: { attachmentsChanged?: boolean; promptChanged?: boolean } = {},
): CacheBreakCause | null {
  if (!previous || previous.sessionId !== current.sessionId) return null;
  const previousRate = previous.cacheHitRate;
  const currentRate = current.cacheHitRate;
  if (previousRate == null || currentRate == null || previousRate - currentRate < 0.25) {
    return null;
  }
  if (previous.modelId && current.modelId && previous.modelId !== current.modelId) {
    return "model";
  }
  if (signals.attachmentsChanged) return "attachments";
  if (signals.promptChanged) return "prompt";
  return "unknown";
}

/**
 * What the chip should say about the rate beyond the number itself.
 *
 * - `opening` — first measured turn of a session. Cold here is structural, not
 *   a fault, and saying so is the whole point of this lint.
 * - `broken`  — it was warm and dropped sharply; `cause` names the suspect.
 * - `notEngaging` — several turns in and still cold, which is worth looking at.
 */
export type CacheNote =
  | { kind: "opening" }
  | { kind: "broken"; cause: CacheBreakCause }
  | { kind: "notEngaging" };

/**
 * True when this payload is the session's first measured turn.
 *
 * The running total equals the turn when nothing has been folded into it yet,
 * so no extra plumbing — no turn counter threaded through the host — is needed
 * to know it.
 */
function isFirstMeasuredTurn(payload: UsagePayload): boolean {
  const turn = payload.turn.input + payload.turn.cacheRead;
  const total = payload.total.input + payload.total.cacheRead;
  return turn > 0 && turn === total;
}

/**
 * Explain a cache rate the user would otherwise misread.
 *
 * This exists because the misreading is real and expensive: a first turn shows
 * near-0% on any provider that keys its cache per session — xAI routes on
 * `prompt_cache_key`, so a fresh session lands on a cold server by design — and
 * the chip's "cold" band makes that look like a broken channel. Measuring first
 * turns repeatedly is precisely how one concludes a healthy provider never
 * caches, when the next three turns in the same session reuse over 99%.
 *
 * Order matters. `opening` is checked before `broken` so the first turn of a
 * session is never blamed on a model switch that also happened to occur.
 *
 * Returns `null` when the figures speak for themselves.
 */
export function cacheNote(
  previous: UsagePayload | null,
  current: UsagePayload,
  signals: { attachmentsChanged?: boolean; promptChanged?: boolean } = {},
): CacheNote | null {
  const rate = current.cacheHitRate;
  if (rate === null) return null;

  if (isFirstMeasuredTurn(current)) {
    return cacheStanding(rate) === "cold" ? { kind: "opening" } : null;
  }

  const cause = cacheBreakCause(previous, current, signals);
  if (cause) return { kind: "broken", cause };

  return cacheStanding(rate) === "cold" ? { kind: "notEngaging" } : null;
}

/** i18n key for a note, so the caller does not rebuild the mapping. */
export function cacheNoteKey(note: CacheNote): string {
  return note.kind === "broken"
    ? `cache.break.${note.cause}`
    : `cache.note.${note.kind}`;
}

/** How the chip should read the rate. */
export type CacheStanding = "cold" | "warming" | "good";

/**
 * Classify a hit rate.
 *
 * The bands are about cost, not neatness. Below a third, the cache is barely
 * paying for itself; past two thirds a long session is cheap. The middle is
 * genuinely "it depends", so it gets its own, non-alarming label.
 */
export function cacheStanding(rate: number): CacheStanding {
  if (rate < 0.34) return "cold";
  if (rate < 0.67) return "warming";
  return "good";
}

/** Whole-percent rate for display; never rounds a real hit down to 0%. */
export function formatCacheRate(rate: number): string {
  const pct = rate * 100;
  if (pct > 0 && pct < 1) return "<1%";
  if (pct < 100 && pct > 99) return ">99%";
  return `${Math.round(pct)}%`;
}

/**
 * Compact token count: 1_234 → "1.2k", 1_200_000 → "1.2M".
 *
 * The chip has one line; an exact count of 1,234,567 would push everything
 * else off it.
 */
export function formatTokens(n: number): string {
  if (!Number.isFinite(n) || n < 0) return "0";
  if (n < 1000) return String(Math.round(n));
  // One decimal below ten, none above — and never a bare ".0", which reads
  // as spurious precision on a round number.
  const short = (v: number) =>
    v < 10 ? v.toFixed(1).replace(/\.0$/, "") : String(Math.round(v));
  if (n < 1_000_000) return `${short(n / 1000)}k`;
  return `${short(n / 1_000_000)}M`;
}

/** Provider cost, or null when they did not report one. */
export function formatCost(cost: number | null | undefined): string | null {
  if (cost === null || cost === undefined || !Number.isFinite(cost)) return null;
  if (cost === 0) return "$0.00";
  if (cost < 0.01) return "<$0.01";
  return `$${cost.toFixed(2)}`;
}

export type CacheChipView = {
  rateLabel: string;
  standing: CacheStanding;
  promptTokens: string;
  cachedTokens: string;
  outputTokens: string;
  costLabel: string | null;
};

/**
 * Everything the chip renders, or `null` when there is nothing honest to say.
 *
 * A session with no measured prompt tokens shows no chip at all: a "0%" badge
 * before the first billed turn would read as a cache that is failing, when in
 * fact nothing has been measured.
 *
 * `viewedSessionId` guards against showing one chat's figures while another is
 * open. Enforcing it here rather than by clearing state at every switch means
 * a new navigation path cannot forget to do it and leave stale numbers on
 * screen — silently wrong is worse than absent.
 */
export function cacheChipView(
  payload: UsagePayload | null,
  viewedSessionId?: string | null,
): CacheChipView | null {
  if (!payload) return null;
  if (
    viewedSessionId !== undefined &&
    payload.sessionId !== (viewedSessionId ?? "")
  ) {
    return null;
  }
  const { total, cacheHitRate } = payload;
  if (cacheHitRate === null) return null;

  return {
    rateLabel: formatCacheRate(cacheHitRate),
    standing: cacheStanding(cacheHitRate),
    promptTokens: formatTokens(total.input + total.cacheRead),
    cachedTokens: formatTokens(total.cacheRead),
    outputTokens: formatTokens(total.output),
    costLabel: formatCost(total.costTotal),
  };
}
