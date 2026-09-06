import { useCallback } from "react";
import * as api from "@/lib/api";
import type { MessageKey, Vars } from "@/i18n";
import { buildHandoffDraft } from "@/lib/handoff";
import type { ChatMessage } from "@/lib/session";
import { userPromptIndexOf } from "@/lib/session";

type T = (key: MessageKey, vars?: Vars) => string;

export type SessionActionRow = {
  id: string;
  title: string;
  projectId: string | null;
  updatedAt: string;
  archived?: boolean;
  pinned?: boolean;
  scheduled?: boolean;
};

export type SessionActionProject = {
  id: string;
  name: string;
  path: string;
  trusted: boolean;
  pathOk: boolean;
};

export type SessionActionDialog =
  | {
      kind: "confirm";
      title: string;
      message: string;
      confirmLabel?: string;
      danger?: boolean;
      onConfirm: () => void | Promise<void>;
    }
  | {
      kind: "prompt";
      title: string;
      initial: string;
      message?: string;
      placeholder?: string;
      submitLabel?: string;
      onSubmit: (value: string) => void | Promise<void>;
    };

export type SessionActionsDeps = {
  projects: SessionActionProject[];
  sessions: SessionActionRow[];
  activeProjectId: string | null;
  activeSessionId: string | null;
  sessionTitle: string;
  canRewindSession: boolean;
  messages: ChatMessage[];
  messagesRef: { current: ChatMessage[] };
  messagesBySessionRef: { current: Map<string, ChatMessage[]> };
  viewingSessionIdRef: { current: string | null };
  refreshSessions: () => Promise<void>;
  openSession: (row: SessionActionRow, project?: SessionActionProject | null) => Promise<void>;
  requestComposerFocus: () => void;
  setDraft: (value: string) => void;
  setCtxMenu: (next: null) => void;
  setExpandedProjects: React.Dispatch<React.SetStateAction<Record<string, boolean>>>;
  setHistoryOpen: React.Dispatch<React.SetStateAction<boolean>>;
  openDialog: (dialog: SessionActionDialog) => void;
  showToast: (message: string, durationMs?: number) => void;
  tr: T;
};

