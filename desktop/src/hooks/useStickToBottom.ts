/**
 * Keep a scroll viewport pinned to the bottom while the user is following,
 * and release pin after they scroll up (wheel / touch / scrollbar).
 *
 * Pin model mirrors use-stick-to-bottom's escapedFromLock:
 * - User scroll-up escapes; we do NOT re-pin merely because they are still
 *   within the near-bottom threshold (that thrash is what causes bounce).
 * - Re-pin only after they scroll down again and land near the bottom,
 *   or after force-stick / conversation switch.
 * - Programmatic follows are instant and ignored by the scroll handler so
 *   resize + stream growth cannot fight the user mid-gesture.
 */

import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type RefObject,
  type UIEvent,
} from "react";
import {
  STICK_TO_BOTTOM_THRESHOLD_PX,
  bottomScrollTop,
  isHeightDeltaNoise,
  isNearBottom,
  nextStickPinState,
} from "@/lib/stickToBottom";

export type UseStickToBottomOptions = {
  /** Re-pin when the conversation identity changes (session / first message). */
  conversationKey?: string | number | null;
  /** Force re-pin (e.g. user just sent a message). */
  forceStickKey?: string | number | null;
  /** px from bottom still considered "near" for re-engage. Default 100. */
  thresholdPx?: number;
  enabled?: boolean;
};

export type UseStickToBottomResult = {
  viewportRef: RefObject<HTMLDivElement | null>;
  /** Optional: attach to the content column for more accurate resize observe. */
  contentRef: RefObject<HTMLDivElement | null>;
  onScroll: (e: UIEvent<HTMLDivElement>) => void;
  scrollToBottom: (behavior?: ScrollBehavior) => void;
  /** True while auto-follow is active (ref, not reactive). */
  isPinnedRef: RefObject<boolean>;
  /** Reactive: show "back to bottom" control when user has scrolled up. */
  showBack: boolean;
};

