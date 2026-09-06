import { describe, expect, it } from "vitest";
import {
  DEFAULT_LAYOUT,
  loadLayout,
  parseLayout,
  saveLayout,
  clampAsideWidth,
  fitWorkbenchToViewport,
  openWorkbenchPane,
  ASIDE_WIDTH_MIN,
  ASIDE_WIDTH_MAX,
  LAYOUT_STORAGE_KEY,
} from "./layout";

describe("layout prefs", () => {
  it("defaults right pane collapsed", () => {
    expect(DEFAULT_LAYOUT.asideCollapsed).toBe(true);
  });

  it("round-trips widths; right pane always starts collapsed", () => {
    const data: Record<string, string> = {};
    const storage = {
      getItem: (k: string) => data[k] ?? null,
      setItem: (k: string, v: string) => {
        data[k] = v;
      },
    };
    saveLayout(storage, {
      sidebarWidth: 280,
      asideWidth: 320,
      asideCollapsed: false,
      sidebarCollapsed: true,
    });
    expect(data[LAYOUT_STORAGE_KEY]).toBeTruthy();
    const loaded = loadLayout(storage);
    // Open state is not restored across app launches.
    expect(loaded.asideCollapsed).toBe(true);
    expect(loaded.sidebarWidth).toBe(280);
    expect(loaded.asideWidth).toBe(320);
    expect(loaded.sidebarCollapsed).toBe(true);
  });

  it("parseLayout falls back safely", () => {
    expect(parseLayout(null).asideCollapsed).toBe(true);
    expect(parseLayout(null).sidebarCollapsed).toBe(false);
  });

  it("clamps aside width", () => {
    expect(clampAsideWidth(100)).toBe(ASIDE_WIDTH_MIN);
    expect(clampAsideWidth(9999)).toBe(ASIDE_WIDTH_MAX);
    expect(clampAsideWidth(400)).toBe(400);
  });

  it("keeps narrow workbench drawers mutually exclusive", () => {
    const open = {
      ...DEFAULT_LAYOUT,
      sidebarCollapsed: false,
      asideCollapsed: false,
    };
    expect(openWorkbenchPane(open, "sidebar", true)).toMatchObject({
      sidebarCollapsed: false,
      asideCollapsed: true,
    });
    expect(openWorkbenchPane(open, "aside", true)).toMatchObject({
      sidebarCollapsed: true,
      asideCollapsed: false,
    });
    expect(fitWorkbenchToViewport(open, true)).toMatchObject({
      sidebarCollapsed: true,
      asideCollapsed: false,
    });
    expect(
      fitWorkbenchToViewport({ ...open, asideCollapsed: true }, true),
    ).toMatchObject({
      sidebarCollapsed: true,
      asideCollapsed: true,
    });
  });

  it("does not collapse desktop panes", () => {
    const open = {
      ...DEFAULT_LAYOUT,
      sidebarCollapsed: false,
      asideCollapsed: false,
    };
    expect(fitWorkbenchToViewport(open, false)).toBe(open);
    expect(openWorkbenchPane(open, "aside", false)).toMatchObject({
      sidebarCollapsed: false,
      asideCollapsed: false,
    });
  });
});
