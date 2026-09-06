import { useCallback, useState, type Dispatch, type MutableRefObject, type SetStateAction } from "react";
import * as api from "@/lib/api";
import type { MessageKey, Vars } from "@/i18n";
import {
  canRewindToUserPrompt,
  localRewindPoints,
  splitThoughtPhases,
  truncateThroughUserPrompt,
  type ChatMessage,
} from "@/lib/session";
import { userPromptIndexOf } from "@/lib/session";

type T = (key: MessageKey, vars?: Vars) => string;
type Setter<TValue> = Dispatch<SetStateAction<TValue>>;

export type RewindTimelineState = {
  sessionId: string;
  points: Array<{ promptIndex: number; messageId?: string | null; preview: string }>;
};

export type RewindConfirmState = {
  sessionId: string;
  targetPromptIndex: number;
  preview?: string;
};

export type RewindDialogsDeps = {
  canRewindSession: boolean;
  activeSessionId: string | null;
  sessionState: string;
  messages: ChatMessage[];
  rewindBusy: boolean;
  setRewindBusy: Setter<boolean>;
  messagesRef: MutableRefObject<ChatMessage[]>;
  viewingSessionIdRef: MutableRefObject<string | null>;
  messagesBySessionRef: MutableRefObject<Map<string, ChatMessage[]>>;
  ensureConnected: () => Promise<unknown>;
  refreshSessions: () => Promise<void>;
  setMessages: Setter<ChatMessage[]>;
  setCtxMenu: (next: null) => void;
  showToast: (message: string, durationMs?: number) => void;
  tr: T;
};

