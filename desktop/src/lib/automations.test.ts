import { describe, expect, it } from "vitest";
import {
  computeNextRunAt,
  isDue,
  formatScheduleSummary,
  parseScheduledUserContent,
} from "./automations";

describe("automations schedule helpers", () => {
  it("computes next daily run after now", () => {
    const from = new Date("2026-07-22T08:00:00");
    const next = computeNextRunAt(
      { frequency: "daily", time: "09:00", weekdays: [], enabled: true },
      from,
    );
    expect(next).toBeTruthy();
    const d = new Date(next!);
    expect(d.getHours()).toBe(9);
    expect(d.getMinutes()).toBe(0);
    expect(d.getTime()).toBeGreaterThan(from.getTime());
  });

  it("returns null when disabled", () => {
    expect(
      computeNextRunAt(
        { frequency: "daily", time: "09:00", weekdays: [], enabled: false },
        new Date(),
      ),
    ).toBeNull();
  });

  it("detects due when nextRunAt is past", () => {
    const past = new Date(Date.now() - 5_000).toISOString();
    expect(
      isDue({
        id: "1",
        title: "t",
        prompt: "p",
        enabled: true,
        projectId: null,
        modelId: null,
        effort: null,
        frequency: "daily",
        time: "09:00",
        weekdays: [],
        notify: "all",
        createdAt: past,
        updatedAt: past,
        nextRunAt: past,
      }),
    ).toBe(true);
  });

  it("formats schedule summary", () => {
    const s = formatScheduleSummary(
      { frequency: "daily", time: "07:00", weekdays: [] },
      {
        daily: "Daily",
        weekly: "Weekly",
        weekdays: "Weekdays",
        once: "Once",
        at: "at",
      },
    );
    expect(s).toContain("Daily");
    expect(s).toContain("07:00");
  });

  it("parses scheduled user header into title + body", () => {
    const raw =
      "[Scheduled: cgnot996 动态快检（对话 JSON 承接）]\n\n作为已安排任务：打开 X";
    const p = parseScheduledUserContent(raw);
    expect(p?.title).toBe("cgnot996 动态快检（对话 JSON 承接）");
    expect(p?.body).toContain("打开 X");
    expect(parseScheduledUserContent("普通消息")).toBeNull();
  });
});
