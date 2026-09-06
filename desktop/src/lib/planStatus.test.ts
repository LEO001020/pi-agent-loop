import { describe, expect, it } from "vitest";
import { canExitPlanMode } from "./planStatus";

describe("canExitPlanMode", () => {
  it("allows leaving plan mode when no review gate is pending", () => {
    expect(canExitPlanMode({ mode: "plan", planRpcId: null })).toBe(true);
  });

  it("keeps review decisions on their explicit approve/revise/abandon path", () => {
    expect(canExitPlanMode({ mode: "plan", planRpcId: 42 })).toBe(false);
    expect(canExitPlanMode({ mode: "agent", planRpcId: null })).toBe(false);
  });
});