/** Owns rewind state and journal/agent rewind actions for the chat surface. */
export function useRewindDialogs({
  canRewindSession,
  activeSessionId,
  sessionState,
  messages,
  rewindBusy,
  setRewindBusy,
  messagesRef,
  viewingSessionIdRef,
  messagesBySessionRef,
  ensureConnected,
  refreshSessions,
  setMessages,
  setCtxMenu,
  showToast,
  tr,
}: RewindDialogsDeps) {
  const [rewindTimeline, setRewindTimeline] = useState<RewindTimelineState | null>(null);
  const [rewindConfirm, setRewindConfirm] = useState<RewindConfirmState | null>(null);
  const [rewindRestoreFiles, setRewindRestoreFiles] = useState(false);

  const runRewindToPrompt = useCallback(
    async (sessionId: string, targetPromptIndex: number, restoreFiles = false) => {
      if (!api.isTauri()) {
        showToast(tr("error.needTauri"));
        return;
      }
      if (!canRewindSession) {
        showToast(tr("session.rewindBusy"));
        return;
      }
      setRewindBusy(true);
      try {
        if (
          (activeSessionId === sessionId || viewingSessionIdRef.current === sessionId) &&
          sessionState !== "ready"
        ) {
          try {
            await ensureConnected();
          } catch {
            /* The local journal can still be rewound when the agent is offline. */
          }
        }

        const result = await api.sessionRewindExecute(targetPromptIndex, {
          sessionId,
          restoreFiles,
        });
        if (viewingSessionIdRef.current === sessionId) {
          const stored = await api.sessionMessages(sessionId);
          const mapped: ChatMessage[] = stored.map((message) => ({
            id: message.id,
            role: message.role as "user" | "assistant" | "tool",
            content: message.content,
            thought: message.thought ?? undefined,
            thoughtPhases: splitThoughtPhases(message.thought),
            isError: message.isError || undefined,
            marker: message.marker || undefined,
            createdAt: message.createdAt || undefined,
            attachments: (message.attachments ?? []).map((attachment) => ({
              path: attachment.path,
              name: attachment.name || attachment.path.split(/[/\\]/).pop() || attachment.path,
              isDir: !!attachment.isDir,
            })),
            streaming: false,
          }));
          const kept = truncateThroughUserPrompt(mapped, targetPromptIndex);
          const finalMessages =
            kept.length || mapped.length <= result.keptCount
              ? kept.length
                ? kept
                : mapped
              : mapped.slice(0, result.keptCount);
          messagesBySessionRef.current.set(sessionId, finalMessages);
          setMessages(finalMessages);
        } else {
          messagesBySessionRef.current.delete(sessionId);
        }

        setRewindTimeline(null);
        setRewindConfirm(null);
        setRewindRestoreFiles(false);
        showToast(
          result.agentOk ? tr("session.rewindOk") : tr("session.rewindLocalOnly"),
          result.agentOk ? 2600 : 4200,
        );
        await refreshSessions();
      } catch (error) {
        showToast(`${tr("session.rewindFailed")}: ${String(error)}`, 4500);
      } finally {
        setRewindBusy(false);
      }
    },
    [
      activeSessionId,
      canRewindSession,
      ensureConnected,
      messagesBySessionRef,
      refreshSessions,
      sessionState,
      setMessages,
      showToast,
      tr,
      viewingSessionIdRef,
    ],
  );

  const confirmRewindToPrompt = useCallback(
    (sessionId: string, targetPromptIndex: number, preview?: string) => {
      setCtxMenu(null);
      setRewindRestoreFiles(false);
      setRewindConfirm({
        sessionId,
        targetPromptIndex,
        preview: preview?.trim() || undefined,
      });
    },
    [setCtxMenu],
  );

  const openRewindTimeline = useCallback(
    async (sessionId: string) => {
      setCtxMenu(null);
      if (!api.isTauri()) {
        showToast(tr("error.needTauri"));
        return;
      }
      if (!canRewindSession) {
        showToast(tr("session.rewindBusy"));
        return;
      }
      try {
        let points = await api.sessionRewindPoints(sessionId);
        if (!points.length && viewingSessionIdRef.current === sessionId) {
          points = localRewindPoints(messagesRef.current).map((point) => ({
            promptIndex: point.promptIndex,
            messageId: point.messageId,
            preview: point.preview,
          }));
        }
        if (!points.length) {
          showToast(tr("session.rewindEmpty"));
          return;
        }
        setRewindTimeline({ sessionId, points });
      } catch (error) {
        if (viewingSessionIdRef.current === sessionId) {
          const points = localRewindPoints(messagesRef.current);
          if (points.length) {
            setRewindTimeline({ sessionId, points });
            return;
          }
        }
        showToast(`${tr("session.rewindFailed")}: ${String(error)}`, 4500);
      }
    },
    [canRewindSession, messagesRef, setCtxMenu, showToast, tr, viewingSessionIdRef],
  );

  const onRewindToUserMessage = useCallback(
    (message: ChatMessage) => {
      const sessionId = activeSessionId ?? viewingSessionIdRef.current;
      if (!sessionId) {
        showToast(tr("session.rewindFailed"));
        return;
      }
      if (!canRewindSession) {
        showToast(tr("session.rewindBusy"));
        return;
      }
      const index = userPromptIndexOf(messages, message.id);
      if (index < 0) return;
      if (!canRewindToUserPrompt(messages, index)) {
        showToast(tr("session.rewindNoop"));
        return;
      }
      const preview = (message.content || "").replace(/\s+/g, " ").trim().slice(0, 80);
      confirmRewindToPrompt(sessionId, index, preview);
    },
    [activeSessionId, canRewindSession, confirmRewindToPrompt, messages, showToast, tr, viewingSessionIdRef],
  );

  return {
    rewindTimeline,
    setRewindTimeline,
    rewindBusy,
    setRewindBusy,
    rewindConfirm,
    setRewindConfirm,
    rewindRestoreFiles,
    setRewindRestoreFiles,
    runRewindToPrompt,
    confirmRewindToPrompt,
    openRewindTimeline,
    onRewindToUserMessage,
  };
}
