/**
 * Scheduled pull-request sweeps.
 *
 * A PR automation watches a repository instead of running a fixed prompt: when
 * it fires it looks at the open pull requests and hands the agent the ones it
 * has not seen before.
 *
 * "Not seen before" is the whole point. A daily sweep that re-reviews the same
 * five PRs every morning is worse than useless — it burns tokens and trains the
 * user to ignore it.
 */

import type { GhPullRequest } from "@/lib/api";

export const PR_SEEN_STORAGE_KEY = "pi-app.pr-seen";

/** Per-automation record of pull requests already handed to the agent. */
export type SeenPrs = Record<string, number[]>;

export interface SeenStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

export function loadSeenPrs(storage: SeenStorage): SeenPrs {
  let raw: unknown;
  try {
    raw = JSON.parse(storage.getItem(PR_SEEN_STORAGE_KEY) || "null");
  } catch {
    return {};
  }
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return {};
  const out: SeenPrs = {};
  for (const [id, list] of Object.entries(raw as Record<string, unknown>)) {
    if (!Array.isArray(list)) continue;
    const numbers = list.filter(
      (n): n is number => typeof n === "number" && Number.isSafeInteger(n) && n > 0,
    );
    if (numbers.length > 0) out[id] = numbers;
  }
  return out;
}

export function saveSeenPrs(storage: SeenStorage, seen: SeenPrs): void {
  try {
    storage.setItem(PR_SEEN_STORAGE_KEY, JSON.stringify(seen));
  } catch {
    // Private mode / quota: the sweep still runs, it just repeats itself.
  }
}

/**
 * Pull requests this automation has not handled yet.
 *
 * Drafts are skipped: a sweep that reviews work in progress interrupts the
 * author rather than helping them.
 */
export function unseenPulls(
  pulls: GhPullRequest[],
  seen: SeenPrs,
  automationId: string,
): GhPullRequest[] {
  const known = new Set(seen[automationId] ?? []);
  return pulls.filter((p) => !p.isDraft && !known.has(p.number));
}

/**
 * Record numbers as handled, keeping the list bounded.
 *
 * Only open PRs are ever compared against it, so an unbounded history would
 * grow forever to answer a question about a shrinking set.
 */
export function markPullsSeen(
  seen: SeenPrs,
  automationId: string,
  numbers: number[],
  limit = 200,
): SeenPrs {
  const merged = [...(seen[automationId] ?? []), ...numbers];
  const unique = [...new Set(merged)].sort((a, b) => a - b);
  const kept = unique.slice(Math.max(0, unique.length - limit));
  return { ...seen, [automationId]: kept };
}

/**
 * Prompt for a sweep run.
 *
 * Lists the pull requests and states the task once, rather than fetching every
 * diff up front: the agent can pull the ones it needs, and a repository with
 * twenty open PRs would otherwise blow the context window before it started.
 */
export function buildPrSweepPrompt(
  repo: string,
  pulls: GhPullRequest[],
  extraInstructions?: string,
): string {
  const lines = pulls.map(
    (p) => `- #${p.number} — ${p.title} (${p.headRef} → ${p.baseRef}, by ${p.author})`,
  );
  const body = [
    `New pull requests in ${repo}:`,
    "",
    ...lines,
    "",
    "For each one: read the diff, then report anything that would break at",
    "runtime, weaken security, or mislead a reader. Give the file and line.",
    "Say plainly when a pull request looks fine — do not invent nits.",
  ];
  const extra = (extraInstructions || "").trim();
  if (extra) {
    body.push("", "Additional instructions from the user:", extra);
  }
  return body.join("\n");
}

/** True when this automation watches a repository rather than a project. */
export function isPrAutomation(automation: { repo?: string | null }): boolean {
  return !!(automation.repo || "").trim();
}
