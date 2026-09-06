/**
 * Context usage chip — pure token format + state for honest UX.
 *
 * Token estimate heuristic (when the agent has not reported counts):
 *   tokens ≈ ceil(visibleChars / 4)
 * where visibleChars sums user + assistant body (+ thought) only.
 * Tool / marker rows are skipped.
 *
 * Host journal is **not** rewritten on compact (UI history stays full).
 * After a compact without `tokensAfter`, we therefore show "—" rather than
 * re-estimating from the full transcript (that would overstate agent context).
 * When `tokensAfter` is known, later growth is estimated only from messages
 * after that compact marker and the chip is marked estimated (`~`).
 */

export type ContextUsageSource = "known" | "estimated" | "unknown";

export interface LastCompactSummary {
  trigger: string;
  tokensBefore?: number;
  tokensAfter?: number;
  summaryPreview?: string;
  note?: string;
  messageId?: string;
}

export interface ContextUsageState {
  /** Absolute tokens from last agent compact event (`tokensAfter`). */
  knownTokens: number | null;
  /** Message id of the last compact marker (for post-compact delta). */
  lastCompactMessageId: string | null;
  lastCompact: LastCompactSummary | null;
}

export const INITIAL_CONTEXT_USAGE: ContextUsageState = {
  knownTokens: null,
  lastCompactMessageId: null,
  lastCompact: null,
};

export type ContextUsageMessage = {
  id: string;
  role: string;
  content?: string;
  thought?: string;
  marker?: string;
  compactMeta?: {
    trigger?: string;
    tokensBefore?: number;
    tokensAfter?: number;
    summaryPreview?: string;
    note?: string;
  } | null;
};

export type ContextUsageAction =
  | { type: "reset" }
  | {
      type: "compact";
      tokensBefore?: number;
      tokensAfter?: number;
      trigger?: string;
      summaryPreview?: string;
      note?: string;
      messageId?: string;
    }
  | { type: "hydrate"; messages: ContextUsageMessage[] }
  /**
   * Exact prompt size reported by the provider for the turn just finished.
   *
   * `input + cacheRead` is what the context window actually held, whether or
   * not those tokens were billed at full price — a cached token still occupies
   * the window. This supersedes the chars/4 estimate for as long as it holds.
   */
  | { type: "measured"; promptTokens: number; messageId?: string };

function finiteToken(n: number | undefined | null): number | undefined {
  if (n == null || !Number.isFinite(n) || n < 0) return undefined;
  return Math.floor(n);
}

export function reduceContextUsage(
  state: ContextUsageState,
  action: ContextUsageAction,
): ContextUsageState {
  switch (action.type) {
    case "reset":
      return { ...INITIAL_CONTEXT_USAGE };
    case "compact": {
      const tokensAfter = finiteToken(action.tokensAfter);
      const tokensBefore = finiteToken(action.tokensBefore);
      const trigger = (action.trigger || "auto").toLowerCase();
      // Only keep absolute known tokens when this event reports tokensAfter.
      // A compact without counts invalidates the previous absolute figure.
      return {
        knownTokens: tokensAfter ?? null,
        lastCompactMessageId:
          action.messageId ?? state.lastCompactMessageId,
        lastCompact: {
          trigger:
            trigger === "manual"
              ? "manual"
              : trigger === "auto"
                ? "auto"
                : trigger,
          tokensBefore,
          tokensAfter,
          summaryPreview: action.summaryPreview,
          note: action.note,
          messageId: action.messageId,
        },
      };
    }
    case "measured": {
      const measured = finiteToken(action.promptTokens);
      // A malformed figure must not discard a good one already held.
      if (measured === undefined) return state;
      return {
        ...state,
        knownTokens: measured,
        // The measurement covers everything up to here, so post-compact
        // growth must be counted from this point, not the old marker.
        lastCompactMessageId: action.messageId ?? state.lastCompactMessageId,
      };
    }
    case "hydrate":
      return hydrateContextUsageFromMessages(action.messages);
    default:
      return state;
  }
}

/** Scan history for the latest compact marker (session open / switch). */
export function hydrateContextUsageFromMessages(
  messages: ContextUsageMessage[],
): ContextUsageState {
  for (let i = messages.length - 1; i >= 0; i--) {
    const m = messages[i]!;
    const isCompact =
      m.marker === "context_compact" ||
      (m.role === "tool" &&
        (m.content?.startsWith("context_compact") || !!m.compactMeta));
    if (!isCompact) continue;
    const meta = m.compactMeta;
    const tokensAfter = finiteToken(meta?.tokensAfter);
    const tokensBefore = finiteToken(meta?.tokensBefore);
    const trigger = (meta?.trigger || "auto").toLowerCase();
    return {
      knownTokens: tokensAfter ?? null,
      lastCompactMessageId: m.id,
      lastCompact: {
        trigger:
          trigger === "manual"
            ? "manual"
            : trigger === "auto"
              ? "auto"
              : trigger,
        tokensBefore,
        tokensAfter,
        summaryPreview: meta?.summaryPreview,
        note: meta?.note,
        messageId: m.id,
      },
    };
  }
  return { ...INITIAL_CONTEXT_USAGE };
}

/**
 * Rough token estimate: ~4 characters per token (English-biased).
 * Not a model tokenizer — chip uses `~` when this path is taken.
 */
export function estimateTokensFromText(text: string): number {
  const n = text.length;
  if (n <= 0) return 0;
  return Math.ceil(n / 4);
}

/** True for rows excluded from visible-chat token estimates. */
function isSkippedContextMessage(m: ContextUsageMessage): boolean {
  return (
    m.marker === "context_compact" ||
    m.marker === "tool_step" ||
    m.marker === "turn_cancelled" ||
    m.role === "tool"
  );
}

