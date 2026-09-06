/**
 * Layout preferences: sidebar width, aside width, aside collapsed default.
 * Durable key in localStorage (App config later).
 */

export const LAYOUT_STORAGE_KEY = "pi-app.layout";

export interface LayoutPrefs {
  sidebarWidth: number;
  asideWidth: number;
  /** Right pane defaults collapsed per §17.1 / autoplan Design D7. */
  asideCollapsed: boolean;
  /** Left project rail collapsed (Codex-style). */
  sidebarCollapsed: boolean;
}

export const DEFAULT_LAYOUT: LayoutPrefs = {
  sidebarWidth: 260,
  asideWidth: 360,
  /** Right resource pane starts closed; open via top-bar files icon. */
  asideCollapsed: true,
  /** Left session rail starts open; can fully hide via top-bar panel icon. */
  sidebarCollapsed: false,
};

export const ASIDE_WIDTH_MIN = 240;
export const ASIDE_WIDTH_MAX = 720;
export const NARROW_WORKBENCH_QUERY = "(max-width: 720px)";

export type WorkbenchPane = "sidebar" | "aside";

/**
 * Opens one workbench pane. On narrow windows the panes behave like drawers,
 * so opening one must dismiss the other instead of covering the whole canvas.
 */
export function openWorkbenchPane(
  layout: LayoutPrefs,
  pane: WorkbenchPane,
  narrow: boolean,
): LayoutPrefs {
  if (pane === "sidebar") {
    return {
      ...layout,
      sidebarCollapsed: false,
      asideCollapsed: narrow ? true : layout.asideCollapsed,
    };
  }
  return {
    ...layout,
    asideCollapsed: false,
    sidebarCollapsed: narrow ? true : layout.sidebarCollapsed,
  };
}

/**
 * Reconcile a live desktop layout after the window crosses into narrow mode.
 * Keep the active resource drawer visible and release the left drawer.
 */
export function fitWorkbenchToViewport(
  layout: LayoutPrefs,
  narrow: boolean,
): LayoutPrefs {
  if (!narrow || layout.sidebarCollapsed) {
    return layout;
  }
  return { ...layout, sidebarCollapsed: true };
}

export function clampAsideWidth(w: number): number {
  if (!Number.isFinite(w)) return DEFAULT_LAYOUT.asideWidth;
  return Math.min(ASIDE_WIDTH_MAX, Math.max(ASIDE_WIDTH_MIN, Math.round(w)));
}

export function parseLayout(raw: unknown): LayoutPrefs {
  if (!raw || typeof raw !== "object") return { ...DEFAULT_LAYOUT };
  const o = raw as Record<string, unknown>;
  return {
    sidebarWidth:
      typeof o.sidebarWidth === "number" ? o.sidebarWidth : DEFAULT_LAYOUT.sidebarWidth,
    asideWidth:
      typeof o.asideWidth === "number"
        ? clampAsideWidth(o.asideWidth)
        : DEFAULT_LAYOUT.asideWidth,
    // Cold start always closed; open state is session-only (not restored).
    asideCollapsed: DEFAULT_LAYOUT.asideCollapsed,
    sidebarCollapsed:
      typeof o.sidebarCollapsed === "boolean"
        ? o.sidebarCollapsed
        : DEFAULT_LAYOUT.sidebarCollapsed,
  };
}

export function loadLayout(storage: {
  getItem(k: string): string | null;
}): LayoutPrefs {
  try {
    const raw = storage.getItem(LAYOUT_STORAGE_KEY);
    if (!raw) return { ...DEFAULT_LAYOUT };
    return parseLayout(JSON.parse(raw));
  } catch {
    return { ...DEFAULT_LAYOUT };
  }
}

export function saveLayout(
  storage: { setItem(k: string, v: string): void },
  layout: LayoutPrefs,
): void {
  storage.setItem(LAYOUT_STORAGE_KEY, JSON.stringify(layout));
}
