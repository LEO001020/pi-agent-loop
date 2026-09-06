import {
  useMemo,
  useRef,
  type Dispatch,
  type MutableRefObject,
  type SetStateAction,
} from "react";
import * as api from "@/lib/api";
import type { MessageKey, Vars } from "@/i18n";
import type { ModelOption } from "@/lib/agentCatalog";
import {
  buildAgentPrompt,
  type Attachment,
} from "@/lib/attachments";
import {
  isDraftEmpty,
  parseStoredContent,
  serializeForAgent,
} from "@/lib/draftDoc";
import {
  clearPriorTurnStreaming,
  type ChatMessage,
  type SessionSnapshot,
  type SessionState,
  type TurnErrorPayload,
} from "@/lib/session";
import {
  looksLikeScheduleIntent,
  wrapAutomationSetupAgentText,
} from "@/lib/automationSetup";
import { wrapTaskBatchAgentText } from "@/lib/parallelTasks";
import { nextFallbackModel } from "@/lib/fallback";
import { shouldEnqueueSend } from "@/lib/sendQueue";
import {
  useSendQueue,
  type ExecuteSendFromQueue,
} from "@/hooks/useSendQueue";

type T = (key: MessageKey, vars?: Vars) => string;
type Setter<TValue> = Dispatch<SetStateAction<TValue>>;

export type ComposerConfirmDialog = {
  kind: "confirm";
  title: string;
  message: string;
  confirmLabel?: string;
  danger?: boolean;
  onConfirm: () => void | Promise<void>;
};

export type FallbackTurn = {
  sessionId: string;
  storedDisplay: string;
  attachments: Attachment[];
  goalMode: boolean;
  modelId: string;
  attempted: string[];
};

type EnsureConnectedOptions = {
  force?: boolean;
  sessionId?: string | null;
};

type EnsureConnected = (
  forceOrOptions?: boolean | EnsureConnectedOptions,
) => Promise<string | null>;

type RetryStatus = {
  attempt: number;
  maxRetries: number;
  reason: string;
};

export type ComposerSession = Pick<
  SessionSnapshot,
  "sessionId" | "state" | "title"
>;

export type UseComposerDeps = {
  session: ComposerSession;
  modelId: string;
  availableModels: ModelOption[];
  modelRoles: Record<string, string>;
  fallbackChains: Record<string, string[]>;
  contextWindowPercent: number | null;
  compactionThresholdPercent: number;
  draft: string;
  attachments: Attachment[];
  goalMode: boolean;
  mode: string;
  hasActiveProject: boolean;
  connecting: boolean;
  editingUserMessageId: string | null;
  tr: T;
  showToast: (message: string, ms?: number) => void;
  setAppDialog: (dialog: ComposerConfirmDialog | null) => void;
  setDraft: Setter<string>;
  setAttachments: Setter<Attachment[]>;
  setPromptHistoryIndex: Setter<number | null>;
  promptHistoryIndexRef: MutableRefObject<number | null>;
  setSlashQuery: (value: null) => void;
  setEditingUserMessageId: Setter<string | null>;
  setEditAttachments: Setter<Attachment[]>;
  setRetryStatus: Setter<RetryStatus | null>;
  setTurnStartedAt: Setter<number | null>;
  setSession: Setter<SessionSnapshot>;
  setLiveHost: Setter<SessionSnapshot>;
  setMessages: Setter<ChatMessage[]>;
  setModelId: Setter<string>;
  setLocalError: Setter<string | null>;
  sendInFlightRef: MutableRefObject<boolean>;
  compactWaiterRef: MutableRefObject<(() => void) | null>;
  fallbackTurnRef: MutableRefObject<FallbackTurn | null>;
  fallbackRetryRef: MutableRefObject<
    (turn: FallbackTurn, payload: TurnErrorPayload) => Promise<boolean>
  >;
  liveHostRef: MutableRefObject<SessionSnapshot>;
  viewingSessionIdRef: MutableRefObject<string | null>;
  messagesBySessionRef: MutableRefObject<Map<string, ChatMessage[]>>;
  automationSetupDraftRef: MutableRefObject<boolean>;
  automationSetupSessionsRef: MutableRefObject<Set<string>>;
  taskBatchDraftRef: MutableRefObject<boolean>;
  ensureConnected: EnsureConnected;
  patchSessionMessages: (
    targetSessionId: string | undefined | null,
    reduce: (previous: ChatMessage[]) => ChatMessage[],
  ) => void;
  applySessionTitle: (sessionId: string, title: string) => void;
  isPlaceholderTitle: (title: string | undefined | null) => boolean;
};