export function useStickToBottom(
  options: UseStickToBottomOptions = {},
): UseStickToBottomResult {
  const {
    conversationKey = null,
    forceStickKey = null,
    thresholdPx = STICK_TO_BOTTOM_THRESHOLD_PX,
    enabled = true,
  } = options;

  const viewportRef = useRef<HTMLDivElement | null>(null);
  const contentRef = useRef<HTMLDivElement | null>(null);
  /** Auto-follow stream / growth. */
  const isPinnedRef = useRef(true);
  /**
   * User intentionally left the bottom. Stays true until they scroll down
   * (or force-stick). Prevents re-pin while still inside the near threshold.
   */
  const escapedRef = useRef(false);
  const lastScrollTopRef = useRef(0);
  /** scrollTop we just wrote — used to ignore synthetic scroll events. */
  const ignoreScrollTopRef = useRef<number | undefined>(undefined);
  /** Non-zero while a content resize is being applied (race with scroll). */
  const resizeDifferenceRef = useRef(0);
  const thresholdRef = useRef(thresholdPx);
  thresholdRef.current = thresholdPx;
  const enabledRef = useRef(enabled);
  enabledRef.current = enabled;

  const [showBack, setShowBack] = useState(false);

  const syncShowBack = useCallback(() => {
    const el = viewportRef.current;
    if (!el) {
      setShowBack(false);
      return;
    }
    const overflow = el.scrollHeight > el.clientHeight + 40;
    setShowBack(!isPinnedRef.current && overflow);
  }, []);

  const applyScrollTop = useCallback((top: number) => {
    const el = viewportRef.current;
    if (!el) return;
    if (Math.abs(el.scrollTop - top) < 1) {
      ignoreScrollTopRef.current = el.scrollTop;
      return;
    }
    // Force instant assignment even if CSS scroll-behavior is smooth.
    const prev = el.style.scrollBehavior;
    el.style.scrollBehavior = "auto";
    el.scrollTop = top;
    ignoreScrollTopRef.current = el.scrollTop;
    lastScrollTopRef.current = el.scrollTop;
    if (prev) el.style.scrollBehavior = prev;
    else el.style.removeProperty("scroll-behavior");
  }, []);

  const scrollToBottom = useCallback(
    (behavior: ScrollBehavior = "instant") => {
      const el = viewportRef.current;
      if (!el) return;
      escapedRef.current = false;
      isPinnedRef.current = true;
      const top = bottomScrollTop(el.scrollHeight, el.clientHeight);
      if (behavior === "smooth" && typeof el.scrollTo === "function") {
        // Smooth is only for the explicit "back to bottom" button.
        // Mark ignore with the target so intermediate events don't re-escape.
        ignoreScrollTopRef.current = top;
        el.scrollTo({ top, behavior: "smooth" });
        // Snap pin state; showBack clears once we land near bottom via scroll.
        const start = performance.now();
        const tick = () => {
          if (!viewportRef.current) return;
          const near = isNearBottom(
            viewportRef.current.scrollTop,
            viewportRef.current.scrollHeight,
            viewportRef.current.clientHeight,
            thresholdRef.current,
          );
          if (near || performance.now() - start > 600) {
            applyScrollTop(
              bottomScrollTop(
                viewportRef.current.scrollHeight,
                viewportRef.current.clientHeight,
              ),
            );
            isPinnedRef.current = true;
            escapedRef.current = false;
            syncShowBack();
            return;
          }
          requestAnimationFrame(tick);
        };
        requestAnimationFrame(tick);
      } else {
        applyScrollTop(top);
      }
      syncShowBack();
    },
    [applyScrollTop, syncShowBack],
  );

  const followIfPinned = useCallback(() => {
    if (!isPinnedRef.current || !enabledRef.current) return;
    const el = viewportRef.current;
    if (!el) return;
    applyScrollTop(bottomScrollTop(el.scrollHeight, el.clientHeight));
  }, [applyScrollTop]);

  // React onScroll is a no-op passthrough — real logic is on native listeners
  // so we never miss passive wheel/scroll during streaming.
  const onScroll = useCallback((_e: UIEvent<HTMLDivElement>) => {
    /* native handler owns pin state */
  }, []);

  // Wheel / touch / scroll / resize — native, passive.
  useEffect(() => {
    if (!enabled) return;
    const el = viewportRef.current;
    if (!el) return;

    const handleScroll = () => {
      const scrollTop = el.scrollTop;
      let lastScrollTop = lastScrollTopRef.current;
      const ignore = ignoreScrollTopRef.current;
      lastScrollTopRef.current = scrollTop;
      ignoreScrollTopRef.current = undefined;

      // Programmatic follow can interleave with a user scroll-up in one event.
      if (ignore != null && ignore > scrollTop) {
        lastScrollTop = ignore;
      }

      // ResizeObserver scroll races: ignore until resizeDifference clears.
      // @see https://github.com/WICG/resize-observer/issues/25
      window.setTimeout(() => {
        if (resizeDifferenceRef.current !== 0) return;
        if (ignore != null && scrollTop === ignore) return;

        const near = isNearBottom(
          el.scrollTop,
          el.scrollHeight,
          el.clientHeight,
          thresholdRef.current,
        );
        const next = nextStickPinState(
          {
            pinned: isPinnedRef.current,
            escaped: escapedRef.current,
          },
          {
            scrollingUp: scrollTop < lastScrollTop,
            scrollingDown: scrollTop > lastScrollTop,
            nearBottom: near,
          },
        );
        isPinnedRef.current = next.pinned;
        escapedRef.current = next.escaped;
        syncShowBack();
      }, 1);
    };

    const handleWheel = (e: WheelEvent) => {
      // deltaY < 0 → user reading history. Escape immediately so a concurrent
      // content-growth follow cannot yank the viewport back down.
      if (
        e.deltaY < 0 &&
        el.scrollHeight > el.clientHeight &&
        isPinnedRef.current
      ) {
        escapedRef.current = true;
        isPinnedRef.current = false;
        syncShowBack();
      }
    };

    let touchY: number | null = null;
    const onTouchStart = (e: TouchEvent) => {
      touchY = e.touches[0]?.clientY ?? null;
    };
    const onTouchMove = (e: TouchEvent) => {
      const y = e.touches[0]?.clientY;
      if (touchY == null || y == null) return;
      // Finger moves down → content moves up (reading history)
      if (y - touchY > 6 && isPinnedRef.current) {
        escapedRef.current = true;
        isPinnedRef.current = false;
        syncShowBack();
      }
      touchY = y;
    };
    const onTouchEnd = () => {
      touchY = null;
    };

    el.addEventListener("scroll", handleScroll, { passive: true });
    el.addEventListener("wheel", handleWheel, { passive: true });
    el.addEventListener("touchstart", onTouchStart, { passive: true });
    el.addEventListener("touchmove", onTouchMove, { passive: true });
    el.addEventListener("touchend", onTouchEnd, { passive: true });
    el.addEventListener("touchcancel", onTouchEnd, { passive: true });

    lastScrollTopRef.current = el.scrollTop;

    return () => {
      el.removeEventListener("scroll", handleScroll);
      el.removeEventListener("wheel", handleWheel);
      el.removeEventListener("touchstart", onTouchStart);
      el.removeEventListener("touchmove", onTouchMove);
      el.removeEventListener("touchend", onTouchEnd);
      el.removeEventListener("touchcancel", onTouchEnd);
    };
  }, [enabled, conversationKey, syncShowBack]);

  // Conversation switch → re-pin and jump to bottom.
  useEffect(() => {
    if (!enabled) return;
    escapedRef.current = false;
    isPinnedRef.current = true;
    const id = requestAnimationFrame(() => scrollToBottom("instant"));
    return () => cancelAnimationFrame(id);
  }, [conversationKey, enabled, scrollToBottom]);

  // User sent a message → force follow even if they had scrolled up.
  useEffect(() => {
    if (!enabled || forceStickKey == null || forceStickKey === "") return;
    escapedRef.current = false;
    isPinnedRef.current = true;
    const id = requestAnimationFrame(() => scrollToBottom("instant"));
    return () => cancelAnimationFrame(id);
  }, [forceStickKey, enabled, scrollToBottom]);

  // Content growth / shrink while pinned.
  useEffect(() => {
    if (!enabled) return;
    const el = viewportRef.current;
    if (!el) return;

    let previousHeight: number | undefined;
    let raf = 0;

    const onHeightChange = (height: number) => {
      const difference = height - (previousHeight ?? height);
      // Thought-stream / font / 1–3px reflow: update baseline only — re-follow
      // would fight itself and look like the page bouncing while thinking.
      if (previousHeight != null && isHeightDeltaNoise(difference)) {
        previousHeight = height;
        return;
      }
      resizeDifferenceRef.current = difference;

      // Browser can leave scrollTop past max after a shrink — clamp without
      // treating it as a user scroll (would thrash pin / jump to top).
      const maxTop = bottomScrollTop(el.scrollHeight, el.clientHeight);
      if (el.scrollTop > maxTop + 1) {
        applyScrollTop(maxTop);
      }

      if (
        difference < 0 &&
        !escapedRef.current &&
        isNearBottom(
          el.scrollTop,
          el.scrollHeight,
          el.clientHeight,
          thresholdRef.current,
        )
      ) {
        // Shrink while still following (markdown reflow): stay pinned so the
        // next grow does not leave a gap. Never re-engage if user escaped.
        isPinnedRef.current = true;
      }

      // Grow, shrink, or viewport-only resize: follow only while pinned.
      // Do NOT compensate scrollTop while escaped — stream growth is almost
      // always at the bottom; adding the full height delta would yank the
      // user down. Image cards use fixed-aspect frames so residual media
      // reflow (the old jump-to-top cause) should be ~0.
      followIfPinned();

      previousHeight = height;
      requestAnimationFrame(() => {
        window.setTimeout(() => {
          if (resizeDifferenceRef.current === difference) {
            resizeDifferenceRef.current = 0;
          }
        }, 1);
      });
    };

    const measureContentHeight = () => {
      const content = contentRef.current ?? el.firstElementChild;
      if (content instanceof HTMLElement) return content.offsetHeight;
      return el.scrollHeight;
    };

    const ro = new ResizeObserver(() => {
      // Coalesce multi-node notifications to one frame. Always read the
      // content column height from the DOM — viewport RO entries report
      // client box size, which is not what we want for grow/shrink.
      if (raf) return;
      raf = requestAnimationFrame(() => {
        raf = 0;
        onHeightChange(measureContentHeight());
      });
    });

    const content = contentRef.current ?? el.firstElementChild;
    if (content) ro.observe(content);
    // Viewport size changes (window / stage chrome) also need a re-follow.
    ro.observe(el);

    return () => {
      if (raf) cancelAnimationFrame(raf);
      ro.disconnect();
    };
  }, [enabled, conversationKey, applyScrollTop, followIfPinned]);

  return {
    viewportRef,
    contentRef,
    onScroll,
    scrollToBottom,
    isPinnedRef,
    showBack,
  };
}
