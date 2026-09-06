// @vitest-environment happy-dom

import { act, renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createT } from "@/i18n";
import * as api from "@/lib/api";
import { emptySessionPlan } from "@/lib/planSession";
import { IDLE_SNAPSHOT } from "@/lib/session";
import {
  useSessionLifecycle,
  type SessionLifecycleDeps,
} from "./useSessionLifecycle";

afterEach(() => {
  vi.restoreAllMocks();
});

function deps(over: Partial<SessionLifecycleDeps> = {}): SessionLifecycleDeps {
  return {
    projects: [],
    sessions: [],
    activeProject: null,
    session: { ...IDLE_SNAPSHOT, sessionId: "session-1", state: "idle" },
    connecting: false,
    mode: "agent",
    remoteRuntime: {
      enabled: false,
      verified: false,
      transport: "ssh",
      directUrl: "",
      directTokenConfigured: false,
      host: "",
      user: "",
      port: 22,
      identityFile: "",
      piPath: "pi",
      cwd: "~",
    },
    resourceProjectPath: null,
    appGate: "loading",
    reopenLastSession: true,
    lastSessionId: null,
    tr: createT("en"),
    refreshSessions: vi.fn().mockResolvedValue(undefined),
    tryApplyAutomationFromSession: vi.fn().mockResolvedValue(undefined),
    messagesBySessionRef: { current: new Map() },
    messagesRef: { current: [] },
    viewingSessionIdRef: { current: "session-1" },
    openingSessionIdRef: { current: null },
    planBySessionRef: { current: new Map() },
    planRef: { current: emptySessionPlan() },
    liveHostRef: { current: IDLE_SNAPSHOT },
    setMainPane: vi.fn(),
    setAppView: vi.fn(),
    setMessages: vi.fn(),
    setContextUsage: vi.fn(),
    setSessionChangesById: vi.fn(),
    setPlan: vi.fn(),
    setEditingUserMessageId: vi.fn(),
    setEditAttachments: vi.fn(),
    setSessions: vi.fn(),
    setActiveProject: vi.fn(),
    setRemoteWorkspacePath: vi.fn(),
    setAttachments: vi.fn(),
    setSession: vi.fn(),
    setLiveHost: vi.fn(),
    setLocalError: vi.fn(),
    setPerm: vi.fn(),
    setAskUser: vi.fn(),
    setRetryStatus: vi.fn(),
    setLastSessionId: vi.fn(),
    setConnecting: vi.fn(),
    setExpandedProjects: vi.fn(),
    setHistoryOpen: vi.fn(),
    ...over,
  };
}

describe("useSessionLifecycle", () => {
  it("connects the explicitly addressed session and returns its id", async () => {
    vi.spyOn(api, "isTauri").mockReturnValue(true);
    const connect = vi.spyOn(api, "sessionConnect").mockResolvedValue({
      ...IDLE_SNAPSHOT,
      sessionId: "session-1",
      state: "ready",
      backend: "pi_rpc",
    });
    const d = deps();
    const { result } = renderHook(() => useSessionLifecycle(d));

    let connected: string | null = null;
    await act(async () => {
      connected = await result.current.ensureConnected({ sessionId: "session-1" });
    });

    expect(connected).toBe("session-1");
    expect(connect).toHaveBeenCalledWith({
      projectPath: undefined,
      remotePath: undefined,
      sessionId: "session-1",
      mode: "agent",
    });
    expect(d.setLiveHost).toHaveBeenCalled();
  });

  it("loads a stored transcript into the existing workbench session", async () => {
    vi.spyOn(api, "isTauri").mockReturnValue(false);
    const messages = vi.spyOn(api, "sessionMessages").mockResolvedValue([
      {
        id: "user-1",
        role: "user",
        content: "hello",
        createdAt: "2026-08-03T00:00:00.000Z",
      },
    ]);
    const d = deps({ viewingSessionIdRef: { current: null } });
    const { result } = renderHook(() => useSessionLifecycle(d));

    await act(async () => {
      await result.current.openSession({
        id: "session-2",
        title: "Stored chat",
        projectId: null,
        updatedAt: "2026-08-03T00:00:00.000Z",
      });
    });

    expect(messages).toHaveBeenCalledWith("session-2");
    expect(d.viewingSessionIdRef.current).toBe("session-2");
    expect(d.setMessages).toHaveBeenCalledWith([
      expect.objectContaining({
        id: "user-1",
        role: "user",
        content: "hello",
        streaming: false,
      }),
    ]);
    expect(d.setSession).toHaveBeenCalledWith(
      expect.objectContaining({
        sessionId: "session-2",
        state: "idle",
        title: "Stored chat",
      }),
    );
  });
});
