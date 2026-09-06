// @vitest-environment happy-dom

import { act, renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { useAppearance } from "./useAppearance";

vi.mock("@/assets/land-default.jpg", () => ({ default: "default-wallpaper" }));

const saveWallpaper = vi.fn<(record: unknown) => Promise<void>>();
const clearWallpaper = vi.fn<() => Promise<void>>();

vi.mock("@/lib/themeSkin", async () => {
  const actual = await vi.importActual<Record<string, unknown>>("@/lib/themeSkin");
  return {
    ...actual,
    saveWallpaper: (record: unknown) => saveWallpaper(record),
    clearWallpaper: () => clearWallpaper(),
    loadWallpaperRecord: () => Promise.resolve(null),
  };
});

function record(kind: "image" | "video" = "image") {
  return { kind, blob: new Blob(["x"]) } as never;
}

describe("useAppearance", () => {
  beforeEach(() => {
    localStorage.clear();
    saveWallpaper.mockReset().mockResolvedValue(undefined);
    clearWallpaper.mockReset().mockResolvedValue(undefined);
    globalThis.URL.createObjectURL = vi.fn(() => "blob:new") as never;
    globalThis.URL.revokeObjectURL = vi.fn() as never;
  });

  function mount(onError = vi.fn()) {
    const view = renderHook(() =>
      useAppearance({ workspace: "code", onError }),
    );
    return { ...view, onError };
  }

  it("persists a theme choice, not just the render", () => {
    const { result } = mount();
    act(() => result.current.applyThemeChoice("light"));
    expect(result.current.theme).toBe("light");
    // Remounting is the only honest check that it survives a launch.
    const again = mount();
    expect(again.result.current.theme).toBe("light");
  });

  it("records a skin against the workspace that owns it", () => {
    const { result } = mount();
    act(() => result.current.applySkinChoice("ocean", "pr"));
    expect(result.current.workspaceSkins.pr).toBe("ocean");
    // The workspace the user is *in* must not inherit it.
    expect(result.current.workspaceSkins.code).not.toBe("ocean");
  });

  it("applies a skin without claiming it for a workspace", () => {
    const { result } = mount();
    act(() => result.current.applySkinOnly("ocean"));
    expect(result.current.skin).toBe("ocean");
    // The map keeps every workspace at its default until one is claimed.
    expect(result.current.workspaceSkins.code).toBe("default");
  });

  /**
   * Storage first, state second. If the write fails the user must keep the
   * wallpaper they had, rather than see one that will not survive a restart.
   */
  it("keeps the old wallpaper when the write fails", async () => {
    saveWallpaper.mockRejectedValue(new Error("disk full"));
    const { result, onError } = mount();
    const before = result.current.wallpaperUrl;

    await act(async () => {
      await result.current.applyWallpaperChoice(record());
    });

    expect(result.current.wallpaperUrl).toBe(before);
    expect(result.current.wallpaperRecord).toBeNull();
    expect(onError).toHaveBeenCalledWith(expect.stringContaining("disk full"));
  });

  it("keeps the current wallpaper when clearing fails", async () => {
    const { result, onError } = mount();
    await act(async () => {
      await result.current.applyWallpaperChoice(record());
    });
    const applied = result.current.wallpaperUrl;

    clearWallpaper.mockRejectedValue(new Error("locked"));
    await act(async () => {
      await result.current.applyWallpaperChoice(null);
    });

    expect(result.current.wallpaperUrl).toBe(applied);
    expect(onError).toHaveBeenCalledWith(expect.stringContaining("locked"));
  });

  /** A replaced blob URL is otherwise held for the document's lifetime. */
  it("revokes the previous object URL when the wallpaper is replaced", async () => {
    const { result } = mount();
    await act(async () => {
      await result.current.applyWallpaperChoice(record());
    });
    expect(globalThis.URL.revokeObjectURL).not.toHaveBeenCalled();

    await act(async () => {
      await result.current.applyWallpaperChoice(record("video"));
    });
    expect(globalThis.URL.revokeObjectURL).toHaveBeenCalledTimes(1);
  });

  it("revokes the object URL when the shell goes away", async () => {
    const { result, unmount } = mount();
    await act(async () => {
      await result.current.applyWallpaperChoice(record());
    });
    unmount();
    expect(globalThis.URL.revokeObjectURL).toHaveBeenCalled();
  });

  /** Scrim is a 0-100 integer percentage, not a 0-1 fraction. */
  it("persists the scrim strength", () => {
    const { result } = mount();
    act(() => result.current.applyWallpaperScrimChoice(42));
    expect(result.current.wallpaperScrim).toBe(42);
    expect(mount().result.current.wallpaperScrim).toBe(42);
  });
});
