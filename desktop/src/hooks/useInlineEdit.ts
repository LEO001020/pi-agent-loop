import { useCallback, type Dispatch, type MutableRefObject, type SetStateAction } from "react";
import type { Locale, MessageKey, Vars } from "@/i18n";
import * as api from "@/lib/api";
import {
  buildAgentPrompt,
  type Attachment,
} from "@/lib/attachments";
import { isDraftEmpty, parseStoredContent, serializeForAgent } from "@/lib/draftDoc";
import {
  applyTurnError,
  truncateBeforeLastUser,
  type ChatMessage,
  type SessionSnapshot,
} from "@/lib/session";

type T = (key: MessageKey, vars?: Vars) => string;
type Setter<TValue> = Dispatch<SetStateAction<TValue>>;

type EnsureConnected = (
  forceOrOptions?: boolean | { force?: boolean; sessionId?: string | null },
) => Promise<string | null>;

type RetryStatus = {
  attempt: number;
  maxRetries: number;
  reason: string;
};

export type UseInlineEditDeps = {
  lastUserMessageId: string | null;
  canEditLastUser: boolean;
  editSubmitting: boolean;
  editAttachments: Attachment[];
  goalMode: boolean;
  session: Pick<SessionSnapshot, "sessionId" | "title" | "state">;
  localeRef: MutableRefObject<Locale>;
  tr: T;
  showToast: (message: string, ms?: number) => void;
  isPlaceholderTitle: (title: string | undefined | null) => boolean;
  setEditingUserMessageId: Setter<string | null>;
  setEditAttachments: Setter<Attachment[]>;
  setEditSubmitting: Setter<boolean>;
  setMessages: Setter<ChatMessage[]>;
  setRetryStatus: Setter<RetryStatus | null>;
  setSession: Setter<SessionSnapshot>;
  setLiveHost: Setter<SessionSnapshot>;
  setLocalError: Setter<string | null>;
  liveHostRef: MutableRefObject<SessionSnapshot>;
  viewingSessionIdRef: MutableRefObject<string | null>;
  messagesBySessionRef: MutableRefObject<Map<string, ChatMessage[]>>;
  patchSessionMessages: (
    targetSessionId: string | undefined | null,
    reduce: (previous: ChatMessage[]) => ChatMessage[],
  ) => void;
  ensureConnected: EnsureConnected;
  applySessionTitle: (sessionId: string, title: string) => void;
};

export type UseInlineEditResult = {
  beginEditLastUser: (message: ChatMessage) => void;
  cancelEditUser: () => void;
  submitEditLastUser: (
    message: ChatMessage,
    storedDisplay: string,
  ) => Promise<void>;
};

