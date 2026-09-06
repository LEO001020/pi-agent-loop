import { describe, expect, it } from "vitest";
import { shouldRestoreLastSession } from "./sessionRestore";

const sessions = [
  { id: "s1", archived: false },
  { id: "s2", archived: true },
  { id: "s3" },
];

describe("shouldRestoreLastSession", () => {
  it("restores when enabled, workbench ready, and session is live", () => {
    expect(
      shouldRestoreLastSession({
        enabled: true,
        workbenchReady: true,
        lastSessionId: "s1",
        sessions,
      }),
    ).toBe("s1");
    expect(
      shouldRestoreLastSession({
        enabled: true,
        workbenchReady: true,
        lastSessionId: "  s3  ",
        sessions,
      }),
    ).toBe("s3");
  });

  it("no-ops when toggle is off or workbench not ready", () => {
    expect(
      shouldRestoreLastSession({
        enabled: false,
        workbenchReady: true,
        lastSessionId: "s1",
        sessions,
      }),
    ).toBeNull();
    expect(
      shouldRestoreLastSession({
        enabled: true,
        workbenchReady: false,
        lastSessionId: "s1",
        sessions,
      }),
    ).toBeNull();
  });

  it("no-ops when id missing, unknown, or archived", () => {
    expect(
      shouldRestoreLastSession({
        enabled: true,
        workbenchReady: true,
        lastSessionId: null,
        sessions,
      }),
    ).toBeNull();
    expect(
      shouldRestoreLastSession({
        enabled: true,
        workbenchReady: true,
        lastSessionId: "   ",
        sessions,
      }),
    ).toBeNull();
    expect(
      shouldRestoreLastSession({
        enabled: true,
        workbenchReady: true,
        lastSessionId: "gone",
        sessions,
      }),
    ).toBeNull();
    expect(
      shouldRestoreLastSession({
        enabled: true,
        workbenchReady: true,
        lastSessionId: "s2",
        sessions,
      }),
    ).toBeNull();
  });

  it("no-ops when already viewing a session", () => {
    expect(
      shouldRestoreLastSession({
        enabled: true,
        workbenchReady: true,
        lastSessionId: "s1",
        sessions,
        currentSessionId: "s1",
      }),
    ).toBeNull();
    expect(
      shouldRestoreLastSession({
        enabled: true,
        workbenchReady: true,
        lastSessionId: "s1",
        sessions,
        currentSessionId: "other",
      }),
    ).toBeNull();
  });
});
