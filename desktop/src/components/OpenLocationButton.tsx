/**
 * Codex-style split “open location” control:
 * - Leading app icon of last-used target + label
 * - Primary click opens path with that target
 * - Caret opens menu (each option has a real app icon)
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import * as api from "@/lib/api";
import { useFloatingMenu } from "@/lib/floatingMenu";
import {
  IconChevronDown,
  IconCopy,
  IconExternalLink,
  IconFolder,
} from "@/components/icons";
import { Tip } from "@/components/ui/tooltip";

export type OpenLocationTarget = string; // finder | explorer | system | editor id

export interface OpenLocationButtonProps {
  /** Absolute path to open (project root or file). Hidden when null/empty. */
  path: string | null | undefined;
  /** Last selected target id (persisted by parent). */
  target: OpenLocationTarget;
  /** Called when user picks a menu item (parent should persist). */
  onTargetChange: (target: OpenLocationTarget) => void;
  /** Optional: after open success / always after attempt. */
  onOpenError?: (err: string) => void;
  /** Optional toast/feedback after path is copied. */
  onCopied?: () => void;
  platform?: "mac" | "win" | "linux" | "other";
  labels: {
    openLocation: string;
    openHint: string;
    openMenu: string;
    finder: string;
    systemDefault: string;
    /** Last menu item — copy absolute path. */
    copyPath: string;
  };
  className?: string;
  /** Compact: icon + caret only (no label). */
  compact?: boolean;
  disabled?: boolean;
}

function normalizeTarget(t: string | undefined | null): string {
  const v = (t || "finder").trim().toLowerCase();
  return v || "finder";
}