/** Inline last-message editing; keeps the existing transcript UI untouched. */
export function useInlineEdit({
  lastUserMessageId,
  canEditLastUser,
  editSubmitting,
  editAttachments,
  goalMode,
  session,
  localeRef,
  tr,
  showToast,
  isPlaceholderTitle,
  setEditingUserMessageId,
  setEditAttachments,
  setEditSubmitting,
  setMessages,
  setRetryStatus,
  setSession,
  setLiveHost,
  setLocalError,
  liveHostRef,
  viewingSessionIdRef,
  messagesBySessionRef,
  patchSessionMessages,
  ensureConnected,
  applySessionTitle,
}: UseInlineEditDeps): UseInlineEditResult {
  const beginEditLastUser = useCallback(
    (message: ChatMessage) => {
      if (message.role !== "user") return;
      if (message.id !== lastUserMessageId) {
        showToast(tr("message.editOnlyLast"));
        return;
      }
      if (!canEditLastUser) {
        showToast(tr("message.editBusy"));
        return;
      }
      // Inline only — do not move content into the main composer.
      // Reload original attachments into editable chips.
      setEditAttachments(
        (message.attachments ?? []).map((attachment) => ({
          path: attachment.path,
          name: attachment.name,
          isDir: attachment.isDir,
        })),
      );
      setEditingUserMessageId(message.id);
    },
    [lastUserMessageId, canEditLastUser, showToast, tr, setEditAttachments, setEditingUserMessageId],
  );

  const cancelEditUser = useCallback(() => {
    if (editSubmitting) return;
    setEditingUserMessageId(null);
    setEditAttachments([]);
  }, [editSubmitting, setEditingUserMessageId, setEditAttachments]);

  const submitEditLastUser = useCallback(
    async (message: ChatMessage, storedDisplay: string) => {
      if (message.role !== "user" || message.id !== lastUserMessageId) {
        showToast(tr("message.editOnlyLast"));
        return;
      }
      if (!canEditLastUser || editSubmitting) {
        showToast(tr("message.editBusy"));
        return;
      }
      const segments = parseStoredContent(storedDisplay);
      // Live editable set is the source of truth (may have added/removed files).
      const att: Attachment[] = editAttachments.map((attachment) => ({
        path: attachment.path,
        name: attachment.name,
        isDir: attachment.isDir,
      }));
      if (isDraftEmpty(segments) && !att.length) return;

      const agentBody = serializeForAgent(segments, { goalMode });
      const agentText = buildAgentPrompt(agentBody, att);
      const titleSeed =
        serializeForAgent(segments).replace(/\n/g, " ").trim() ||
        att.map((attachment) => attachment.name).join(", ");
      const shouldAutoTitle =
        isPlaceholderTitle(session.title) || !session.sessionId;
      const pendingAssistantId = `a-pending-${Date.now()}`;
      // May still be a draft id; ensureConnected materializes it later.
      let sendTargetId = session.sessionId;
      let cacheKey = sendTargetId ?? "__draft__";
      const nowIso = new Date().toISOString();

      setEditSubmitting(true);

      // 1) Instant UI commit — edited bubble + thinking.
      //    Connect/rewind wait happens under this thinking row, not the edit form.
      setMessages((messages) => {
        const kept = truncateBeforeLastUser(messages);
        const next: ChatMessage[] = [
          ...kept,
          {
            id: `u-${Date.now()}`,
            role: "user",
            content: storedDisplay,
            attachments: att.length ? att : undefined,
            createdAt: nowIso,
          },
          {
            id: pendingAssistantId,
            role: "assistant",
            content: "",
            streaming: true,
          },
        ];
        messagesBySessionRef.current.set(cacheKey, next);
        return next;
      });
      setEditingUserMessageId(null);
      setEditAttachments([]);
      setRetryStatus(null);
      setSession((previous) =>
        previous.state === "streaming" || previous.state === "awaiting_permission"
          ? previous
          : { ...previous, state: "streaming", lastError: null },
      );
      setLiveHost((previous) => {
        if (
          sendTargetId &&
          previous.sessionId &&
          previous.sessionId !== sendTargetId
        ) {
          return previous;
        }
        const next = {
          ...previous,
          sessionId: sendTargetId ?? previous.sessionId,
          state: "streaming" as const,
          lastError: null,
        };
        liveHostRef.current = next;
        return next;
      });

      const failPending = (errorText?: string) => {
        const errorTarget = sendTargetId ?? viewingSessionIdRef.current;
        patchSessionMessages(errorTarget, (messages) =>
          applyTurnError(
            messages,
            {
              messageId: pendingAssistantId,
              content: errorText || tr("message.editConnectFailed"),
            },
            localeRef.current,
          ),
        );
        if (
          viewingSessionIdRef.current === sendTargetId ||
          viewingSessionIdRef.current === errorTarget ||
          (!sendTargetId && viewingSessionIdRef.current === null)
        ) {
          setSession((previous) =>
            previous.state === "streaming"
              ? {
                  ...previous,
                  state: previous.sessionId ? "ready" : previous.state,
                }
              : previous,
          );
        }
      };

      // 2) Background: connect → rewind journal → addressed send.
      try {
        const sessionId = await ensureConnected({ sessionId: sendTargetId });
        if (!sessionId) {
          failPending(tr("message.editConnectFailed"));
          return;
        }
        // Draft / id migrate after materialize.
        if (sessionId !== cacheKey) {
          const previousCache = messagesBySessionRef.current.get(cacheKey);
          if (previousCache?.length) {
            messagesBySessionRef.current.set(sessionId, previousCache);
            messagesBySessionRef.current.delete(cacheKey);
          }
          sendTargetId = sessionId;
          cacheKey = sessionId;
        }

        if (api.isTauri()) {
          try {
            await api.sessionRewindDropLastUser(sessionId);
          } catch (error) {
            console.warn("session rewind before edit failed", error);
            // Continue: UI already replaced the turn; resend still proceeds.
          }
        }

        await api.sessionSend(agentText, storedDisplay, att, sessionId);
        if (shouldAutoTitle && api.isTauri()) {
          void api
            .sessionAutoTitle(sessionId, titleSeed)
            .then((meta) => {
              if (meta?.title) applySessionTitle(sessionId, meta.title);
            })
            .catch(() => {
              /* ignore */
            });
        }
      } catch (error) {
        failPending(String(error));
        if (
          viewingSessionIdRef.current === sendTargetId ||
          viewingSessionIdRef.current === null
        ) {
          setLocalError(String(error));
        }
      } finally {
        setEditSubmitting(false);
      }
    },
    [
      lastUserMessageId,
      canEditLastUser,
      editSubmitting,
      editAttachments,
      showToast,
      tr,
      goalMode,
      session,
      isPlaceholderTitle,
      setEditSubmitting,
      setMessages,
      setEditingUserMessageId,
      setEditAttachments,
      setRetryStatus,
      setSession,
      setLiveHost,
      liveHostRef,
      messagesBySessionRef,
      patchSessionMessages,
      viewingSessionIdRef,
      localeRef,
      ensureConnected,
      applySessionTitle,
      setLocalError,
    ],
  );

  return { beginEditLastUser, cancelEditUser, submitEditLastUser };
}
