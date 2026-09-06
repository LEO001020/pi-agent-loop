/**
 * Viewport-aware floating menus.
 * Always pair with createPortal(..., document.body) so overflow parents never clip.
 *
 * Default width is content-sized (`fitContent`). Pass `matchTriggerWidth` when the
 * panel should be at least as wide as the trigger (e.g. account sheet).
 *
 * Open flash prevention: style stays `visibility: hidden` until the panel has been
 * mounted and (for fit-content) edge-clamped in useLayoutEffect — so the first
 * painted frame is already final. Avoids empty/jump flashes on first open.
 */

import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type CSSProperties,
  type RefObject,
} from "react";

export type FloatingPlacement = "up" | "down" | "auto";

export interface FloatingPos {
  left: number;
  top: number;
  /**
   * When set, the panel is anchored by its *bottom* edge (CSS `bottom`) instead
   * of `top`. Used for `placement: "up"` so the panel grows upward from the
   * trigger without depending on its own (possibly async / late-measured)
   * height — which previously detached the panel and flung it to the top.
   */
  bottom?: number;
  /** Fixed width when not fit-content; 0 means content-sized. */
  width: number;
  placeAbove: boolean;
  maxHeight: number;
  /** Viewport clamp for content-sized panels. */
  maxWidth: number;
  fitContent: boolean;
}

export interface ComputeFloatingOptions {
  /**
   * Preferred fixed panel width (px). Ignored when `fitContent` is true
   * (unless used as a soft estimate for left clamping).
   */
  width?: number;
  /** Minimum width; if matchTriggerWidth, at least trigger width. */
  minWidth?: number;
  /** Stretch to at least trigger width (still allows content to grow when fitContent). */
  matchTriggerWidth?: boolean;
  /**
   * Size panel to item content + padding (no fixed width). Default true.
   * Set false only when an explicit fixed `width` is required.
   */
  fitContent?: boolean;
  /** Estimated panel height for flip heuristics. */
  estHeight?: number;
  placement?: FloatingPlacement;
  gap?: number;
  margin?: number;
}

export function computeFloatingPos(
  trigger: DOMRect,
  opts: ComputeFloatingOptions = {},
): FloatingPos {
  const gap = opts.gap ?? 6;
  const margin = opts.margin ?? 8;
  const estHeight = opts.estHeight ?? 240;
  const placement = opts.placement ?? "auto";
  const fitContent = opts.fitContent !== false;

  const g = globalThis as { innerWidth?: number; innerHeight?: number };
  const vw = typeof g.innerWidth === "number" ? g.innerWidth : 1024;
  const vh = typeof g.innerHeight === "number" ? g.innerHeight : 768;
  const maxWidth = Math.max(120, vw - margin * 2);

  let width = 0;
  if (!fitContent) {
    width = opts.width ?? 240;
    if (opts.matchTriggerWidth) {
      width = Math.max(width, trigger.width, opts.minWidth ?? 0);
    } else if (opts.minWidth) {
      width = Math.max(width, opts.minWidth);
    }
    width = Math.min(width, maxWidth);
  } else if (opts.matchTriggerWidth) {
    // Soft floor for positioning estimates only (style uses max-content + minWidth).
    width = Math.min(
      Math.max(trigger.width, opts.minWidth ?? 0, opts.width ?? 0),
      maxWidth,
    );
  } else {
    width = Math.min(opts.width ?? opts.minWidth ?? 160, maxWidth);
  }

  const spaceAbove = trigger.top - margin;
  const spaceBelow = vh - trigger.bottom - margin;

  let placeAbove: boolean;
  if (placement === "up") placeAbove = true;
  else if (placement === "down") placeAbove = false;
  else placeAbove = spaceAbove >= estHeight || spaceAbove > spaceBelow;

  const maxHeight = Math.max(
    120,
    Math.min(estHeight + 80, placeAbove ? spaceAbove - gap : spaceBelow - gap),
  );

  // Prefer trigger left edge; clamp so estimated panel stays in viewport.
  let left = trigger.left;
  left = Math.max(margin, Math.min(left, vw - width - margin));

  if (placeAbove) {
    // `placement: "up"` anchors by the bottom edge so the panel always sits
    // flush above the trigger and grows upward — independent of its height.
    if (placement === "up") {
      const aboveMax = Math.max(120, trigger.top - gap - margin);
      return {
        left,
        top: 0,
        bottom: vh - trigger.top + gap,
        width: fitContent ? 0 : width,
        placeAbove: false,
        maxHeight: aboveMax,
        maxWidth,
        fitContent,
      };
    }
    return {
      left,
      top: trigger.top - gap,
      width: fitContent ? 0 : width,
      placeAbove: true,
      maxHeight,
      maxWidth,
      fitContent,
    };
  }
  return {
    left,
    top: trigger.bottom + gap,
    width: fitContent ? 0 : width,
    placeAbove: false,
    maxHeight,
    maxWidth,
    fitContent,
  };
}

