// @vitest-environment happy-dom

import { act, renderHook } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { createT } from "@/i18n";
import type { ChatMessage } from "@/lib/session";
import {
  useSessionActions,
  type SessionActionsDeps,
  type SessionActionRow,
} from "./useSessionActions";

function deps(over: Partial<SessionActionsDeps> = {}): SessionActionsDeps {
  return {
    projects: [],
    sessions: [],
    activeProjectId: null,
    activeSessionId: "session-1",
    sessionTitle: "Current chat",
    canRewindSession: true,
    messages: [],
    messagesRef: { current: [] },
    messagesBySessionRef: { current: new Map<string, ChatMessage[]>() },
    viewingSessionIdRef: { current: "session-1" },
    refreshSessions: vi.fn().mockResolvedValue(undefined),
    openSession: vi.fn().mockResolvedValue(undefined),
    requestComposerFocus: vi.fn(),
    setDraft: vi.fn(),
    setCtxMenu: vi.fn(),
    setExpandedProjects: vi.fn(),
    setHistoryOpen: vi.fn(),
    openDialog: vi.fn(),
    showToast: vi.fn(),
    tr: createT("en"),
    ...over,
  };
}

const source: SessionActionRow = {
  id: "session-1",
  title: "Current chat",
  projectId: null,
  updatedAt: "2026-08-03",
};

describe("useSessionActions", () => {
  it("opens a confirmation before forking a selected transcript point", () => {
    const openDialog = vi.fn();
    const d = deps({ openDialog });
    const { result } = renderHook(() => useSessionActions(d));

    act(() => result.current.confirmForkSession(source, 0));

    const dialog = openDialog.mock.calls[0]![0];
    expect(dialog.kind).toBe("confirm");
    expect(dialog.confirmLabel).toBe(createT("en")("session.fork"));
    expect(d.setCtxMenu).toHaveBeenCalledWith(null);
  });
});