/** Session-level fork, handoff and transcript actions kept out of App.tsx. */
export function useSessionActions({
  projects,
  sessions,
  activeProjectId,
  activeSessionId,
  sessionTitle,
  canRewindSession,
  messages,
  messagesRef,
  messagesBySessionRef,
  viewingSessionIdRef,
  refreshSessions,
  openSession,
  requestComposerFocus,
  setDraft,
  setCtxMenu,
  setExpandedProjects,
  setHistoryOpen,
  openDialog,
  showToast,
  tr,
}: SessionActionsDeps) {
  const runForkSession = useCallback(
    async (
      source: SessionActionRow,
      opts?: { throughUserPromptIndex?: number | null },
    ) => {
      if (!api.isTauri()) {
        showToast(tr("error.needTauri"));
        return;
      }
      try {
        const base = (source.title || tr("session.untitled")).trim();
        const title = /^fork of\s*/i.test(base)
          ? base
          : tr("session.forkTitleOf", { name: base || "chat" });
        const meta = await api.sessionFork(source.id, {
          throughUserPromptIndex: opts?.throughUserPromptIndex ?? null,
          title,
        });
        await refreshSessions();
        const row: SessionActionRow = {
          id: meta.id,
          title: meta.title || title,
          projectId: meta.projectId ?? source.projectId,
          updatedAt: meta.updatedAt || new Date().toISOString(),
          archived: meta.archived,
          pinned: !!(meta as SessionActionRow).pinned,
          scheduled: meta.scheduled,
        };
        const project = row.projectId
          ? projects.find((candidate) => candidate.id === row.projectId) ?? null
          : null;
        if (row.projectId) {
          setExpandedProjects((expanded) => ({ ...expanded, [row.projectId!]: true }));
        } else {
          setHistoryOpen(true);
        }
        await openSession(row, project);
        showToast(tr("session.forkOk"), 2800);
      } catch (error) {
        showToast(`${tr("session.forkFailed")}: ${String(error)}`, 4500);
      }
    },
    [openSession, projects, refreshSessions, setExpandedProjects, setHistoryOpen, showToast, tr],
  );

  const runHandoffSession = useCallback(
    async (source: SessionActionRow, goal: string) => {
      const objective = goal.trim();
      if (!objective || !api.isTauri()) return;
      const sourceMessages =
        messagesBySessionRef.current.get(source.id) ??
        (viewingSessionIdRef.current === source.id ? messagesRef.current : []);
      const project = source.projectId
        ? projects.find((candidate) => candidate.id === source.projectId) ?? null
        : null;
      const draft = buildHandoffDraft({
        goal: objective,
        sourceTitle: source.title || tr("session.untitled"),
        projectPath: project?.path ?? null,
        messages: sourceMessages,
        labels: {
          heading: tr("handoff.draft.heading"),
          goal: tr("handoff.draft.goal"),
          source: tr("handoff.draft.source"),
          project: tr("handoff.draft.project"),
          files: tr("handoff.draft.files"),
          recent: tr("handoff.draft.recent"),
          user: tr("handoff.draft.user"),
          assistant: tr("handoff.draft.assistant"),
          instruction: tr("handoff.draft.instruction"),
        },
      });

      try {
        const title = tr("session.handoffTitleOf", {
          name: source.title || tr("session.untitled"),
        });
        const meta = await api.sessionFork(source.id, { title });
        await refreshSessions();
        const row: SessionActionRow = {
          id: meta.id,
          title: meta.title || title,
          projectId: meta.projectId ?? source.projectId,
          updatedAt: meta.updatedAt || new Date().toISOString(),
          archived: meta.archived,
          pinned: !!(meta as SessionActionRow).pinned,
          scheduled: meta.scheduled,
        };
        if (row.projectId) {
          setExpandedProjects((expanded) => ({ ...expanded, [row.projectId!]: true }));
        } else {
          setHistoryOpen(true);
        }
        await openSession(row, project);
        setDraft(draft);
        requestComposerFocus();
        showToast(tr("session.handoffReady"), 3200);
      } catch (error) {
        showToast(`${tr("session.handoffFailed")}: ${String(error)}`, 4500);
      }
    },
    [
      messagesBySessionRef,
      messagesRef,
      openSession,
      projects,
      requestComposerFocus,
      refreshSessions,
      setDraft,
      setExpandedProjects,
      setHistoryOpen,
      showToast,
      tr,
      viewingSessionIdRef,
    ],
  );

  const confirmForkSession = useCallback(
    (source: SessionActionRow, throughUserPromptIndex?: number | null) => {
      setCtxMenu(null);
      const partial = throughUserPromptIndex != null;
      openDialog({
        kind: "confirm",
        title: tr("session.forkTitle"),
        message: partial ? tr("session.forkConfirmPartial") : tr("session.forkConfirm"),
        confirmLabel: tr("session.fork"),
        onConfirm: () => {
          void runForkSession(source, { throughUserPromptIndex: throughUserPromptIndex ?? null });
        },
      });
    },
    [openDialog, runForkSession, setCtxMenu, tr],
  );

  const openHandoffDialog = useCallback(
    (source?: SessionActionRow) => {
      setCtxMenu(null);
      const sessionId = source?.id ?? activeSessionId ?? viewingSessionIdRef.current;
      if (!sessionId || !canRewindSession) {
        showToast(tr("session.handoffBusy"));
        return;
      }
      const row =
        source ??
        sessions.find((candidate) => candidate.id === sessionId) ??
        ({
          id: sessionId,
          title: sessionTitle || tr("session.untitled"),
          projectId: activeProjectId,
          updatedAt: new Date().toISOString(),
        } satisfies SessionActionRow);
      if (viewingSessionIdRef.current !== row.id && activeSessionId !== row.id) {
        showToast(tr("session.handoffOpenFirst"));
        return;
      }
      openDialog({
        kind: "prompt",
        title: tr("session.handoff"),
        message: tr("session.handoffPrompt"),
        initial: "",
        placeholder: tr("session.handoffPlaceholder"),
        submitLabel: tr("session.handoffCreate"),
        onSubmit: (value) => {
          if (value.trim()) void runHandoffSession(row, value);
        },
      });
    },
    [
      activeProjectId,
      activeSessionId,
      canRewindSession,
      openDialog,
      runHandoffSession,
      sessions,
      sessionTitle,
      setCtxMenu,
      showToast,
      tr,
      viewingSessionIdRef,
    ],
  );

  const onForkFromUserMessage = useCallback(
    (message: ChatMessage) => {
      const sessionId = activeSessionId ?? viewingSessionIdRef.current;
      if (!sessionId) {
        showToast(tr("session.forkFailed"));
        return;
      }
      const row =
        sessions.find((candidate) => candidate.id === sessionId) ??
        ({
          id: sessionId,
          title: sessionTitle || tr("session.untitled"),
          projectId: activeProjectId,
          updatedAt: new Date().toISOString(),
        } satisfies SessionActionRow);
      const index = userPromptIndexOf(messages, message.id);
      if (index >= 0) confirmForkSession(row, index);
    },
    [
      activeProjectId,
      activeSessionId,
      confirmForkSession,
      messages,
      sessionTitle,
      sessions,
      showToast,
      tr,
      viewingSessionIdRef,
    ],
  );

  return {
    runForkSession,
    runHandoffSession,
    confirmForkSession,
    openHandoffDialog,
    onForkFromUserMessage,
  };
}
