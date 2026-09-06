// @vitest-environment happy-dom

import { act, renderHook } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import {
  activityDepsForTests,
  useActivityCenter,
} from "./useActivityCenter";

function storage() {
  const values = new Map<string, string>();
  return {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => values.set(key, value),
  };
}

describe("useActivityCenter", () => {
  it("projects an attention event, persists it, and supports read/pin actions", () => {
    const persisted = storage();
    const { result } = renderHook(() =>
      useActivityCenter(
        activityDepsForTests({
          storage: persisted,
          sessionsRef: {
            current: [
              {
                id: "session-1",
                title: "Remote review",
                projectId: "project-1",
                modelId: "model-a",
              },
            ],
            
          },
          projectsRef: {
            current: [{ id: "project-1", name: "Monark" }],
          },
          translate: (key) => (key === "session.new" ? "New session" : key),
        }),
      ),
    );

    act(() => {
      result.current.record({
        sessionId: "session-1",
        status: "awaiting_permission",
        source: "permission",
        detail: "Approve the command",
      });
    });

    expect(result.current.activityItems[0]).toMatchObject({
      sessionId: "session-1",
      projectName: "Monark",
      title: "Remote review",
      status: "awaiting_permission",
      unread: true,
    });
    expect(persisted.getItem("pi-app.activity.v1")).toContain("session-1");

    act(() => result.current.markRead("session:session-1"));
    act(() => result.current.togglePin("session:session-1"));

    expect(result.current.activityItems[0]).toMatchObject({
      unread: false,
      pinned: true,
    });
  });
});
