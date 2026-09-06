/**
 * Personal center — compact upward menu: account card · settings · theme · logout.
 */

import { useRef, type ReactNode } from "react";
import { createPortal } from "react-dom";
import {
  IconSettings,
  IconThemeMoon,
  IconThemeSun,
} from "@/components/icons";
import type { Theme } from "@/lib/theme";
import { useFloatingMenu } from "@/lib/floatingMenu";
import type { AccountStatus, CustomProvider } from "@/lib/api";

export interface UserMenuProps {
  open: boolean;
  onClose: () => void;
  theme: Theme;
  labels: {
    settings: string;
    theme: string;
    themeLight: string;
    themeDark: string;
    local: string;
    signedIn: string;
    signedOut: string;
    login: string;
    logout: string;
    remaining: string;
    customProvider: string;
    /** Prefix for quota refresh time, e.g. “Resets”. */
    resetsAt: string;
  };
  account: AccountStatus | null;
  activeProvider: CustomProvider | null;
  accountBusy: boolean;
  onSettings: () => void;
  onAccountSettings: () => void;
  onToggleTheme: () => void;
  onLogin: () => void;
  onLogout: () => void;
  children: ReactNode;
}

export function remainingPercent(account: AccountStatus | null): number | null {
  if (!account?.billing) return null;
  const billing = account.billing;
  if (billing.remainingPercent != null && Number.isFinite(billing.remainingPercent)) {
    return Math.max(0, Math.min(100, billing.remainingPercent));
  }
  return null;
}

export function UserMenu({
  open,
  onClose,
  theme,
  labels,
  onSettings,
  onToggleTheme,
  children,
}: UserMenuProps) {
  const rootRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLDivElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);

  const { pos, style } = useFloatingMenu({
    open,
    triggerRef,
    panelRef,
    roots: [rootRef],
    onClose,
    placement: "up",
    fitContent: true,
    matchTriggerWidth: true,
    minWidth: 220,
    estHeight: 260,
    gap: 6,
  });

  const panel =
    open && pos && typeof document !== "undefined"
      ? createPortal(
          <div
            ref={panelRef}
            className="menu-panel user-menu__pop user-menu__pop--portal user-menu__pop--account"
            role="menu"
            style={style}
          >
            <div
              className="user-menu__account"
            >
              <div className="user-menu__account-top">
                <div className="account-avatar account-avatar--sm" aria-hidden>
                  P
                </div>
                <div className="user-menu__account-text">
                  <div className="user-menu__account-name-row">
                    <div className="user-menu__account-name">Pi</div>
                  </div>
                  <div className="user-menu__account-sub">RPC</div>
                </div>
              </div>
            </div>

            <button
              type="button"
              className="user-menu__item"
              role="menuitem"
              onClick={() => {
                onClose();
                onSettings();
              }}
            >
              <IconSettings size={16} />
              <span>{labels.settings}</span>
            </button>

            <button
              type="button"
              className="user-menu__item"
              role="menuitem"
              onClick={() => {
                onToggleTheme();
              }}
            >
              {theme === "dark" ? (
                <IconThemeSun size={16} />
              ) : (
                <IconThemeMoon size={16} />
              )}
              <span>
                {labels.theme}
                <em>
                  {theme === "dark" ? labels.themeLight : labels.themeDark}
                </em>
              </span>
            </button>

          </div>,
          document.body,
        )
      : null;

  return (
    <div className={"user-menu" + (open ? " is-open" : "")} ref={rootRef}>
      <div ref={triggerRef} className="user-menu__anchor">
        {children}
      </div>
      {panel}
    </div>
  );
}
