// @vitest-environment happy-dom

import { act, renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import * as api from "@/lib/api";
import { createT } from "@/i18n";
import {
  IDLE_SNAPSHOT,
  type ChatMessage,
  type SessionSnapshot,
  type TurnErrorPayload,
} from "@/lib/session";
import {
  useComposer,
  type FallbackTurn,
  type UseComposerDeps,
} from "./useComposer";

const readySnapshot: SessionSnapshot = {
  ...IDLE_SNAPSHOT,
  sessionId: "session-1",
  state: "ready",
  lastError: null,
  backend: "pi_rpc",
};

function deps(over: Partial<UseComposerDeps> = {}): UseComposerDeps {
  const fallbackTurnRef = { current: null as FallbackTurn | null };
  const fallbackRetryRef = {
    current: vi.fn().mockResolvedValue(false),
  } as UseComposerDeps["fallbackRetryRef"];
  return {
    session: {
      sessionId: "session-1",
      state: "ready",
      title: "Current chat",
    },
    modelId: "model-a",
    availableModels: [
      { id: "model-a", label: "Model A" },
      { id: "model-b", label: "Model B" },
    ],
    modelRoles: {},
    fallbackChains: {},
    contextWindowPercent: null,
    compactionThresholdPercent: 85,
    draft: "hello",
    attachments: [],
    goalMode: false,
    mode: "agent",
    hasActiveProject: true,
    connecting: false,
    editingUserMessageId: null,
    tr: createT("en"),
    showToast: vi.fn(),
    setAppDialog: vi.fn(),
    setDraft: vi.fn(),
    setAttachments: vi.fn(),
    setPromptHistoryIndex: vi.fn(),
    promptHistoryIndexRef: { current: null },
    setSlashQuery: vi.fn(),
    setEditingUserMessageId: vi.fn(),
    setEditAttachments: vi.fn(),
    setRetryStatus: vi.fn(),
    setTurnStartedAt: vi.fn(),
    setSession: vi.fn(),
    setLiveHost: vi.fn(),
    setMessages: vi.fn(),
    setModelId: vi.fn(),
    setLocalError: vi.fn(),
    sendInFlightRef: { current: false },
    compactWaiterRef: { current: null },
    fallbackTurnRef,
    fallbackRetryRef,
    liveHostRef: { current: IDLE_SNAPSHOT },
    viewingSessionIdRef: { current: "session-1" },
    messagesBySessionRef: {
      current: new Map<string, ChatMessage[]>(),
    },
    automationSetupDraftRef: { current: false },
    automationSetupSessionsRef: { current: new Set<string>() },
    taskBatchDraftRef: { current: false },
    ensureConnected: vi.fn().mockResolvedValue("session-1"),
    patchSessionMessages: vi.fn(),
    applySessionTitle: vi.fn(),
    isPlaceholderTitle: vi.fn().mockReturnValue(false),
    ...over,
  };
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("useComposer", () => {
  it("sends a draft through the real session transport and clears the draft", async () => {
    vi.spyOn(api, "isTauri").mockReturnValue(false);
    const send = vi.spyOn(api, "sessionSend").mockResolvedValue(readySnapshot);
    const d = deps();
    const { result } = renderHook(() => useComposer(d));

    await act(async () => {
      await result.current.send();
    });

    expect(send).toHaveBeenCalledWith("hello", "hello", [], "session-1");
    expect(d.setDraft).toHaveBeenCalledWith("");
    expect(d.setAttachments).toHaveBeenCalledWith([]);
    expect(d.fallbackTurnRef.current?.sessionId).toBe("session-1");
  });

  it("opens the existing budget confirmation before dispatching", async () => {
    vi.spyOn(api, "isTauri").mockReturnValue(true);
    vi.spyOn(api, "usageBudgetStatus").mockResolvedValue({
      tier: "session",
      monthCost: 4,
      sessionCost: 2,
      monthlyLimit: 5,
      sessionLimit: 2,
      warning: false,
      requiresConfirm: true,
    });
    const send = vi.spyOn(api, "sessionSend").mockResolvedValue(readySnapshot);
    const d = deps();
    const { result } = renderHook(() => useComposer(d));

    await act(async () => {
      await result.current.send();
    });

    const dialog = vi.mocked(d.setAppDialog).mock.calls[0]?.[0];
    expect(dialog?.kind).toBe("confirm");
    expect(send).not.toHaveBeenCalled();
  });

  it("retries a transient turn on the next configured model", async () => {
    vi.spyOn(api, "isTauri").mockReturnValue(false);
    vi.spyOn(api, "sessionConnect").mockResolvedValue(readySnapshot);
    vi.spyOn(api, "sessionRewindDropLastUser").mockResolvedValue(readySnapshot);
    vi.spyOn(api, "sessionSetModel").mockResolvedValue(null);
    const send = vi.spyOn(api, "sessionSend").mockResolvedValue(readySnapshot);
    const d = deps({
      modelRoles: { primary: "model-a" },
      fallbackChains: { primary: ["model-a", "model-b"] },
    });
    const { result } = renderHook(() => useComposer(d));

    await act(async () => {
      await result.current.send();
    });
    const turn = d.fallbackTurnRef.current;
    expect(turn).not.toBeNull();

    let retried = false;
    await act(async () => {
      retried = await d.fallbackRetryRef.current(
        turn!,
        {} as TurnErrorPayload,
      );
    });

    expect(retried).toBe(true);
    expect(api.sessionSetModel).toHaveBeenCalledWith("model-b", {
      sessionId: "session-1",
    });
    expect(send).toHaveBeenCalledTimes(2);
  });
});
