// @vitest-environment happy-dom

import { act, renderHook } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { createT } from "@/i18n";
import type { ChatMessage } from "@/lib/session";
import {
  useRewindDialogs,
  type RewindDialogsDeps,
} from "./useRewindDialogs";

function deps(messages: ChatMessage[]): RewindDialogsDeps {
  return {
    canRewindSession: true,
    activeSessionId: "session-1",
    sessionState: "ready",
    messages,
    rewindBusy: false,
    setRewindBusy: vi.fn(),
    messagesRef: { current: messages },
    viewingSessionIdRef: { current: "session-1" },
    messagesBySessionRef: { current: new Map() },
    ensureConnected: vi.fn().mockResolvedValue(undefined),
    refreshSessions: vi.fn().mockResolvedValue(undefined),
    setMessages: vi.fn(),
    setCtxMenu: vi.fn(),
    showToast: vi.fn(),
    tr: createT("en"),
  };
}

const messages: ChatMessage[] = [
  { id: "user-1", role: "user", content: "first", createdAt: "2026-08-03" },
  { id: "assistant-1", role: "assistant", content: "one", createdAt: "2026-08-03" },
  { id: "user-2", role: "user", content: "second", createdAt: "2026-08-03" },
  { id: "assistant-2", role: "assistant", content: "two", createdAt: "2026-08-03" },
];

describe("useRewindDialogs", () => {
  it("opens confirmation for an earlier user turn", () => {
    const d = deps(messages);
    const { result } = renderHook(() => useRewindDialogs(d));

    act(() => result.current.onRewindToUserMessage(messages[0]!));

    expect(result.current.rewindConfirm).toEqual({
      sessionId: "session-1",
      targetPromptIndex: 0,
      preview: "first",
    });
    expect(d.setCtxMenu).toHaveBeenCalledWith(null);
  });

  it("explains that rewind needs the desktop host in a browser preview", async () => {
    const d = deps(messages);
    const { result } = renderHook(() => useRewindDialogs(d));

    await act(async () => {
      await result.current.openRewindTimeline("session-1");
    });

    expect(d.showToast).toHaveBeenCalledWith(createT("en")("error.needTauri"));
  });
});
