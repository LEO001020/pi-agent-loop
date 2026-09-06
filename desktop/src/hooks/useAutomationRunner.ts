import { useCallback, useRef, type Dispatch, type MutableRefObject, type SetStateAction } from "react";
import * as api from "@/lib/api";
import {
  computeNextRunAt,
  type Automation,
} from "@/lib/automations";
import type { Attachment } from "@/lib/attachments";
import {
  buildPrSweepPrompt,
  isPrAutomation,
  loadSeenPrs,
  markPullsSeen,
  saveSeenPrs,
  unseenPulls,
} from "@/lib/prSweep";
import {
  IDLE_SNAPSHOT,
  type AskUserPayload,
  type ChatMessage,
  type PermissionPayload,
  type SessionSnapshot,
} from "@/lib/session";
import { isProjectPathMissing } from "@/lib/projectPath";
import type { MessageKey, Vars } from "@/i18n";

type T = (key: MessageKey, vars?: Vars) => string;
type Setter<TValue> = Dispatch<SetStateAction<TValue>>;

export type AutomationRunnerProject = {
  id: string;
  name: string;
  path: string;
  trusted: boolean;
  pathOk: boolean;
};

export type AutomationRunnerDeps = {
  projects: AutomationRunnerProject[];
  sessionState: SessionSnapshot["state"];
  connecting: boolean;
  tr: T;
  showToast: (message: string, durationMs?: number) => void;
  setToast: Setter<string | null>;
  setLocalError: Setter<string | null>;
  setMainPane: Setter<"chat" | "automations">;
  setAppView: Setter<"workbench" | "settings">;
  setActiveProject: Setter<AutomationRunnerProject | null>;
  setExpandedProjects: Setter<Record<string, boolean>>;
  setHistoryOpen: Setter<boolean>;
  setMessages: Setter<ChatMessage[]>;
  setAttachments: Setter<Attachment[]>;
  setPerm: Setter<PermissionPayload | null>;
  setAskUser: Setter<AskUserPayload | null>;
  setRetryStatus: Setter<{
    attempt: number;
    maxRetries: number;
    reason: string;
  } | null>;
  setDraft: Setter<string>;
  setSession: Setter<SessionSnapshot>;
  setLiveHost: Setter<SessionSnapshot>;
  refreshSessions: () => Promise<void>;
  messagesBySessionRef: MutableRefObject<Map<string, ChatMessage[]>>;
  viewingSessionIdRef: MutableRefObject<string | null>;
  openingSessionIdRef: MutableRefObject<string | null>;
  liveHostRef: MutableRefObject<SessionSnapshot>;
};

/**
 * Runs a scheduled automation in a fresh, addressed session.
 *
 * The scheduler itself lives in Rust so it also works while the window is
 * closed. This hook owns the UI-only path used by "Run now" and keeps the
 * session-reset/send sequence out of App.tsx.
 */