/** Sum visible chat text (user/assistant content + thought); skip tools/markers. */
export function estimateTokensFromMessages(
  messages: ContextUsageMessage[],
): number {
  let chars = 0;
  for (const m of messages) {
    if (isSkippedContextMessage(m)) continue;
    chars += (m.content || "").length;
    chars += (m.thought || "").length;
  }
  if (chars <= 0) return 0;
  return Math.ceil(chars / 4);
}

/**
 * Rough role breakdown of visible chat (same ~4 chars/token heuristic).
 * Always estimated — never model tokenizer output.
 * User content → user; assistant body → assistant; thought/reasoning → thought.
 */
export interface ContextUsageBreakdown {
  userTokens: number;
  assistantTokens: number;
  thoughtTokens: number;
  /** Sum of the three role estimates (each ceil'd independently). */
  totalTokens: number;
  /** Always true for this heuristic path. */
  estimated: true;
}

export function estimateContextBreakdown(
  messages: ContextUsageMessage[],
): ContextUsageBreakdown {
  let userChars = 0;
  let assistantChars = 0;
  let thoughtChars = 0;
  for (const m of messages) {
    if (isSkippedContextMessage(m)) continue;
    const contentLen = (m.content || "").length;
    const thoughtLen = (m.thought || "").length;
    if (m.role === "user") {
      userChars += contentLen;
      // Rare thought on user rows still counts as thought if present.
      thoughtChars += thoughtLen;
    } else {
      // assistant (and any other non-tool visible role)
      assistantChars += contentLen;
      thoughtChars += thoughtLen;
    }
  }
  const userTokens = userChars <= 0 ? 0 : Math.ceil(userChars / 4);
  const assistantTokens =
    assistantChars <= 0 ? 0 : Math.ceil(assistantChars / 4);
  const thoughtTokens = thoughtChars <= 0 ? 0 : Math.ceil(thoughtChars / 4);
  return {
    userTokens,
    assistantTokens,
    thoughtTokens,
    totalTokens: userTokens + assistantTokens + thoughtTokens,
    estimated: true,
  };
}

/** Compact token display: 999 / 1.2k / 12k / 1.5M */
export function formatTokenCount(n: number): string {
  if (!Number.isFinite(n) || n < 0) return "—";
  if (n >= 1_000_000) {
    const v = n / 1_000_000;
    return `${v >= 10 ? Math.round(v) : v.toFixed(1).replace(/\.0$/, "")}M`;
  }
  if (n >= 10_000) return `${Math.round(n / 1000)}k`;
  if (n >= 1000) {
    const v = n / 1000;
    return `${v.toFixed(1).replace(/\.0$/, "")}k`;
  }
  return String(Math.round(n));
}

export function formatContextChipLabel(
  tokens: number | null,
  source: ContextUsageSource,
): string {
  if (tokens == null || source === "unknown") return "—";
  const f = formatTokenCount(tokens);
  return source === "estimated" ? `~${f}` : f;
}

export interface ContextUsageDisplay {
  tokens: number | null;
  source: ContextUsageSource;
  /** Chip primary label: "42k", "~12k", or "—" */
  label: string;
  lastCompact: LastCompactSummary | null;
  /**
   * Role split of visible chat (chars/4). Always heuristic when present.
   * Null when there is no visible content to attribute.
   */
  breakdown: ContextUsageBreakdown | null;
  windowTokens?: number;
  windowPercent?: number;
}

function breakdownOrNull(
  messages: ContextUsageMessage[],
): ContextUsageBreakdown | null {
  const b = estimateContextBreakdown(messages);
  if (b.totalTokens <= 0) return null;
  return b;
}

/**
 * Resolve what the chip should show from reducer state + live messages.
 */
export function resolveContextUsageDisplay(
  state: ContextUsageState,
  messages: ContextUsageMessage[],
  windowTokens?: number,
): ContextUsageDisplay {
  const lastCompact = state.lastCompact;
  // Breakdown always from full visible transcript (host history not rewritten).
  const breakdown = breakdownOrNull(messages);

  if (state.knownTokens != null) {
    let delta = 0;
    if (state.lastCompactMessageId) {
      const idx = messages.findIndex(
        (m) => m.id === state.lastCompactMessageId,
      );
      if (idx >= 0) {
        delta = estimateTokensFromMessages(messages.slice(idx + 1));
      } else {
        // Marker not in list yet — still show known base.
        delta = 0;
      }
    }
    const tokens = state.knownTokens + delta;
    const source: ContextUsageSource = delta > 0 ? "estimated" : "known";
    return {
      tokens,
      source,
      label: formatContextChipLabel(tokens, source),
      lastCompact,
      breakdown,
      windowTokens,
      windowPercent: windowTokens
        ? Math.min(100, Math.round((tokens / windowTokens) * 100))
        : undefined,
    };
  }

  // Compact happened without token counts — do not trust full UI history.
  if (lastCompact) {
    return {
      tokens: null,
      source: "unknown",
      label: formatContextChipLabel(null, "unknown"),
      lastCompact,
      // Still surface visible role split as estimated (honest ~).
      breakdown,
      windowTokens,
    };
  }

  // Never compacted: rough estimate from visible transcript (or unknown empty).
  const estimated = estimateTokensFromMessages(messages);
  if (estimated <= 0) {
    return {
      tokens: null,
      source: "unknown",
      label: formatContextChipLabel(null, "unknown"),
      lastCompact: null,
      breakdown: null,
      windowTokens,
    };
  }
  return {
    tokens: estimated,
    source: "estimated",
    label: formatContextChipLabel(estimated, "estimated"),
    lastCompact: null,
    breakdown,
  };
}
