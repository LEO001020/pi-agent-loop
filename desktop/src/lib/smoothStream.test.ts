import { describe, expect, it } from "vitest";
import {
  charsToReveal,
  nextDisplayedLength,
  stepDisplayed,
} from "./smoothStream";

describe("charsToReveal", () => {
  it("returns 0 for empty backlog", () => {
    expect(charsToReveal(0)).toBe(0);
    expect(charsToReveal(-1)).toBe(0);
  });

  it("drips slowly for small backlog", () => {
    expect(charsToReveal(1)).toBe(1);
    expect(charsToReveal(3)).toBe(1);
    expect(charsToReveal(8)).toBe(2);
    expect(charsToReveal(20)).toBe(4);
  });

  it("speeds up as backlog grows", () => {
    expect(charsToReveal(50)).toBe(8);
    expect(charsToReveal(150)).toBe(16);
    expect(charsToReveal(400)).toBeGreaterThan(charsToReveal(150));
    expect(charsToReveal(1000)).toBeGreaterThan(charsToReveal(400));
    expect(charsToReveal(1000)).toBeGreaterThan(200);
  });

  it("never exceeds backlog", () => {
    for (const b of [1, 5, 30, 100, 999]) {
      expect(charsToReveal(b)).toBeLessThanOrEqual(b);
    }
  });
});

describe("nextDisplayedLength", () => {
  it("clamps at target", () => {
    expect(nextDisplayedLength(10, 10)).toBe(10);
    expect(nextDisplayedLength(12, 10)).toBe(10);
  });

  it("advances toward target", () => {
    expect(nextDisplayedLength(0, 100)).toBeGreaterThan(0);
    expect(nextDisplayedLength(0, 100)).toBeLessThanOrEqual(100);
  });
});

describe("stepDisplayed", () => {
  it("reveals a prefix of target from empty", () => {
    const next = stepDisplayed("", "hello world");
    expect(targetStartsWith(next, "hello world")).toBe(true);
    expect(next.length).toBeGreaterThan(0);
    expect(next.length).toBeLessThanOrEqual("hello world".length);
  });

  it("appends when displayed is a prefix", () => {
    const next = stepDisplayed("hel", "hello world");
    expect(next.startsWith("hel")).toBe(true);
    expect(next.length).toBeGreaterThan(3);
  });

  it("snaps when target is replaced", () => {
    expect(stepDisplayed("old text", "brand new")).toBe("brand new");
  });

  it("returns target when already caught up", () => {
    expect(stepDisplayed("done", "done")).toBe("done");
  });

  it("eventually reaches full text", () => {
    let shown = "";
    const target = "这是一段中文流式输出测试内容，用来验证缓冲池。";
    for (let i = 0; i < 200 && shown !== target; i++) {
      shown = stepDisplayed(shown, target);
    }
    expect(shown).toBe(target);
  });

  it("catches large dumps quickly", () => {
    const target = "x".repeat(2000);
    let shown = "";
    let steps = 0;
    while (shown !== target && steps < 60) {
      shown = stepDisplayed(shown, target);
      steps++;
    }
    expect(shown).toBe(target);
    // ~30 frames @ 60fps ≈ 500ms — still feels snappy, not laggy.
    expect(steps).toBeLessThan(35);
  });
});

function targetStartsWith(prefix: string, target: string): boolean {
  return target.startsWith(prefix);
}
