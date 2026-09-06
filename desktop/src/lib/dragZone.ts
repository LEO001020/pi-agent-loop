/**
 * File drag-drop zone hit testing: sidebar (add project) vs main (attach).
 *
 * Zone edges come from the real sidebar DOM rect — never window midlines.
 *
 * Coordinate note: Tauri types drag positions as PhysicalPosition, but on
 * macOS wry reports NSDraggingInfo.draggingLocation() which is already in
 * view points (logical). Dividing those by scaleFactor expands the left zone
 * to roughly half the window on Retina. Windows ScreenToClient is physical.
 */

export type DragZone = "sidebar" | "main";

export interface RectLike {
  left: number;
  right: number;
  top: number;
  bottom: number;
  width: number;
}

/**
 * Whether Tauri drag positions need / scaleFactor to match CSS client coords.
 * mac / iOS: already logical points. win / other: physical pixels.
 */
export function dragPosNeedsScale(platform: string): boolean {
  return platform === "win" || platform === "linux" || platform === "other";
}

/** Convert a Tauri drag position into CSS client coordinates. */
export function toClientDragPoint(
  pos: { x: number; y: number },
  scaleFactor: number,
  platform: string,
): { x: number; y: number } {
  if (!dragPosNeedsScale(platform)) {
    return { x: pos.x, y: pos.y };
  }
  const f = scaleFactor > 0 ? scaleFactor : 1;
  return { x: pos.x / f, y: pos.y / f };
}

/**
 * Hit-test client coordinates against the sidebar's actual layout box.
 * Only the visible sidebar rectangle is "sidebar"; everything else is "main"
 * (attachments), including the divider edge and the rest of the workbench.
 */
export function hitDragZoneFromRects(
  clientX: number,
  clientY: number,
  sidebar: RectLike | null,
  sidebarCollapsed: boolean,
): DragZone {
  if (sidebarCollapsed || !sidebar || sidebar.width < 2) {
    return "main";
  }
  // Right edge exclusive so the border / main start is attach, not project.
  if (
    clientX >= sidebar.left &&
    clientX < sidebar.right &&
    clientY >= sidebar.top &&
    clientY <= sidebar.bottom
  ) {
    return "sidebar";
  }
  return "main";
}

/** Resolve the live sidebar element used for drop-zone geometry. */
export function querySidebarEl(
  root: ParentNode = document,
): HTMLElement | null {
  const el =
    (root.querySelector(".workbench > .sidebar") as HTMLElement | null) ??
    (root.querySelector(".sidebar") as HTMLElement | null);
  if (!el) return null;
  if (
    el.classList.contains("sidebar--hidden") ||
    el.classList.contains("sidebar--collapsed")
  ) {
    return null;
  }
  return el;
}