export function useAutomationRunner({
  projects,
  sessionState,
  connecting,
  tr,
  showToast,
  setToast,
  setLocalError,
  setMainPane,
  setAppView,
  setActiveProject,
  setExpandedProjects,
  setHistoryOpen,
  setMessages,
  setAttachments,
  setPerm,
  setAskUser,
  setRetryStatus,
  setDraft,
  setSession,
  setLiveHost,
  refreshSessions,
  messagesBySessionRef,
  viewingSessionIdRef,
  openingSessionIdRef,
  liveHostRef,
}: AutomationRunnerDeps) {
  const runLock = useRef(false);

  return useCallback(
    async (
      auto: Automation,
      opts?: { fromScheduler?: boolean },
    ): Promise<boolean> => {
      if (runLock.current) return false;
      if (opts?.fromScheduler && (sessionState === "streaming" || connecting)) {
        return false;
      }
      runLock.current = true;
      let createdSessionId: string | null = null;
      let automationRunId: string | null = null;
      try {
        const project = auto.projectId
          ? projects.find((candidate) => candidate.id === auto.projectId) ?? null
          : null;
        if (project && !project.trusted) {
          setLocalError(tr("project.trustFirst", { name: project.name }));
          return false;
        }
        if (project && isProjectPathMissing(project.pathOk)) {
          setLocalError(tr("project.pathMissing", { name: project.name }));
          return false;
        }

        setMainPane("chat");
        setAppView("workbench");
        setActiveProject(project);
        if (project) {
          setExpandedProjects((expanded) => ({ ...expanded, [project.id]: true }));
        } else {
          setHistoryOpen(true);
        }
        openingSessionIdRef.current = null;
        viewingSessionIdRef.current = null;
        setMessages([]);
        setAttachments([]);
        setPerm(null);
        setAskUser(null);
        setRetryStatus(null);
        setLocalError(null);
        setDraft("");
        if (api.isTauri()) {
          try {
            await api.sessionDisconnect();
          } catch {
            /* best effort: connect below can still replace the stale session */
          }
        }
        setSession({
          ...IDLE_SNAPSHOT,
          sessionId: null,
          title: auto.title || tr("session.new"),
          state: "idle",
          backend: "pi_rpc",
        });
        const idle = { ...IDLE_SNAPSHOT };
        setLiveHost(idle);
        liveHostRef.current = idle;

        let sessionId: string | null = null;
        if (api.isTauri()) {
          const meta = (await api.sessionCreate(
            project?.id,
            auto.title || tr("session.new"),
            { scheduled: true },
          )) as { id: string; title?: string; scheduled?: boolean };
          sessionId = meta.id;
          createdSessionId = meta.id;
          automationRunId = (
            await api.automationRunStart(auto.id, meta.id, {
              trigger: "manual",
            })
          ).id;
          viewingSessionIdRef.current = meta.id;
          setSession((previous) => ({
            ...previous,
            sessionId: meta.id,
            title: meta.title || auto.title,
          }));
          await refreshSessions();
        }

        if (sessionId && api.isTauri() && (auto.modelId || auto.effort)) {
          try {
            await api.composerPrefsSet({
              sessionId,
              projectId: project?.id ?? null,
              modelId: auto.modelId,
              effort: auto.effort,
            });
          } catch {
            /* soft-fail: the scheduled turn still uses the project default */
          }
        }

        const snap = await api.sessionConnect({
          projectPath: project?.path,
          sessionId: sessionId ?? undefined,
          mode: "agent",
        });
        setLiveHost(snap);
        liveHostRef.current = snap;
        if (snap.sessionId) {
          viewingSessionIdRef.current = snap.sessionId;
          sessionId = snap.sessionId;
        }
        setSession({
          ...snap,
          title: snap.title || auto.title || snap.title,
        });
        if (snap.lastError || snap.state !== "ready") {
          const code = snap.lastError?.code ?? "AGENT_CRASHED";
          const message = snap.lastError?.message ?? "connect failed";
          if (automationRunId && api.isTauri()) {
            await api.automationRunFinish(automationRunId, "failed", message);
            automationRunId = null;
          }
          setLocalError(tr("automations.connectFailed", { detail: `${code}: ${message}` }));
          if (createdSessionId && api.isTauri()) {
            try {
              await api.sessionDelete(createdSessionId);
              await refreshSessions();
            } catch {
              /* ignore cleanup errors */
            }
            if (viewingSessionIdRef.current === createdSessionId) {
              viewingSessionIdRef.current = null;
              setMessages([]);
              setSession({ ...IDLE_SNAPSHOT, state: "idle" });
            }
          }
          return false;
        }

        if (sessionId && auto.modelId && api.isTauri()) {
          try {
            await api.sessionSetModel(auto.modelId, {
              sessionId,
              projectId: project?.id ?? null,
            });
          } catch {
            /* soft-fail: the selected model may not be available anymore */
          }
        }

        const header = `[Scheduled: ${auto.title}]\n\n`;
        let body = auto.prompt;
        let sweptNumbers: number[] = [];
        if (isPrAutomation(auto)) {
          const repo = (auto.repo || "").trim();
          const pulls = await api.ghPrList({ repo });
          const seen = loadSeenPrs(localStorage);
          const fresh = unseenPulls(pulls, seen, auto.id);
          if (fresh.length === 0) {
            if (automationRunId && api.isTauri()) {
              await api.automationRunFinish(
                automationRunId,
                "cancelled",
                "no new pull requests to review",
              );
              automationRunId = null;
            }
            showToast(tr("prAuto.nothingNew", { repo }));
            return false;
          }
          sweptNumbers = fresh.map((pull) => pull.number);
          body = buildPrSweepPrompt(repo, fresh, auto.prompt);
        }

        const promptBody = header + body;
        const autoMessages: ChatMessage[] = [{
          id: `u-auto-${Date.now()}`,
          role: "user",
          content: promptBody,
          createdAt: new Date().toISOString(),
        }];
        if (sessionId) messagesBySessionRef.current.set(sessionId, autoMessages);
        setMessages(autoMessages);
        setSession((previous) => ({
          ...previous,
          state: "streaming",
          lastError: null,
          title: auto.title || previous.title,
        }));

        try {
          await api.sessionSend(promptBody, null, null, sessionId);
          if (sweptNumbers.length > 0) {
            saveSeenPrs(
              localStorage,
              markPullsSeen(loadSeenPrs(localStorage), auto.id, sweptNumbers),
            );
          }
        } catch (sendError) {
          const errorText = String(sendError);
          if (automationRunId && api.isTauri()) {
            await api.automationRunFinish(automationRunId, "failed", errorText);
            automationRunId = null;
          }
          const failed: ChatMessage[] = [
            ...autoMessages,
            {
              id: `err-auto-${Date.now()}`,
              role: "assistant",
              content: errorText,
              isError: true,
              createdAt: new Date().toISOString(),
            },
          ];
          if (sessionId) messagesBySessionRef.current.set(sessionId, failed);
          setMessages(failed);
          setLocalError(errorText);
          setSession((previous) =>
            previous.sessionId === sessionId
              ? { ...previous, state: "ready" }
              : previous,
          );
          return false;
        }

        const lastRunAt = new Date().toISOString();
        const nextRunAt =
          auto.frequency === "once"
            ? null
            : computeNextRunAt(
                { ...auto, enabled: auto.frequency !== "once" },
                new Date(Date.now() + 60_000),
              );
        await api.automationMarkRun(auto.id, lastRunAt, nextRunAt);
        if (auto.frequency === "once") {
          await api.automationSetEnabled(auto.id, false);
        }
        setToast(tr("automations.runningToast", { title: auto.title }));
        window.setTimeout(() => setToast(null), 3200);
        return true;
      } catch (error) {
        if (automationRunId && api.isTauri()) {
          try {
            await api.automationRunFinish(automationRunId, "failed", String(error));
          } catch {
            /* the run may already have reached a terminal provider state */
          }
        }
        setLocalError(String(error));
        return false;
      } finally {
        runLock.current = false;
      }
    },
    [
      connecting,
      projects,
      refreshSessions,
      sessionState,
      setActiveProject,
      setAppView,
      setAttachments,
      setDraft,
      setExpandedProjects,
      setHistoryOpen,
      setLiveHost,
      setLocalError,
      setMainPane,
      setMessages,
      setPerm,
      setRetryStatus,
      setSession,
      setToast,
      showToast,
      tr,
      messagesBySessionRef,
      viewingSessionIdRef,
      openingSessionIdRef,
      liveHostRef,
    ],
  );
}