function posEqual(a: FloatingPos, b: FloatingPos): boolean {
  return (
    a.left === b.left &&
    a.top === b.top &&
    a.bottom === b.bottom &&
    a.width === b.width &&
    a.placeAbove === b.placeAbove &&
    a.maxHeight === b.maxHeight &&
    a.maxWidth === b.maxWidth &&
    a.fitContent === b.fitContent
  );
}

export function floatingStyle(
  pos: FloatingPos | null,
  extras?: { minWidth?: number; settled?: boolean },
): CSSProperties | undefined {
  if (!pos) return undefined;
  const base: CSSProperties = {
    position: "fixed",
    left: pos.left,
    maxHeight: pos.maxHeight,
    maxWidth: pos.maxWidth,
    zIndex: 10000,
  };
  if (pos.bottom != null) {
    // Bottom-anchored (`placement: "up"`): the browser keeps the panel glued
    // above the trigger as its height changes — no transform, no JS re-measure.
    base.bottom = pos.bottom;
  } else {
    base.top = pos.top;
  }
  if (pos.fitContent) {
    base.width = "max-content";
    if (extras?.minWidth) base.minWidth = extras.minWidth;
  } else {
    /* Lock both width and maxWidth so content (nowrap labels) cannot expand the panel. */
    base.width = pos.width;
    base.maxWidth = Math.min(pos.width, pos.maxWidth);
    base.minWidth = 0;
    base.overflowX = "hidden";
  }
  if (pos.placeAbove) {
    // Keep a compositing layer (matches glass translateZ) while anchoring above.
    base.transform = "translateY(-100%) translateZ(0)";
  }
  // Hide until first layout pass finishes — prevents empty/jump flash on open.
  if (extras?.settled === false) {
    base.visibility = "hidden";
    base.pointerEvents = "none";
  }
  return base;
}

export interface UseFloatingMenuOptions {
  open: boolean;
  /** Trigger element used for positioning. */
  triggerRef: RefObject<HTMLElement | null>;
  /** Panel element (for outside-click + ignore + overflow clamp). */
  panelRef: RefObject<HTMLElement | null>;
  /** Optional extra roots that count as "inside" (e.g. trigger wrapper). */
  roots?: Array<RefObject<HTMLElement | null>>;
  onClose: () => void;
  placement?: FloatingPlacement;
  width?: number;
  minWidth?: number;
  matchTriggerWidth?: boolean;
  /** Default true — panel width follows content. */
  fitContent?: boolean;
  estHeight?: number;
  gap?: number;
  /** Extra deps that should recompute position (e.g. nested content). */
  deps?: unknown[];
}

/**
 * Tracks open panel position and wires outside-click / Escape / scroll / resize.
 */
