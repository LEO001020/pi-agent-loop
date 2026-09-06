import { afterEach, describe, expect, it, vi } from "vitest";
import {
  ensureNotifyPermission,
  notificationSupport,
  showDesktopNotification,
} from "./desktopNotify";

const originalNotification = globalThis.Notification;

afterEach(() => {
  if (originalNotification) {
    globalThis.Notification = originalNotification;
  } else {
    // @ts-expect-error cleanup mock
    delete globalThis.Notification;
  }
  vi.restoreAllMocks();
});

describe("desktopNotify", () => {
  it("reports unsupported when Notification is missing", () => {
    // @ts-expect-error test
    delete globalThis.Notification;
    expect(notificationSupport()).toBe("unsupported");
    expect(showDesktopNotification({ title: "x" })).toBe(false);
  });

  it("returns current permission when present", () => {
    const ctor = vi.fn();
    Object.defineProperty(ctor, "permission", {
      value: "granted",
      configurable: true,
    });
    Object.defineProperty(ctor, "requestPermission", {
      value: vi.fn(),
      configurable: true,
    });
    globalThis.Notification = ctor as unknown as typeof Notification;
    expect(notificationSupport()).toBe("granted");
  });

  it("requests permission only when default", async () => {
    const requestPermission = vi.fn().mockResolvedValue("granted");
    const ctor = vi.fn();
    Object.defineProperty(ctor, "permission", {
      value: "default",
      configurable: true,
    });
    Object.defineProperty(ctor, "requestPermission", {
      value: requestPermission,
      configurable: true,
    });
    globalThis.Notification = ctor as unknown as typeof Notification;
    await ensureNotifyPermission();
    expect(requestPermission).toHaveBeenCalledOnce();
  });

  it("constructs Notification when granted and forced", () => {
    const ctor = vi.fn();
    Object.defineProperty(ctor, "permission", {
      value: "granted",
      configurable: true,
    });
    Object.defineProperty(ctor, "requestPermission", {
      value: vi.fn(),
      configurable: true,
    });
    globalThis.Notification = ctor as unknown as typeof Notification;
    const ok = showDesktopNotification({
      title: "Agent finished",
      body: "Session ready",
      force: true,
      tag: "turn-done",
    });
    expect(ok).toBe(true);
    expect(ctor).toHaveBeenCalledWith("Agent finished", {
      body: "Session ready",
      tag: "turn-done",
      silent: false,
    });
  });

  it("does not notify when denied", () => {
    const ctor = vi.fn();
    Object.defineProperty(ctor, "permission", {
      value: "denied",
      configurable: true,
    });
    Object.defineProperty(ctor, "requestPermission", {
      value: vi.fn(),
      configurable: true,
    });
    globalThis.Notification = ctor as unknown as typeof Notification;
    expect(showDesktopNotification({ title: "x", force: true })).toBe(false);
    expect(ctor).not.toHaveBeenCalled();
  });
});
