import { describe, expect, it } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { ThinkingOrbInline } from "./ThinkingOrbInline";
import {
  INLINE_ORB_STATE_MAP,
  inlineOrbStateForTool,
} from "./thinkingOrbState";

describe("thinking orb state", () => {
  it("maps quiet, active, search and completed states semantically", () => {
    expect(INLINE_ORB_STATE_MAP).toEqual({
      thinking: "composing",
      working: "working",
      searching: "searching",
      done: "shaping",
    });
    expect(INLINE_ORB_STATE_MAP.done).not.toBe("solving");
  });

  it("keeps the decorative canvas out of the accessible name", () => {
    const markup = renderToStaticMarkup(
      createElement(ThinkingOrbInline, {
        state: "done",
        paused: true,
      }),
    );

    expect(markup).toContain('aria-hidden="true"');
    expect(markup).not.toContain("Solving");
  });

  it("uses searching for web and browser activity", () => {
    expect(
      inlineOrbStateForTool({
        toolKind: "browser",
        content: "Opening pi.dev",
      }),
    ).toBe("searching");
    expect(
      inlineOrbStateForTool({
        toolKind: "bash",
        toolDetail: "curl https://pi.dev/packages",
        content: "Reading package catalog",
      }),
    ).toBe("searching");
  });

  it("uses working for commands, edits and local file activity", () => {
    expect(
      inlineOrbStateForTool({
        toolKind: "bash",
        toolDetail: "pnpm test",
        content: "Running tests",
      }),
    ).toBe("working");
    expect(
      inlineOrbStateForTool({
        toolKind: "apply_patch",
        toolPath: "src/App.tsx",
        content: "Updating App.tsx",
      }),
    ).toBe("working");
  });
});