export function useFloatingMenu({
  open,
  triggerRef,
  panelRef,
  roots = [],
  onClose,
  placement = "auto",
  width,
  minWidth,
  matchTriggerWidth,
  fitContent = true,
  estHeight = 240,
  gap = 6,
  deps = [],
}: UseFloatingMenuOptions): {
  pos: FloatingPos | null;
  style: CSSProperties | undefined;
  /** True after panel has been measured/clamped; style is visible only then. */
  settled: boolean;
} {
  const [pos, setPos] = useState<FloatingPos | null>(null);
  const [triggerW, setTriggerW] = useState(0);
  const [settled, setSettled] = useState(false);
  const settledRef = useRef(false);
  const optsRef = useRef({
    width,
    minWidth,
    matchTriggerWidth,
    fitContent,
    estHeight,
    placement,
    gap,
  });
  optsRef.current = {
    width,
    minWidth,
    matchTriggerWidth,
    fitContent,
    estHeight,
    placement,
    gap,
  };

  const applyPos = (next: FloatingPos) => {
    setPos((prev) => (prev && posEqual(prev, next) ? prev : next));
  };

  /** Pure position compute from the live trigger (+ panel) rects. */
  const computePos = (): FloatingPos | null => {
    const el = triggerRef.current;
    if (!el) return null;
    const r = el.getBoundingClientRect();
    setTriggerW(r.width);
    const o = optsRef.current;
    const gap = o.gap ?? 6;
    const margin = 8;
    let next = computeFloatingPos(r, {
      width: o.width,
      minWidth: o.minWidth,
      matchTriggerWidth: o.matchTriggerWidth,
      fitContent: o.fitContent,
      estHeight: o.estHeight,
      placement: o.placement,
      gap,
    });

    const panel = panelRef.current;
    if (panel) {
      const vw =
        typeof globalThis.innerWidth === "number"
          ? globalThis.innerWidth
          : 1024;
      const pw = panel.offsetWidth || panel.getBoundingClientRect().width;

      if (next.placeAbove) {
        const contentH = panel.scrollHeight || panel.offsetHeight;
        const spaceAbove = Math.max(120, r.top - gap - margin);
        const visibleH = Math.min(contentH, spaceAbove);
        next = {
          ...next,
          top: r.top - gap - visibleH,
          placeAbove: false,
          maxHeight: visibleH,
        };
      }

      if (next.left + pw > vw - margin) {
        next = {
          ...next,
          left: Math.max(margin, vw - margin - pw),
        };
      }
    }
    return next;
  };

  const update = (markSettled: boolean) => {
    const next = computePos();
    if (!next) return;
    applyPos(next);
    if (markSettled && panelRef.current && !settledRef.current) {
      settledRef.current = true;
      setSettled(true);
    }
  };

  useLayoutEffect(() => {
    if (!open) {
      setPos(null);
      setSettled(false);
      settledRef.current = false;
      return;
    }
    // First pass: position estimate (panel may not exist yet).
    update(false);

    const onScroll = (e: Event) => {
      const t = e.target;
      if (t instanceof Node && panelRef.current?.contains(t)) return;
      update(true);
      startLoop();
    };
    const onResize = () => {
      update(true);
      startLoop();
    };
    window.addEventListener("resize", onResize);
    window.addEventListener("scroll", onScroll, true);

    // Stabilization loop: re-anchor every frame until the trigger rect stops
    // moving for a few frames, then sleep. This catches late layout shifts
    // (e.g. the composer settling from a centered to a docked position right
    // as the menu opens) that a single useLayoutEffect read would miss and
    // that previously left the panel stranded at the top of the viewport.
    let raf = 0;
    let stable = 0;
    let last: FloatingPos | null = null;
    const tick = () => {
      const next = computePos();
      if (next) {
        if (last && posEqual(last, next)) {
          stable += 1;
          if (stable >= 4) {
            last = next;
            raf = 0;
            return;
          }
        } else {
          stable = 0;
          last = next;
          applyPos(next);
        }
      }
      raf = requestAnimationFrame(tick);
    };
    const startLoop = () => {
      if (raf) return;
      stable = 0;
      raf = requestAnimationFrame(tick);
    };
    startLoop();

    // Re-anchor when the trigger's own box changes (reflow, not scroll).
    let tro: ResizeObserver | null = null;
    const triggerEl = triggerRef.current;
    if (typeof ResizeObserver !== "undefined" && triggerEl) {
      tro = new ResizeObserver(() => {
        update(true);
        startLoop();
      });
      tro.observe(triggerEl);
    }

    // Re-anchor when panel content height changes (auto placement flip /
    // filter shrink). Bottom-anchored panels ignore this vertically.
    let ro: ResizeObserver | null = null;
    const panel = panelRef.current;
    if (typeof ResizeObserver !== "undefined" && panel) {
      ro = new ResizeObserver(() => update(true));
      ro.observe(panel);
    }

    return () => {
      window.removeEventListener("resize", onResize);
      window.removeEventListener("scroll", onScroll, true);
      if (raf) cancelAnimationFrame(raf);
      tro?.disconnect();
      ro?.disconnect();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    open,
    placement,
    width,
    minWidth,
    matchTriggerWidth,
    fitContent,
    estHeight,
    gap,
    ...deps,
  ]);

  // Second pass: panel mounted — measure real size + settle.
  useLayoutEffect(() => {
    if (!open || !pos) return;
    if (!panelRef.current) return;
    update(true);
    if (!settledRef.current && panelRef.current) {
      settledRef.current = true;
      setSettled(true);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, !!pos, panelRef]);

  // Re-anchor when host reports content change (filter query / entry count).
  useLayoutEffect(() => {
    if (!open || !panelRef.current) return;
    update(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, ...deps]);

  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      const t = e.target as Node;
      if (triggerRef.current?.contains(t)) return;
      if (panelRef.current?.contains(t)) return;
      for (const r of roots) {
        if (r.current?.contains(t)) return;
      }
      onClose();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("mousedown", onDoc);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDoc);
      document.removeEventListener("keydown", onKey);
    };
  }, [open, onClose, triggerRef, panelRef, roots]);

  const styleMin =
    matchTriggerWidth && triggerW > 0
      ? Math.max(triggerW, minWidth ?? 0)
      : minWidth;

  return {
    pos,
    settled,
    style: floatingStyle(pos, {
      minWidth: styleMin,
      settled: open ? settled : true,
    }),
  };
}
