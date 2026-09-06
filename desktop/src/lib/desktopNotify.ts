/**
 * Lightweight desktop notification helper.
 * Uses the Web Notification API when available (Tauri WebView on macOS/Windows).
 * Always safe to call — fails closed to `false` without throwing.
 */

export type DesktopNotifyOptions = {
  title: string;
  body?: string;
  /** When false, skip if document has focus (default true = always try). */
  force?: boolean;
  tag?: string;
};

export type NotifyPermission = "granted" | "denied" | "default" | "unsupported";

function notificationCtor(): typeof Notification | null {
  if (typeof globalThis === "undefined") return null;
  const N = (globalThis as { Notification?: typeof Notification }).Notification;
  if (typeof N !== "function") return null;
  return N;
}

export function notificationSupport(): NotifyPermission {
  const N = notificationCtor();
  if (!N) return "unsupported";
  const perm = N.permission;
  if (perm === "granted" || perm === "denied" || perm === "default") {
    return perm;
  }
  return "unsupported";
}

/** Request permission once; no-op when already decided or unavailable. */
export async function ensureNotifyPermission(): Promise<NotifyPermission> {
  const status = notificationSupport();
  if (status !== "default") return status;
  const N = notificationCtor();
  if (!N?.requestPermission) return "unsupported";
  try {
    const next = await N.requestPermission();
    if (next === "granted" || next === "denied" || next === "default") {
      return next;
    }
    return "unsupported";
  } catch {
    return "unsupported";
  }
}

/**
 * Show a system notification when permission is granted.
 * Returns true only when a Notification object was constructed.
 */
export function showDesktopNotification(opts: DesktopNotifyOptions): boolean {
  if (notificationSupport() !== "granted") return false;
  if (!opts.force && typeof document !== "undefined" && document.hasFocus()) {
    // App is in front — prefer in-app toast; caller can pass force=true.
    return false;
  }
  const N = notificationCtor();
  if (!N) return false;
  try {
    // eslint-disable-next-line no-new
    new N(opts.title, {
      body: opts.body,
      tag: opts.tag,
      silent: false,
    });
    return true;
  } catch {
    return false;
  }
}

/** Convenience: request permission (if needed) then show. */
export async function notifyDesktop(
  opts: DesktopNotifyOptions,
): Promise<boolean> {
  await ensureNotifyPermission();
  return showDesktopNotification(opts);
}
