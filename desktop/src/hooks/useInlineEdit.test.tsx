// @vitest-environment happy-dom

import { act, renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import * as api from "@/lib/api";
import { createT } from "@/i18n";
import { IDLE_SNAPSHOT, type ChatMessage, type SessionSnapshot } from "@/lib/session";
import type { Attachment } from "@/lib/attachments";
import { useInlineEdit, type UseInlineEditDeps } from "./useInlineEdit";

const readySnapshot: SessionSnapshot = {
  ...IDLE_SNAPSHOT,
  sessionId: "session-1",
  state: "ready",
  lastError: null,
  backend: "pi_rpc",
};

function deps(over: Partial<UseInlineEditDeps> = {}): UseInlineEditDeps {
  return {
    lastUserMessageId: "user-1",
    canEditLastUser: true,
    editSubmitting: false,
    editAttachments: [],
    goalMode: false,
    session: {
      sessionId: "session-1",
      state: "ready",
      title: "Current chat",
    },
    localeRef: { current: "en" },
    tr: createT("en"),
    showToast: vi.fn(),
    isPlaceholderTitle: vi.fn().mockReturnValue(false),
    setEditingUserMessageId: vi.fn(),
    setEditAttachments: vi.fn(),
    setEditSubmitting: vi.fn(),
    setMessages: vi.fn(),
    setRetryStatus: vi.fn(),
    setSession: vi.fn(),
    setLiveHost: vi.fn(),
    setLocalError: vi.fn(),
    liveHostRef: { current: IDLE_SNAPSHOT },
    viewingSessionIdRef: { current: "session-1" },
    messagesBySessionRef: {
      current: new Map<string, ChatMessage[]>(),
    },
    patchSessionMessages: vi.fn(),
    ensureConnected: vi.fn().mockResolvedValue("session-1"),
    applySessionTitle: vi.fn(),
    ...over,
  };
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("useInlineEdit", () => {
  it("loads the selected message attachments into the inline editor", () => {
    const d = deps();
    const { result } = renderHook(() => useInlineEdit(d));
    const message: ChatMessage = {
      id: "user-1",
      role: "user",
      content: "Review this",
      attachments: [{ path: "/tmp/report.md", name: "report.md", isDir: false }],
    };

    act(() => result.current.beginEditLastUser(message));

    expect(d.setEditingUserMessageId).toHaveBeenCalledWith("user-1");
    expect(d.setEditAttachments).toHaveBeenCalledWith([
      { path: "/tmp/report.md", name: "report.md", isDir: false },
    ]);
  });

  it("sends the edited turn to its addressed session", async () => {
    vi.spyOn(api, "isTauri").mockReturnValue(false);
    const send = vi.spyOn(api, "sessionSend").mockResolvedValue(readySnapshot);
    const attachment: Attachment = {
      path: "/tmp/report.md",
      name: "report.md",
      isDir: false,
    };
    const d = deps({ editAttachments: [attachment] });
    const { result } = renderHook(() => useInlineEdit(d));
    const message: ChatMessage = {
      id: "user-1",
      role: "user",
      content: "Old request",
    };

    await act(async () => {
      await result.current.submitEditLastUser(message, "New request");
    });

    expect(send).toHaveBeenCalledWith(
      "New request\n\n@/tmp/report.md",
      "New request",
      [attachment],
      "session-1",
    );
    expect(d.setEditSubmitting).toHaveBeenCalledWith(true);
    expect(d.setEditSubmitting).toHaveBeenLastCalledWith(false);
  });
});
