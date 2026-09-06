/**
 * Codex-style tip — frosted dark pill, delayed show, portal (not native title).
 * Use instead of `title=` for icon buttons and compact controls.
 */

import {
  cloneElement,
  isValidElement,
  useCallback,
  useEffect,
  useId,
  useRef,
  useState,
  type CSSProperties,
  type FocusEvent,
  type MouseEvent,
  type ReactElement,
  type ReactNode,
  type Ref,
} from "react";
import { createPortal } from "react-dom";
import { cn } from "@/lib/utils";

export type TipPlacement = "top" | "bottom";

type TipChildProps = {
  ref?: Ref<HTMLElement>;
  onMouseEnter?: (e: MouseEvent) => void;
  onMouseLeave?: (e: MouseEvent) => void;
  onFocus?: (e: FocusEvent) => void;
  onBlur?: (e: FocusEvent) => void;
  "aria-describedby"?: string;
};

function mergeRefs<T>(...refs: Array<Ref<T> | undefined>) {
  return (node: T | null) => {
    for (const r of refs) {
      if (!r) continue;
      if (typeof r === "function") r(node);
      else (r as { current: T | null }).current = node;
    }
  };
}

export function Tip({
  label,
  children,
  placement = "top",
  delayMs = 420,
  disabled,
  className,
}: {
  label: ReactNode;
  children: ReactElement<TipChildProps>;
  placement?: TipPlacement;
  /** Hover delay before show (Codex ~400ms). */
  delayMs?: number;
  disabled?: boolean;
  className?: string;
}) {
  const tipId = useId();
  const anchorRef = useRef<HTMLElement | null>(null);
  const [open, setOpen] = useState(false);
  const [coords, setCoords] = useState<{ top: number; left: number } | null>(
    null,
  );
  const showTimer = useRef<number | null>(null);
  const hideTimer = useRef<number | null>(null);

  const clearTimers = useCallback(() => {
    if (showTimer.current != null) {
      window.clearTimeout(showTimer.current);
      showTimer.current = null;
    }
    if (hideTimer.current != null) {
      window.clearTimeout(hideTimer.current);
      hideTimer.current = null;
    }
  }, []);

  const measure = useCallback(() => {
    const el = anchorRef.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    const gap = 6;
    setCoords({
      left: r.left + r.width / 2,
      top: placement === "top" ? r.top - gap : r.bottom + gap,
    });
  }, [placement]);

  const scheduleShow = useCallback(() => {
    if (disabled || label == null || label === "") return;
    clearTimers();
    showTimer.current = window.setTimeout(() => {
      measure();
      setOpen(true);
    }, delayMs);
  }, [clearTimers, delayMs, disabled, label, measure]);

  const scheduleHide = useCallback(() => {
    clearTimers();
    hideTimer.current = window.setTimeout(() => setOpen(false), 40);
  }, [clearTimers]);

  useEffect(() => () => clearTimers(), [clearTimers]);

  useEffect(() => {
    if (!open) return;
    const onScroll = () => measure();
    window.addEventListener("scroll", onScroll, true);
    window.addEventListener("resize", onScroll);
    return () => {
      window.removeEventListener("scroll", onScroll, true);
      window.removeEventListener("resize", onScroll);
    };
  }, [open, measure]);

  // Re-measure when label flips (e.g. Copy → Copied) while open.
  useEffect(() => {
    if (open) measure();
  }, [label, open, measure]);

  if (!isValidElement(children)) {
    return children;
  }

  const child = children;
  const cloned = cloneElement(child, {
    ref: mergeRefs(anchorRef, child.props.ref),
    "aria-describedby": open ? tipId : child.props["aria-describedby"],
    onMouseEnter: (e: MouseEvent) => {
      child.props.onMouseEnter?.(e);
      scheduleShow();
    },
    onMouseLeave: (e: MouseEvent) => {
      child.props.onMouseLeave?.(e);
      scheduleHide();
    },
    onFocus: (e: FocusEvent) => {
      child.props.onFocus?.(e);
      scheduleShow();
    },
    onBlur: (e: FocusEvent) => {
      child.props.onBlur?.(e);
      scheduleHide();
    },
  } as TipChildProps);

  const tipStyle: CSSProperties | undefined = coords
    ? {
        top: coords.top,
        left: coords.left,
        transform:
          placement === "top"
            ? "translate(-50%, -100%)"
            : "translate(-50%, 0)",
      }
    : undefined;

  return (
    <>
      {cloned}
      {open &&
      coords &&
      label != null &&
      label !== "" &&
      !disabled &&
      typeof document !== "undefined"
        ? createPortal(
            <div
              id={tipId}
              role="tooltip"
              className={cn("ui-tip", `ui-tip--${placement}`, className)}
              style={tipStyle}
            >
              {label}
            </div>,
            document.body,
          )
        : null}
    </>
  );
}