export function OpenLocationButton({
  path,
  target,
  onTargetChange,
  onOpenError,
  onCopied,
  platform = "mac",
  labels,
  className = "",
  compact = false,
  disabled = false,
}: OpenLocationButtonProps) {
  const [open, setOpen] = useState(false);
  const [editors, setEditors] = useState<api.DetectedEditor[]>([]);
  const [finderIcon, setFinderIcon] = useState<string | null>(null);
  const [systemIcon, setSystemIcon] = useState<string | null>(null);
  const rootRef = useRef<HTMLDivElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);

  const { pos, style } = useFloatingMenu({
    open,
    triggerRef: rootRef,
    panelRef,
    onClose: () => setOpen(false),
    placement: "down",
    fitContent: true,
    estHeight: 340,
    gap: 6,
  });

  const loadIcons = useCallback(() => {
    if (!api.isTauri()) return;
    void api
      .editorsList()
      .then((r) => {
        setEditors((r.editors ?? []).filter((e) => e.available));
        setFinderIcon(r.finderIcon ?? null);
        setSystemIcon(r.systemIcon ?? null);
      })
      .catch(() => {
        setEditors([]);
        setFinderIcon(null);
        setSystemIcon(null);
      });
  }, []);

  // Prefetch so the pill shows the real app icon immediately.
  useEffect(() => {
    loadIcons();
  }, [loadIcons]);

  const active = normalizeTarget(target);

  const currentIcon = useMemo(() => {
    if (active === "finder" || active === "explorer") return finderIcon;
    if (active === "system" || active === "default") return systemIcon;
    return editors.find((e) => e.id === active)?.iconDataUrl ?? null;
  }, [active, finderIcon, systemIcon, editors]);

  const openWith = useCallback(
    async (raw: string, remember: boolean) => {
      if (!path || disabled) return;
      const t = normalizeTarget(raw);
      if (remember) onTargetChange(t);
      try {
        if (t === "finder" || t === "explorer") {
          await api.pathReveal(path);
        } else if (t === "system" || t === "default") {
          await api.pathOpen(path);
        } else {
          await api.openInEditor({ path, editor: t });
        }
      } catch (e) {
        onOpenError?.(String(e));
      }
    },
    [path, disabled, onTargetChange, onOpenError],
  );

  if (!path) return null;

  const finderTarget = platform === "win" ? "explorer" : "finder";

  const menu =
    open && pos && typeof document !== "undefined"
      ? createPortal(
          <div
            ref={panelRef}
            className="menu-panel open-loc-menu"
            role="menu"
            style={style}
          >
            <button
              type="button"
              role="menuitem"
              className={
                "open-loc-menu__item" +
                (active === "finder" || active === "explorer"
                  ? " is-active"
                  : "")
              }
              onClick={() => {
                setOpen(false);
                void openWith(finderTarget, true);
              }}
            >
              <span className="open-loc-menu__ico" aria-hidden>
                {finderIcon ? (
                  <img src={finderIcon} alt="" />
                ) : (
                  <IconFolder size={16} />
                )}
              </span>
              <span>{labels.finder}</span>
            </button>
            <button
              type="button"
              role="menuitem"
              className={
                "open-loc-menu__item" +
                (active === "system" || active === "default"
                  ? " is-active"
                  : "")
              }
              onClick={() => {
                setOpen(false);
                void openWith("system", true);
              }}
            >
              <span className="open-loc-menu__ico" aria-hidden>
                {systemIcon ? (
                  <img src={systemIcon} alt="" />
                ) : (
                  <IconExternalLink size={16} />
                )}
              </span>
              <span>{labels.systemDefault}</span>
            </button>
            {editors.length > 0 && (
              <div className="open-loc-menu__sep" aria-hidden />
            )}
            {editors.map((ed) => (
              <button
                key={ed.id}
                type="button"
                role="menuitem"
                className={
                  "open-loc-menu__item" +
                  (active === ed.id ? " is-active" : "")
                }
                onClick={() => {
                  setOpen(false);
                  void openWith(ed.id, true);
                }}
              >
                <span className="open-loc-menu__ico" aria-hidden>
                  {ed.iconDataUrl ? (
                    <img src={ed.iconDataUrl} alt="" />
                  ) : (
                    <IconExternalLink size={16} />
                  )}
                </span>
                <span>{ed.label}</span>
              </button>
            ))}
            <div className="open-loc-menu__sep" aria-hidden />
            <button
              type="button"
              role="menuitem"
              className="open-loc-menu__item"
              onClick={() => {
                setOpen(false);
                if (!path) return;
                void navigator.clipboard
                  .writeText(path)
                  .then(() => onCopied?.())
                  .catch((e) => onOpenError?.(String(e)));
              }}
            >
              <span className="open-loc-menu__ico" aria-hidden>
                <IconCopy size={16} />
              </span>
              <span>{labels.copyPath}</span>
            </button>
          </div>,
          document.body,
        )
      : null;

  return (
    <div
      ref={rootRef}
      className={
        "open-loc" +
        (open ? " is-open" : "") +
        (compact ? " open-loc--compact" : "") +
        (disabled ? " is-disabled" : "") +
        (className ? ` ${className}` : "")
      }
    >
      <Tip label={labels.openHint} disabled={disabled}>
        <button
          type="button"
          className="open-loc__main"
          disabled={disabled}
          onClick={() => void openWith(active, false)}
        >
          <span className="open-loc__app-ico" aria-hidden>
            {currentIcon ? (
              <img src={currentIcon} alt="" />
            ) : (
              <IconExternalLink size={15} />
            )}
          </span>
          {!compact && (
            <span className="open-loc__label">{labels.openLocation}</span>
          )}
        </button>
      </Tip>
      <Tip label={labels.openMenu} disabled={disabled}>
        <button
          type="button"
          className="open-loc__caret"
          disabled={disabled}
          aria-haspopup="menu"
          aria-expanded={open}
          onClick={() => {
            setOpen((v) => {
              const next = !v;
              if (next) loadIcons();
              return next;
            });
          }}
        >
          <IconChevronDown size={12} />
        </button>
      </Tip>
      {menu}
    </div>
  );
}
