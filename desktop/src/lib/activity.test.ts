import { describe, expect, it } from "vitest";
import {
  activityId,
  dismissActivity,
  loadActivity,
  markActivityRead,
  toggleActivityPin,
  upsertActivity,
  type ActivityItem,
} from "./activity";

function item(overrides: Partial<ActivityItem> = {}): ActivityItem {
  return {
    id: activityId("s1"),
    sessionId: "s1",
    projectId: "p1",
    projectName: "Project",
    title: "Build",
    modelId: "model-a",
    status: "running",
    detail: null,
    source: "session",
    createdAt: "2026-08-03T10:00:00.000Z",
    updatedAt: "2026-08-03T10:00:00.000Z",
    unread: true,
    pinned: false,
    dismissed: false,
    ...overrides,
  };
}

describe("activity state", () => {
  it("does not mutate the timestamp on identical polling data", () => {
    const first = upsertActivity([], {
      sessionId: "s1",
      title: "Build",
      modelId: "model-a",
      status: "running",
      now: "2026-08-03T10:00:00.000Z",
    });
    const second = upsertActivity(first, {
      sessionId: "s1",
      title: "Build",
      modelId: "model-a",
      status: "running",
      now: "2026-08-03T10:00:03.000Z",
    });
    expect(second).toEqual(first);
  });

  it("marks a changed state unread and clears a previous dismissal", () => {
    const previous = item({ unread: false, dismissed: true });
    const next = upsertActivity(
      [previous],
      {
        sessionId: "s1",
        status: "failed",
        detail: "Provider unavailable",
        source: "error",
        now: "2026-08-03T10:02:00.000Z",
      },
    )[0]!;
    expect(next.status).toBe("failed");
    expect(next.unread).toBe(true);
    expect(next.dismissed).toBe(false);
    expect(next.pinned).toBe(false);
  });

  it("keeps read and pin choices across a later status update", () => {
    const previous = item({ unread: false, pinned: true });
    const next = upsertActivity(
      [previous],
      { sessionId: "s1", status: "completed", now: "2026-08-03T10:03:00.000Z" },
    )[0]!;
    expect(next.pinned).toBe(true);
    expect(next.unread).toBe(true);
  });

  it("supports read, pin and dismiss actions without deleting pinned history", () => {
    const rows = [item(), item({ id: activityId("s2"), sessionId: "s2" })];
    const read = markActivityRead(rows, activityId("s1"));
    expect(read[0]!.unread).toBe(false);
    const pinned = toggleActivityPin(read, activityId("s1"));
    expect(pinned.find((row) => row.id === activityId("s1"))!.pinned).toBe(true);
    const dismissed = dismissActivity(pinned, activityId("s1"));
    expect(dismissed.some((row) => row.id === activityId("s1"))).toBe(true);
    expect(dismissActivity(dismissed, activityId("s2"))).toHaveLength(1);
  });

  it("ignores malformed storage rows", () => {
    const storage = { getItem: () => JSON.stringify([{ status: "wat" }, item()]) };
    expect(loadActivity(storage)).toHaveLength(1);
  });
});
