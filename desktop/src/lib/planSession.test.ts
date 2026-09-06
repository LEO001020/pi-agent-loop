import { describe, expect, it } from "vitest";
import {
  closedSessionPlan,
  emptySessionPlan,
  mergePlanFromEvent,
  shouldReopenClosedPlan,
} from "./planSession";

describe("planSession hard dismiss", () => {
  it("empty plan is not visible", () => {
    const p = emptySessionPlan("t");
    expect(p.visible).toBe(false);
    expect(p.userClosed).toBe(false);
    expect(p.entries).toEqual([]);
  });

  it("closed plan stays suppressed for same-cycle updates", () => {
    const closed = closedSessionPlan("t", "tool-1");
    expect(
      shouldReopenClosedPlan(
        closed,
        { toolCallId: "tool-1", entries: [{ content: "step", status: "pending" }] },
        "agent",
      ),
    ).toBe(false);

    const next = mergePlanFromEvent(
      closed,
      { toolCallId: "tool-1", entries: [{ content: "step", status: "in_progress" }] },
      "ready",
      "agent",
    );
    expect(next.userClosed).toBe(true);
    expect(next.visible).toBe(false);
    expect(next.entries).toEqual([]);
  });

  it("reopens when composer is plan mode", () => {
    const closed = closedSessionPlan("t", "tool-1");
    expect(
      shouldReopenClosedPlan(
        closed,
        { toolCallId: "tool-1", entries: [{ content: "a" }] },
        "plan",
      ),
    ).toBe(true);

    const next = mergePlanFromEvent(
      closed,
      { toolCallId: "tool-1", entries: [{ content: "a", status: "pending" }] },
      "ready",
      "plan",
    );
    expect(next.userClosed).toBe(false);
    expect(next.visible).toBe(true);
    expect(next.entries).toHaveLength(1);
  });

  it("reopens on new toolCallId (new plan tool)", () => {
    const closed = closedSessionPlan("t", "tool-1");
    const next = mergePlanFromEvent(
      closed,
      {
        toolCallId: "tool-2",
        entries: [{ content: "new", status: "pending" }],
      },
      "ready",
      "agent",
    );
    expect(next.userClosed).toBe(false);
    expect(next.visible).toBe(true);
    expect(next.toolCallId).toBe("tool-2");
  });

  it("reopens on exit_plan_mode rpcId", () => {
    const closed = closedSessionPlan("t", "tool-1");
    const next = mergePlanFromEvent(
      closed,
      { rpcId: 42, body: "# Plan\n..." },
      "ready",
      "agent",
    );
    expect(next.userClosed).toBe(false);
    expect(next.visible).toBe(true);
    expect(next.rpcId).toBe(42);
  });
});
