import { describe, expect, it } from "vitest";
import {
  dragPosNeedsScale,
  hitDragZoneFromRects,
  toClientDragPoint,
} from "./dragZone";

describe("dragPosNeedsScale", () => {
  it("mac keeps logical points (no scale)", () => {
    expect(dragPosNeedsScale("mac")).toBe(false);
  });

  it("win / other use physical → divide by scale", () => {
    expect(dragPosNeedsScale("win")).toBe(true);
    expect(dragPosNeedsScale("other")).toBe(true);
    expect(dragPosNeedsScale("linux")).toBe(true);
  });
});

describe("toClientDragPoint", () => {
  it("mac: use position as-is even when scaleFactor is 2", () => {
    expect(toClientDragPoint({ x: 400, y: 100 }, 2, "mac")).toEqual({
      x: 400,
      y: 100,
    });
  });

  it("win: divide by scaleFactor", () => {
    expect(toClientDragPoint({ x: 800, y: 200 }, 2, "win")).toEqual({
      x: 400,
      y: 100,
    });
  });
});

describe("hitDragZoneFromRects", () => {
  const sidebar = {
    left: 0,
    right: 268,
    top: 0,
    bottom: 800,
    width: 268,
  };

  it("only the real sidebar width is project zone", () => {
    expect(hitDragZoneFromRects(100, 200, sidebar, false)).toBe("sidebar");
    expect(hitDragZoneFromRects(267, 200, sidebar, false)).toBe("sidebar");
  });

  it("just past sidebar edge is main (attach), not half-window", () => {
    expect(hitDragZoneFromRects(268, 200, sidebar, false)).toBe("main");
    expect(hitDragZoneFromRects(300, 200, sidebar, false)).toBe("main");
    // Mid-window must never be project just because it is left of center
    expect(hitDragZoneFromRects(500, 200, sidebar, false)).toBe("main");
  });

  it("collapsed or missing sidebar is always main", () => {
    expect(hitDragZoneFromRects(50, 200, sidebar, true)).toBe("main");
    expect(hitDragZoneFromRects(50, 200, null, false)).toBe("main");
    expect(
      hitDragZoneFromRects(50, 200, { ...sidebar, width: 0 }, false),
    ).toBe("main");
  });

  it("outside vertical bounds is main", () => {
    expect(hitDragZoneFromRects(100, -10, sidebar, false)).toBe("main");
    expect(hitDragZoneFromRects(100, 900, sidebar, false)).toBe("main");
  });
});
