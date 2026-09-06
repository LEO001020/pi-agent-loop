import { describe, expect, it } from "vitest";
import {
  formatPermissionSummary,
  mapPermissionButtons,
  permissionDecisionHint,
} from "./permissionOptions";

describe("mapPermissionButtons (shipped)", () => {
  it("maps ACP optionIds from real options list", () => {
    const buttons = mapPermissionButtons([
      { optionId: "allow_once", name: "Allow once", kind: "allow_once" },
      { optionId: "allow_always", name: "Allow always", kind: "allow_always" },
      { optionId: "reject", name: "Reject", kind: "reject_once" },
    ]);
    expect(buttons.map((b) => b.optionId)).toEqual([
      "allow_once",
      "allow_always",
      "reject",
    ]);
    expect(buttons.map((b) => b.decision)).toEqual([
      "allow_once",
      "allow_session",
      "deny",
    ]);
  });

  it("falls back when options empty", () => {
    const buttons = mapPermissionButtons([]);
    expect(buttons).toHaveLength(3);
    expect(buttons[0]!.decision).toBe("allow_once");
    expect(buttons[2]!.decision).toBe("deny");
  });

  it("prefers short i18n labels over long agent names", () => {
    const buttons = mapPermissionButtons(
      [{ optionId: "allow_once", name: "Allow this bash command once", kind: "allow_once" }],
      { allowOnce: "Allow once", allowSession: "Allow for session", deny: "Deny" },
    );
    expect(buttons[0]!.label).toBe("Allow once");
  });
});

describe("formatPermissionSummary", () => {
  it("prefers command text when present", () => {
    expect(
      formatPermissionSummary({
        toolName: "bash",
        command: "rm -rf /tmp/foo",
      }),
    ).toBe("bash: rm -rf /tmp/foo");
  });

  it("falls back to path", () => {
    expect(
      formatPermissionSummary({
        toolName: "write",
        path: "src/App.tsx",
      }),
    ).toBe("write · src/App.tsx");
  });

  it("truncates long commands", () => {
    const long = "x".repeat(120);
    const s = formatPermissionSummary({ command: long });
    expect(s.endsWith("…")).toBe(true);
    expect(s.length).toBeLessThan(long.length);
  });
});

describe("permissionDecisionHint", () => {
  it("explains once / session / deny", () => {
    expect(permissionDecisionHint("allow_once")).toMatch(/once/i);
    expect(permissionDecisionHint("allow_session")).toMatch(/session|chat/i);
    expect(permissionDecisionHint("deny")).toMatch(/block/i);
  });
});
