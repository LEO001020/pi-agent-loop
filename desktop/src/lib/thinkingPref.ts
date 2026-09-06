/**
 * User preference for whether completed thinking/reasoning blocks stay expanded.
 * Live streaming still auto-opens; when the turn finishes we collapse unless
 * the user prefers expanded.
 */

const STORAGE_KEY = "pi.thinkingExpanded";

export type ThinkingExpandPref = "auto-collapse" | "keep-open";

export function loadThinkingExpandPref(
  storage: Storage = localStorage,
): ThinkingExpandPref {
  try {
    const v = storage.getItem(STORAGE_KEY);
    if (v === "keep-open") return "keep-open";
    if (v === "auto-collapse") return "auto-collapse";
  } catch {
    /* private mode */
  }
  // Default: collapse when done (community request — focus on the answer).
  return "auto-collapse";
}

export function saveThinkingExpandPref(
  pref: ThinkingExpandPref,
  storage: Storage = localStorage,
): void {
  try {
    storage.setItem(STORAGE_KEY, pref);
  } catch {
    /* ignore */
  }
}

/** Whether a finished thought block should start open. */
export function thinkingDefaultOpenWhenDone(
  pref: ThinkingExpandPref = loadThinkingExpandPref(),
): boolean {
  return pref === "keep-open";
}
