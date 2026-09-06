// @vitest-environment happy-dom

import { act, renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import * as api from "@/lib/api";
import { createT } from "@/i18n";
import type { Automation } from "@/lib/automations";
import { IDLE_SNAPSHOT, type ChatMessage } from "@/lib/session";
import {
  useAutomationRunner,
  type AutomationRunnerDeps,
} from "./useAutomationRunner";

function deps(over: Partial<AutomationRunnerDeps> = {}): AutomationRunnerDeps {
  return {
    projects: [],
    sessionState: "ready",
    connecting: false,
    tr: createT("en"),
    showToast: vi.fn(),
    setToast: vi.fn(),
    setLocalError: vi.fn(),
    setMainPane: vi.fn(),
    setAppView: vi.fn(),
    setActiveProject: vi.fn(),
    setExpandedProjects: vi.fn(),
    setHistoryOpen: vi.fn(),
    setMessages: vi.fn(),
    setAttachments: vi.fn(),
    setPerm: vi.fn(),
    setAskUser: vi.fn(),
    setRetryStatus: vi.fn(),
    setDraft: vi.fn(),
    setSession: vi.fn(),
    setLiveHost: vi.fn(),
    refreshSessions: vi.fn().mockResolvedValue(undefined),
    messagesBySessionRef: { current: new Map<string, ChatMessage[]>() },
    viewingSessionIdRef: { current: null },
    openingSessionIdRef: { current: null },
    liveHostRef: { current: IDLE_SNAPSHOT },
    ...over,
  };
}

const automation: Automation = {
  id: "auto-1",
  title: "Morning review",
  prompt: "Review the open work.",
  enabled: true,
  projectId: null,
  modelId: null,
  effort: null,
  frequency: "once",
  time: "09:00",
  weekdays: [],
  notify: "all",
  createdAt: "2026-08-03T08:00:00.000Z",
  updatedAt: "2026-08-03T08:00:00.000Z",
};

afterEach(() => {
  vi.restoreAllMocks();
});

describe("useAutomationRunner", () => {
  it("does not launch a scheduled run while another turn is streaming", async () => {
    const d = deps({ sessionState: "streaming" });
    const { result } = renderHook(() => useAutomationRunner(d));

    let ran = true;
    await act(async () => {
      ran = await result.current(automation, { fromScheduler: true });
    });

    expect(ran).toBe(false);
    expect(d.refreshSessions).not.toHaveBeenCalled();
  });

  it("sends the manual run to the created session and marks it complete", async () => {
    vi.spyOn(api, "isTauri").mockReturnValue(true);
    vi.spyOn(api, "sessionDisconnect").mockResolvedValue(IDLE_SNAPSHOT);
    vi.spyOn(api, "sessionCreate").mockResolvedValue({ id: "session-1" });
    vi.spyOn(api, "sessionConnect").mockResolvedValue({
      ...IDLE_SNAPSHOT,
      sessionId: "session-1",
      state: "ready",
      backend: "pi_rpc",
    });
    const send = vi.spyOn(api, "sessionSend").mockResolvedValue(IDLE_SNAPSHOT);
    vi.spyOn(api, "automationRunStart").mockResolvedValue({
      id: "run-1",
      automationId: "auto-1",
      sessionId: "session-1",
      trigger: "manual",
      attempt: 1,
      startedAt: "2026-08-03T08:00:00.000Z",
      updatedAt: "2026-08-03T08:00:00.000Z",
      ranLate: false,
      status: "started",
      triage: "none",
    });
    vi.spyOn(api, "automationMarkRun").mockResolvedValue({} as never);
    vi.spyOn(api, "automationSetEnabled").mockResolvedValue({} as never);
    const d = deps();
    const { result } = renderHook(() => useAutomationRunner(d));

    let ran = false;
    await act(async () => {
      ran = await result.current(automation);
    });

    expect(ran).toBe(true);
    expect(send).toHaveBeenCalledWith(
      "[Scheduled: Morning review]\n\nReview the open work.",
      null,
      null,
      "session-1",
    );
    expect(api.automationMarkRun).toHaveBeenCalledWith(
      "auto-1",
      expect.any(String),
      null,
    );
    expect(api.automationSetEnabled).toHaveBeenCalledWith("auto-1", false);
  });
});
