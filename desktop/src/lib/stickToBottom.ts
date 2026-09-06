/**
 * Chat scroll "stick to bottom" helpers.
 *
 * While the user is following, new content keeps the viewport pinned.
 * After an intentional scroll-up (`escaped`), we do NOT re-pin merely
 * because the viewport is still within the near-bottom threshold — that
 * thrash is what makes the chat bounce while the user is reading.
 * Re-pin only after they scroll down again and land near the bottom,
 * send a message, or switch conversation.
 */

/** Distance from bottom (px) still treated as "near" for re-engage. */
export const STICK_TO_BOTTOM_THRESHOLD_PX = 100;

/**
 * Sub-pixel / font / thought-stream reflows under this delta should not
 * force a scroll follow (avoids up-down flicker while thinking grows).
 */
export const STICK_HEIGHT_NOISE_PX = 4;

export function distanceFromBottom(
  scrollTop: number,
  scrollHeight: number,
  clientHeight: number,
): number {
  return Math.max(0, scrollHeight - clientHeight - scrollTop);
}

/** True when viewport is close enough to the bottom to re-engage follow. */
export function isNearBottom(
  scrollTop: number,
  scrollHeight: number,
  clientHeight: number,
  thresholdPx: number = STICK_TO_BOTTOM_THRESHOLD_PX,
): boolean {
  // No overflow → always "at bottom"
  if (scrollHeight <= clientHeight + 1) return true;
  return distanceFromBottom(scrollTop, scrollHeight, clientHeight) <= thresholdPx;
}

/** Target scrollTop that parks the viewport at the bottom. */
export function bottomScrollTop(
  scrollHeight: number,
  clientHeight: number,
): number {
  return Math.max(0, scrollHeight - clientHeight);
}

/** True when a content-height delta is noise and should not re-follow. */
export function isHeightDeltaNoise(
  difference: number,
  noisePx: number = STICK_HEIGHT_NOISE_PX,
): boolean {
  return Math.abs(difference) < noisePx;
}

/** Pin + escape lock used by the chat scroll hook. */
export type StickPinState = {
  /** Auto-follow content growth. */
  pinned: boolean;
  /** User intentionally left the bottom; blocks threshold re-pin. */
  escaped: boolean;
};

/**
 * Pure transition for scroll-driven pin updates.
 * Direction is from user scroll (not programmatic follows).
 */
export function nextStickPinState(
  state: StickPinState,
  input: {
    scrollingUp: boolean;
    scrollingDown: boolean;
    nearBottom: boolean;
  },
): StickPinState {
  let { pinned, escaped } = state;
  if (input.scrollingUp) {
    escaped = true;
    pinned = false;
  }
  if (input.scrollingDown) {
    escaped = false;
  }
  if (!escaped && input.nearBottom) {
    pinned = true;
  }
  return { pinned, escaped };
}
