/**
 * Unified right-click / context menu (chat att-menu visual baseline).
 *
 * Solid surface, compact padding, optional leading icon.
 * Always portaled to document.body; closes on outside mousedown + Escape.
 *
 * Usage:
 *   <ContextMenu
 *     open={!!menu}
 *     x={menu.x}
 *     y={menu.y}
 *     onClose={() => setMenu(null)}
 *     items={[{ label: "…", icon: <Icon… />, onClick: () => { … } }]}
 *   />
 */

import {
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { createPortal } from "react-dom";

export type ContextMenuItem = {
  id?: string;
  label: ReactNode;
  icon?: ReactNode;
  danger?: boolean;
  disabled?: boolean;
  onClick: () => void;
};

export type ContextMenuProps = {
  open: boolean;
  x: number;
  y: number;
  items: ContextMenuItem[];
  onClose: () => void;
  /** Extra rows after items (legacy ImageUi/VideoUi slot). */
  extra?: ReactNode;
  className?: string;
  /** Used to clamp position near viewport edges. */
  estimatedWidth?: number;
  estimatedHeight?: number;
};

function cx(...parts: Array<string | false | null | undefined>) {
  return parts.filter(Boolean).join(" ");
}

/** Clamp menu anchor so the panel stays in viewport. */
export function clampContextMenuPos(
  x: number,
  y: number,
  width = 200,
  height = 220,
): { left: number; top: number } {
  if (typeof window === "undefined") return { left: x, top: y };
  return {
    left: Math.max(8, Math.min(x, window.innerWidth - width - 8)),
    top: Math.max(8, Math.min(y, window.innerHeight - height - 8)),
  };
}

export function ContextMenu({
  open,
  x,
  y,
  items,
  onClose,
  extra,
  className,
  estimatedWidth = 200,
  estimatedHeight = 240,
}: ContextMenuProps) {
  const menuId = useId();
  const rootRef = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState(() =>
    clampContextMenuPos(x, y, estimatedWidth, estimatedHeight),
  );

  useLayoutEffect(() => {
    if (!open) return;
    setPos(clampContextMenuPos(x, y, estimatedWidth, estimatedHeight));
  }, [open, x, y, estimatedWidth, estimatedHeight]);

  // After paint, re-clamp using real menu size if available.
  useLayoutEffect(() => {
    if (!open || !rootRef.current) return;
    const rect = rootRef.current.getBoundingClientRect();
    setPos(
      clampContextMenuPos(
        x,
        y,
        Math.ceil(rect.width) || estimatedWidth,
        Math.ceil(rect.height) || estimatedHeight,
      ),
    );
  }, [open, x, y, items.length, estimatedWidth, estimatedHeight]);

  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      const t = e.target as HTMLElement | null;
      if (t?.closest?.(".context-menu")) return;
      onClose();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    // Defer so the opening contextmenu / click does not immediately dismiss.
    const timer = window.setTimeout(() => {
      document.addEventListener("mousedown", onDoc, true);
    }, 0);
    document.addEventListener("keydown", onKey);
    return () => {
      window.clearTimeout(timer);
      document.removeEventListener("mousedown", onDoc, true);
      document.removeEventListener("keydown", onKey);
    };
  }, [open, onClose]);

  if (!open || typeof document === "undefined") return null;

  const visibleItems = items.filter(Boolean);

  return createPortal(
    <div
      ref={rootRef}
      id={menuId}
      className={cx("menu-panel context-menu att-menu", className)}
      style={{ left: pos.left, top: pos.top }}
      role="menu"
      onMouseDown={(e) => e.stopPropagation()}
      onContextMenu={(e) => {
        e.preventDefault();
        e.stopPropagation();
      }}
    >
      {visibleItems.map((item, i) => (
        <button
          key={item.id ?? `ctx-item-${i}`}
          type="button"
          className={cx(
            "context-menu__item",
            "att-menu__item",
            item.danger && "is-danger",
          )}
          role="menuitem"
          disabled={item.disabled}
          onClick={() => {
            if (item.disabled) return;
            onClose();
            item.onClick();
          }}
        >
          {item.icon != null ? (
            <span className="context-menu__ico att-menu__ico" aria-hidden>
              {item.icon}
            </span>
          ) : null}
          {item.label}
        </button>
      ))}
      {extra}
    </div>,
    document.body,
  );
}