export type UseComposerResult = {
  sendQueue: ReturnType<typeof useSendQueue>;
  executeSend: (options: ExecuteSendOptions) => Promise<boolean>;
  send: () => Promise<void>;
  retryInterruptedTurn: (message: ChatMessage) => Promise<void>;
};

export type ExecuteSendOptions = {
  storedDisplay: string;
  att: Attachment[];
  goalMode: boolean;
  fromQueue?: boolean;
  targetSessionId?: string | null;
  budgetConfirmed?: boolean;
  compactionConfirmed?: boolean;
  modelIdOverride?: string;
  /**
   * Models this turn has already burned a request on. Carried across a fallback
   * hop so the chain cannot revisit one — without it each hop starts a fresh
   * history and two roles pointing at each other bill forever.
   */
  attemptedSoFar?: string[];
};

/**
 * Composer transport glue: optimistic turns, confirmations, fallback retry,
 * and the per-session follow-up queue. It deliberately owns no visual state.
 */
export function useComposer({
  session,
  modelId,
  availableModels,
  modelRoles,
  fallbackChains,
  contextWindowPercent,
  compactionThresholdPercent,
  draft,
  attachments,
  goalMode,
  mode,
  hasActiveProject,
  connecting,
  editingUserMessageId,
  tr,
  showToast,
  setAppDialog,
  setDraft,
  setAttachments,
  setPromptHistoryIndex,
  promptHistoryIndexRef,
  setSlashQuery,
  setEditingUserMessageId,
  setEditAttachments,
  setRetryStatus,
  setTurnStartedAt,
  setSession,
  setLiveHost,
  setMessages,
  setModelId,
  setLocalError,
  sendInFlightRef,
  compactWaiterRef,
  fallbackTurnRef,
  fallbackRetryRef,
  liveHostRef,
  viewingSessionIdRef,
  messagesBySessionRef,
  automationSetupDraftRef,
  automationSetupSessionsRef,
  taskBatchDraftRef,
  ensureConnected,
  patchSessionMessages,
  applySessionTitle,
  isPlaceholderTitle,
}: UseComposerDeps): UseComposerResult {
  const executeSendFromQueueRef = useRef<ExecuteSendFromQueue>(
    async () => false,
  );
  const sendQueueLabels = useMemo(
    () => ({
      queued: tr("composer.queued"),
      sendFailed: tr("composer.queueSendFailed"),
      droppedOldest: (n: number, max: number) =>
        tr("composer.queueDroppedOldest", {
          n: String(n),
          max: String(max),
        }),
    }),
    [tr],
  );
  const sendQueue = useSendQueue({
    sessionId: session.sessionId,
    sessionState: session.state,
    connecting,
    liveHostRef,
    viewingSessionIdRef,
    sendInFlightRef,
    executeSendRef: executeSendFromQueueRef,
    showToast,
    labels: sendQueueLabels,
  });

  const executeSend = async (
    opts: ExecuteSendOptions,
  ): Promise<boolean> => {
    if (sendInFlightRef.current) return false;
    sendInFlightRef.current = true;
    const { storedDisplay, att, goalMode: useGoal, fromQueue } = opts;
    const segments = parseStoredContent(storedDisplay);
    if (isDraftEmpty(segments) && !att.length) {
      sendInFlightRef.current = false;
      return false;
    }
    const sendTargetId =
      opts.targetSessionId !== undefined
        ? opts.targetSessionId
        : session.sessionId;
    const activeModelId = opts.modelIdOverride ?? modelId;
    if (
      !opts.compactionConfirmed &&
      !opts.fromQueue &&
      sendTargetId &&
      contextWindowPercent != null &&
      contextWindowPercent >= compactionThresholdPercent
    ) {
      sendInFlightRef.current = false;
      setAppDialog({
        kind: "confirm",
        title: tr("context.thresholdConfirmTitle"),
        message: tr("context.thresholdConfirmMessage", {
          percent: contextWindowPercent,
          threshold: compactionThresholdPercent,
        }),
        confirmLabel: tr("context.thresholdConfirm"),
        onConfirm: () => {
          void (async () => {
            try {
              const sid = await ensureConnected();
              if (!sid) return;
              let compactCompleted = false;
              const compacted = new Promise<void>((resolve) => {
                compactWaiterRef.current = () => {
                  compactCompleted = true;
                  resolve();
                };
              });
              await api.sessionSend("/compact", null, null, sid);
              await Promise.race([
                compacted,
                new Promise<void>((resolve) =>
                  window.setTimeout(resolve, 15_000),
                ),
              ]);
              if (!compactCompleted) {
                showToast(tr("context.compactTimeout"), 5000);
                return;
              }
              await executeSend({ ...opts, compactionConfirmed: true });
            } catch (error) {
              setLocalError(String(error));
            } finally {
              compactWaiterRef.current = null;
            }
          })();
        },
      });
      return false;
    }
    // A new turn supersedes any completed turn that never emitted an error.
    fallbackTurnRef.current = null;
    if (!opts.budgetConfirmed && api.isTauri()) {
      const budget = await api
        .usageBudgetStatus(sendTargetId ?? null, activeModelId)
        .catch(() => null);
      if (budget?.requiresConfirm) {
        sendInFlightRef.current = false;
        setAppDialog({
          kind: "confirm",
          title: tr("budget.confirmTitle"),
          message: tr("budget.confirmMessage", {
            tier: budget.tier,
            cost: budget.sessionCost.toFixed(2),
          }),
          confirmLabel: tr("budget.confirmSend"),
          onConfirm: () => {
            void executeSend({ ...opts, budgetConfirmed: true });
          },
        });
        return false;
      }
      if (budget?.warning && viewingSessionIdRef.current === sendTargetId) {
        showToast(tr("budget.warning", { tier: budget.tier }), 5000);
      }
    }
    const cacheKey = sendTargetId ?? "__draft__";
    const viewingTarget = () =>
      viewingSessionIdRef.current === sendTargetId ||
      (sendTargetId == null && viewingSessionIdRef.current == null);

    const agentBody = serializeForAgent(segments, { goalMode: useGoal });
    let agentText = buildAgentPrompt(agentBody, att);
    const scheduleIntent = looksLikeScheduleIntent(agentText);
    const inAutomationSetup =
      automationSetupDraftRef.current ||
      scheduleIntent ||
      (!!sendTargetId &&
        automationSetupSessionsRef.current.has(sendTargetId));
    if (inAutomationSetup) {
      agentText = wrapAutomationSetupAgentText(agentText);
    } else if (taskBatchDraftRef.current) {
      agentText = wrapTaskBatchAgentText(agentText);
    }
    const titleSeed =
      serializeForAgent(segments).replace(/\n/g, " ").trim() ||
      att.map((a) => a.name).join(", ");
    const shouldAutoTitle =
      isPlaceholderTitle(session.title) || !sendTargetId;
    const ts = Date.now();
    const userMessageId = `u-${ts}`;
    const pendingAssistantId = `a-pending-${ts}`;
    const dropIds = fromQueue
      ? new Set([userMessageId, pendingAssistantId])
      : new Set([pendingAssistantId]);
    const stripOptimistic = (messages: ChatMessage[]) =>
      messages.filter((message) => !dropIds.has(message.id));

    if (editingUserMessageId) {
      setEditingUserMessageId(null);
      setEditAttachments([]);
    }

    if (viewingTarget()) setRetryStatus(null);
    const nowIso = new Date().toISOString();
    const appendOptimistic = (messages: ChatMessage[]): ChatMessage[] => {
      const cleaned = clearPriorTurnStreaming(messages);
      return [
        ...cleaned,
        {
          id: userMessageId,
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
    };
    if (sendTargetId) {
      patchSessionMessages(sendTargetId, appendOptimistic);
    } else if (viewingTarget()) {
      setMessages((messages) => {
        const next = appendOptimistic(messages);
        messagesBySessionRef.current.set(cacheKey, next);
        return next;
      });
    } else {
      const previous = messagesBySessionRef.current.get(cacheKey) ?? [];
      messagesBySessionRef.current.set(cacheKey, appendOptimistic(previous));
    }
    if (viewingTarget()) {
      setSession((previous) =>
        previous.state === "streaming" ||
        previous.state === "awaiting_permission"
          ? previous
          : { ...previous, state: "streaming", lastError: null },
      );
      setTurnStartedAt(Date.now());
    }
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

    const failStrip = () => {
      if (sendTargetId) {
        patchSessionMessages(sendTargetId, stripOptimistic);
      } else {
        const draftMessages = messagesBySessionRef.current.get("__draft__");
        if (draftMessages) {
          messagesBySessionRef.current.set(
            "__draft__",
            stripOptimistic(draftMessages),
          );
        }
        if (viewingTarget()) setMessages((messages) => stripOptimistic(messages));
      }
      if (viewingTarget()) {
        setSession((previous) =>
          previous.state === "streaming"
            ? {
                ...previous,
                state: previous.sessionId ? "ready" : previous.state,
              }
            : previous,
        );
      }
      // Symmetric rollback of optimistic liveHost streaming — otherwise
      // useSendQueue.flush sees streaming forever and auto-flush starves.
      setLiveHost((previous) => {
        if (
          sendTargetId &&
          previous.sessionId &&
          previous.sessionId !== sendTargetId
        ) {
          return previous;
        }
        if (previous.state !== "streaming") return previous;
        const next = {
          ...previous,
          state: (previous.sessionId ? "ready" : "idle") as SessionState,
        };
        liveHostRef.current = next;
        return next;
      });
    };

    try {
      let sessionId: string | null = null;
      const live = liveHostRef.current;
      if (
        sendTargetId &&
        live.sessionId === sendTargetId &&
        live.state === "ready" &&
        !live.lastError
      ) {
        sessionId = sendTargetId;
      } else if (
        fromQueue &&
        sendTargetId &&
        viewingSessionIdRef.current !== sendTargetId
      ) {
        failStrip();
        return false;
      } else {
        sessionId = await ensureConnected({ sessionId: sendTargetId });
      }
      if (!sessionId) {
        failStrip();
        return false;
      }
      if (fromQueue && sendTargetId && sessionId !== sendTargetId) {
        failStrip();
        return false;
      }
      // Bind draft message cache to the real id early (Host already materialized).
      // Queue migrate waits until sessionSend succeeds so a failed flush can
      // requeue under the original claim key (`__draft__`) without splitting.
      if (!sendTargetId) {
        const draftMessages = messagesBySessionRef.current.get("__draft__");
        if (draftMessages?.length) {
          messagesBySessionRef.current.set(sessionId, draftMessages);
          messagesBySessionRef.current.delete("__draft__");
        }
      }
      if (automationSetupDraftRef.current || inAutomationSetup) {
        automationSetupSessionsRef.current.add(sessionId);
        automationSetupDraftRef.current = false;
      }
      if (
        fromQueue &&
        sendTargetId &&
        liveHostRef.current.sessionId &&
        liveHostRef.current.sessionId !== sendTargetId
      ) {
        failStrip();
        return false;
      }
      fallbackTurnRef.current = {
        sessionId,
        storedDisplay,
        attachments: att,
        goalMode: useGoal,
        modelId: activeModelId,
        attempted: [...(opts.attemptedSoFar ?? []), activeModelId],
      };
      await api.sessionSend(agentText, storedDisplay, att, sessionId);
      // Only after a successful send: move remaining draft follow-ups onto the
      // real session. If this threw, claim requeues under `__draft__` intact.
      if (!sendTargetId) {
        sendQueue.migrateDraft(sessionId);
      }
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
      return true;
    } catch (error) {
      failStrip();
      if (viewingTarget()) setLocalError(String(error));
      return false;
    } finally {
      sendInFlightRef.current = false;
    }
  };

  fallbackRetryRef.current = async (turn, _payload) => {
    const candidate = nextFallbackModel(
      turn.modelId,
      modelRoles,
      fallbackChains,
      availableModels.map((model) => model.id),
      turn.attempted,
    );
    if (!candidate) return false;
    try {
      // Rebind the host explicitly to the failed session before rewinding. This
      // keeps a background error from being retried in the focused chat.
      const snapshot = await api.sessionConnect({
        sessionId: turn.sessionId,
        mode: "agent",
      });
      if (snapshot.state !== "ready" || snapshot.lastError) return false;
      await api.sessionRewindDropLastUser(turn.sessionId);
      await api.sessionSetModel(candidate.modelId, {
        sessionId: turn.sessionId,
      });
      setModelId(candidate.modelId);
      const ok = await executeSend({
        storedDisplay: turn.storedDisplay,
        att: turn.attachments,
        goalMode: turn.goalMode,
        targetSessionId: turn.sessionId,
        budgetConfirmed: true,
        modelIdOverride: candidate.modelId,
        attemptedSoFar: turn.attempted,
      });
      if (ok) {
        showToast(
          tr("routing.fallbackUsed", {
            from: turn.modelId,
            to: candidate.modelId,
          }),
          5200,
        );
      }
      return ok;
    } catch (error) {
      showToast(tr("routing.fallbackFailed", { reason: String(error) }), 5200);
      return false;
    }
  };

  executeSendFromQueueRef.current = (options) => executeSend(options);

  const clearComposerAfterSubmit = () => {
    setDraft("");
    promptHistoryIndexRef.current = null;
    setPromptHistoryIndex(null);
    setSlashQuery(null);
    setAttachments([]);
    requestAnimationFrame(() => {
      const element = document.querySelector<HTMLElement>(".composer__input");
      if (element) element.style.height = "auto";
    });
  };

  const retryInterruptedTurn = async (message: ChatMessage) => {
    const targetSessionId = session.sessionId;
    if (!targetSessionId) return;
    const storedDisplay = message.content;
    const att = message.attachments ?? [];
    try {
      await ensureConnected({ sessionId: targetSessionId });
      await api.sessionRewindDropLastUser(targetSessionId);
      await executeSend({
        storedDisplay,
        att,
        goalMode: false,
        targetSessionId,
      });
    } catch (error) {
      showToast(String(error), 4500);
    }
  };

  /** Enqueue when agent is busy; otherwise send immediately. */
  const send = async () => {
    const segments = parseStoredContent(draft);
    const storedDisplay = draft;
    const att = attachments;
    if (isDraftEmpty(segments) && !att.length) return;
    if (session.state === "awaiting_permission") {
      showToast(tr("composer.queueBlockedPermission"), 2800);
      return;
    }
    // #52: orphan chats without a folder often stop after planning text —
    // tools can't land in a workspace until a project is bound.
    if (
      !hasActiveProject &&
      (mode === "agent" || goalMode) &&
      !shouldEnqueueSend(session.state, connecting)
    ) {
      showToast(tr("composer.noProjectWriteHint"), 4500);
    }
    sendQueue.releaseFlushHold();

    if (shouldEnqueueSend(session.state, connecting)) {
      sendQueue.enqueue({
        storedDisplay,
        attachments: att,
        goalMode,
      });
      clearComposerAfterSubmit();
      return;
    }

    clearComposerAfterSubmit();
    await executeSend({
      storedDisplay,
      att,
      goalMode,
      targetSessionId: session.sessionId,
    });
  };

  return {
    sendQueue,
    executeSend,
    send,
    retryInterruptedTurn,
  };
}
