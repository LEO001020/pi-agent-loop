import { describe, expect, it } from "vitest";
import {
  EMPTY_PI_EXTENSION_UI,
  piExtensionWidgetsAt,
  reducePiExtensionUi,
} from "./piExtensionUi";

describe("Pi extension UI reducer", () => {
  it("sets and clears keyed status text", () => {
    const set = reducePiExtensionUi(EMPTY_PI_EXTENSION_UI, {
      method: "setStatus",
      statusKey: "build",
      statusText: "Indexing project",
    });
    expect(set.statuses).toEqual({ build: "Indexing project" });

    const cleared = reducePiExtensionUi(set, {
      method: "setStatus",
      statusKey: "build",
    });
    expect(cleared.statuses).toEqual({});
  });

  it("keeps widget placement and clears missing lines", () => {
    const set = reducePiExtensionUi(EMPTY_PI_EXTENSION_UI, {
      method: "setWidget",
      widgetKey: "tests",
      widgetLines: ["Tests", "12 passed"],
      widgetPlacement: "belowEditor",
    });
    expect(piExtensionWidgetsAt(set, "belowEditor")).toEqual([
      {
        key: "tests",
        lines: ["Tests", "12 passed"],
        placement: "belowEditor",
      },
    ]);

    const cleared = reducePiExtensionUi(set, {
      method: "setWidget",
      widgetKey: "tests",
    });
    expect(cleared.widgets).toEqual({});
  });

  it("bounds untrusted extension content", () => {
    const set = reducePiExtensionUi(EMPTY_PI_EXTENSION_UI, {
      method: "setWidget",
      widgetKey: "long",
      widgetLines: Array.from({ length: 40 }, (_, i) => `${i}`.repeat(700)),
    });
    expect(set.widgets.long.lines).toHaveLength(24);
    expect(set.widgets.long.lines[0].length).toBeLessThanOrEqual(500);
  });
});
