/**
 * Adaptive smooth-stream reveal math.
 *
 * Network chunks often arrive in irregular bursts. We keep a display head
 * behind the true target and advance it every frame: drip when the backlog
 * is small, catch up hard when the model dumps a large chunk so we never
 * lag seconds behind a fast stream.
 */

/** How many code units to reveal given current backlog size. */
export function charsToReveal(backlog: number): number {
  if (backlog <= 0) return 0;
  if (backlog <= 3) return 1;
  if (backlog <= 12) return 2;
  if (backlog <= 32) return 4;
  if (backlog <= 80) return 8;
  if (backlog <= 160) return 16;
  // Larger backlogs: proportional catch-up, never crawl through a dump.
  // ~45%/step → multi-KB bursts clear in ~15 frames (~250ms at 60fps).
  return Math.max(24, Math.ceil(backlog * 0.45));
}

/** Next display length after one reveal step. */
export function nextDisplayedLength(
  currentLen: number,
  targetLen: number,
): number {
  if (currentLen >= targetLen) return targetLen;
  if (currentLen < 0) return 0;
  return Math.min(
    targetLen,
    currentLen + charsToReveal(targetLen - currentLen),
  );
}

/**
 * Advance displayed text one step toward target.
 * If target no longer starts with displayed (message swap), snap to target.
 */
export function stepDisplayed(displayed: string, target: string): string {
  if (!target) return "";
  if (!displayed) {
    const n = charsToReveal(target.length);
    return target.slice(0, n);
  }
  if (!target.startsWith(displayed)) {
    // Content replaced (session switch / new turn) — snap.
    return target;
  }
  if (displayed.length >= target.length) return target;
  return target.slice(0, nextDisplayedLength(displayed.length, target.length));
}
