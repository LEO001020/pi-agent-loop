import {
  useCallback,
  useEffect,
  useRef,
  type Dispatch,
  type MutableRefObject,
  type SetStateAction,
} from "react";
import * as api from "@/lib/api";
import type { MessageKey, Vars } from "@/i18n";
import {
  applyResolvedSessionMedia,
  collectSessionRelativeMediaRefs,
  mergeAttachments,
  mergeMessageAttachments,
  parseAttachmentsFromContent,
  type Attachment,
} from "@/lib/attachments";
import { parseScheduledUserContent } from "@/lib/automations";
import { extractAutomationPayload } from "@/lib/automationSetup";
import { hydrateDisplayContent } from "@/lib/draftDoc";
import { emptySessionPlan, type SessionPlanState } from "@/lib/planSession";
import { isProjectPathMissing } from "@/lib/projectPath";
import { shouldRestoreLastSession } from "@/lib/sessionRestore";
import {
  INITIAL_CONTEXT_USAGE,
  reduceContextUsage,
  type ContextUsageState,
} from "@/lib/contextUsage";
import {
  buildSegmentsFromLegacy,
  IDLE_SNAPSHOT,
  parseCompactContent,
  parseToolStepContent,
  preferSessionMessages,
  splitThoughtPhases,
  type AskUserPayload,
  type ChatMessage,
  type PermissionPayload,
  type SessionSnapshot,
} from "@/lib/session";
import {
  mergeSessionChange,
  sessionChangesFromMessages,
  type SessionFileChange,
} from "@/lib/sessionChanges";

type T = (key: MessageKey, vars?: Vars) => string;
type Setter<TValue> = Dispatch<SetStateAction<TValue>>;

export type SessionLifecycleProject = {
  id: string;
  name: string;
  path: string;
  trusted: boolean;
  pathOk: boolean;
  pinned?: boolean;
  permissionPolicy?: string | null;
  planModelId?: string | null;
  reviewModelId?: string | null;
};

export type SessionLifecycleRow = {
  id: string;
  title: string;
  projectId: string | null;
  updatedAt: string;
  remoteCwd?: string | null;
  archived?: boolean;
  pinned?: boolean;
  scheduled?: boolean;
  modelId?: string | null;
};

export type SessionRetryStatus = {
  attempt: number;
  maxRetries: number;
  reason: string;
};

export type EnsureConnectedOptions = {
  force?: boolean;
  sessionId?: string | null;
};

export type SessionLifecycleDeps = {
  projects: SessionLifecycleProject[];
  sessions: SessionLifecycleRow[];
  activeProject: SessionLifecycleProject | null;
  session: SessionSnapshot;
  connecting: boolean;
  mode: string;
  remoteRuntime: api.RemoteRuntimeSettings;
  resourceProjectPath: string | null;
  appGate: "loading" | "setup" | "ready";
  reopenLastSession: boolean;
  lastSessionId: string | null;
  tr: T;
  refreshSessions: () => Promise<void>;
  tryApplyAutomationFromSession: (sessionId: string) => void | Promise<void>;

  messagesBySessionRef: MutableRefObject<Map<string, ChatMessage[]>>;
  messagesRef: MutableRefObject<ChatMessage[]>;
  viewingSessionIdRef: MutableRefObject<string | null>;
  openingSessionIdRef: MutableRefObject<string | null>;
  planBySessionRef: MutableRefObject<Map<string, SessionPlanState>>;
  planRef: MutableRefObject<SessionPlanState>;
  liveHostRef: MutableRefObject<SessionSnapshot>;

  setMainPane: Setter<"chat" | "automations">;
  setAppView: Setter<"workbench" | "settings">;
  setMessages: Setter<ChatMessage[]>;
  setContextUsage: Setter<ContextUsageState>;
  setSessionChangesById: Setter<Record<string, SessionFileChange[]>>;
  setPlan: Setter<SessionPlanState>;
  setEditingUserMessageId: Setter<string | null>;
  setEditAttachments: Setter<Attachment[]>;
  setSessions: Setter<SessionLifecycleRow[]>;
  setActiveProject: Setter<SessionLifecycleProject | null>;
  setRemoteWorkspacePath: Setter<string | null>;
  setAttachments: Setter<Attachment[]>;
  setSession: Setter<SessionSnapshot>;
  setLiveHost: Setter<SessionSnapshot>;
  setLocalError: Setter<string | null>;
  setPerm: Setter<PermissionPayload | null>;
  setAskUser: Setter<AskUserPayload | null>;
  setRetryStatus: Setter<SessionRetryStatus | null>;
  setLastSessionId: Setter<string | null>;
  setConnecting: Setter<boolean>;
  setExpandedProjects: Setter<Record<string, boolean>>;
  setHistoryOpen: Setter<boolean>;
};

type StoredSessionMessage = Awaited<ReturnType<typeof api.sessionMessages>>[number];

function mapStoredMessage(message: StoredSessionMessage): ChatMessage {
  const parsed = parseAttachmentsFromContent(message.content);
  const storedAttachments: Attachment[] = (message.attachments ?? []).map((attachment) => ({
    path: attachment.path,
    name: attachment.name || attachment.path.split(/[/\\]/).pop() || attachment.path,
    isDir: !!attachment.isDir,
  }));
  const attachments = mergeMessageAttachments(
    mergeAttachments(parsed.attachments, storedAttachments),
    message.content,
  );
  const rawContent =
    parsed.text || (parsed.attachments.length ? "" : message.content);
  const content =
    message.role === "user" ? hydrateDisplayContent(rawContent) : rawContent;
  const rawMarker = (message as { marker?: string | null }).marker || undefined;
  const marker =
    rawMarker ||
    (message.role === "tool" && content.startsWith("context_compact")
      ? "context_compact"
      : message.role === "tool" && content.startsWith("tool_step|")
        ? "tool_step"
        : message.role === "tool" && content.startsWith("turn_cancelled")
          ? "turn_cancelled"
          : undefined);
  const compactMeta =
    marker === "context_compact"
      ? parseCompactContent(content) || undefined
      : undefined;
  const toolParsed = marker === "tool_step" ? parseToolStepContent(content) : null;
  const role = message.role as "user" | "assistant" | "tool";
  let displayContent = toolParsed?.title || content;
  if (role === "assistant" && displayContent) {
    displayContent = extractAutomationPayload(displayContent).cleanText;
  }
  const thoughtPhases = splitThoughtPhases(message.thought);
  return {
    id: message.id,
    role,
    content: displayContent,
    thought: message.thought ?? undefined,
    modelId: message.modelId ?? undefined,
    effort: message.effort ?? undefined,
    thoughtPhases,
    segments:
      role === "assistant"
        ? buildSegmentsFromLegacy(displayContent, message.thought, thoughtPhases)
        : undefined,
    isError: message.isError || undefined,
    attachments,
    createdAt: message.createdAt || undefined,
    marker,
    compactMeta: compactMeta ?? undefined,
    toolCallId: message.id.startsWith("tool-")
      ? message.id.slice(5)
      : undefined,
    toolKind: toolParsed?.kind,
    toolStatus:
      toolParsed?.status ??
      (marker === "turn_cancelled" ? content.split("|")[1] : undefined),
    toolDetail: toolParsed?.detail,
    toolPath: toolParsed?.path,
    streaming: false,
  };
}

/** Session open/connect/reattach lifecycle shared by all existing surfaces. */
export function useSessionLifecycle({
  projects,
  sessions,
  activeProject,
  session,
  connecting,
  mode,
  remoteRuntime,
  resourceProjectPath,
  appGate,
  reopenLastSession,
  lastSessionId,
  tr,
  refreshSessions,
  tryApplyAutomationFromSession,
  messagesBySessionRef,
  messagesRef,
  viewingSessionIdRef,
  openingSessionIdRef,
  planBySessionRef,
  planRef,
  liveHostRef,
  setMainPane,
  setAppView,
  setMessages,
  setContextUsage,
  setSessionChangesById,
  setPlan,
  setEditingUserMessageId,
  setEditAttachments,
  setSessions,
  setActiveProject,
  setRemoteWorkspacePath,
  setAttachments,
  setSession,
  setLiveHost,
  setLocalError,
  setPerm,
  setAskUser,
  setRetryStatus,
  setLastSessionId,
  setConnecting,
  setExpandedProjects,
  setHistoryOpen,
}: SessionLifecycleDeps) {
  const openSession = useCallback(
    async (row: SessionLifecycleRow, project?: SessionLifecycleProject | null) => {
      const projectForSession =
        project || projects.find((candidate) => candidate.id === row.projectId) || null;
      setMainPane("chat");
      setAppView("workbench");

      const leavingId = viewingSessionIdRef.current;
      if (leavingId) {
        messagesBySessionRef.current.set(leavingId, messagesRef.current);
        planBySessionRef.current.set(leavingId, planRef.current);
      }

      openingSessionIdRef.current = row.id;
      viewingSessionIdRef.current = row.id;
      setPlan(
        planBySessionRef.current.get(row.id) ?? emptySessionPlan(tr("plan.ready")),
      );
      setEditingUserMessageId(null);
      setEditAttachments([]);

      try {
        const stored = await api.sessionMessages(row.id);
        let mapped = stored.map(mapStoredMessage);
        if (api.isTauri()) {
          const relatives = collectSessionRelativeMediaRefs(mapped);
          if (relatives.length) {
            try {
              const resolved = await api.sessionResolveRelativeMedia(row.id, relatives);
              if (resolved.length) {
                mapped = applyResolvedSessionMedia(
                  mapped,
                  resolved.map((attachment) => ({
                    path: attachment.path,
                    name:
                      attachment.name ||
                      attachment.path.split(/[/\\]/).pop() ||
                      attachment.path,
                    isDir: !!attachment.isDir,
                  })),
                );
              }
            } catch {
              /* Media resolution is best effort; the transcript remains usable. */
            }
          }
        }

        const chosen = preferSessionMessages(
          messagesBySessionRef.current.get(row.id),
          mapped,
        );
        if (viewingSessionIdRef.current !== row.id) {
          messagesBySessionRef.current.set(row.id, chosen);
          if (openingSessionIdRef.current === row.id) openingSessionIdRef.current = null;
          return;
        }

        messagesBySessionRef.current.set(row.id, chosen);
        const fromHistory = sessionChangesFromMessages(chosen);
        setSessionChangesById((previous) => {
          const existing = previous[row.id] ?? [];
          let next = fromHistory;
          for (const change of existing) {
            if (change.before == null && change.after == null) continue;
            next = mergeSessionChange(next, {
              toolCallId: change.toolCallId,
              title: change.title,
              kind: change.toolKind,
              status: change.status,
              path: change.path,
              before: change.before,
              after: change.after,
              updatedAt: change.updatedAt,
            });
          }
          return { ...previous, [row.id]: next };
        });

        const stripped = chosen.map((message) => {
          if (message.role !== "assistant" || !message.content) return message;
          const cleanText = extractAutomationPayload(message.content).cleanText;
          return cleanText === message.content
            ? message
            : { ...message, content: cleanText };
        });
        setMessages(stripped);
        setContextUsage(
          reduceContextUsage(INITIAL_CONTEXT_USAGE, {
            type: "hydrate",
            messages: stripped,
          }),
        );
        void tryApplyAutomationFromSession(row.id);

        if (
          !row.scheduled &&
          chosen.some(
            (message) =>
              message.role === "user" &&
              !!parseScheduledUserContent(message.content || ""),
          )
        ) {
          setSessions((current) =>
            current.map((candidate) =>
              candidate.id === row.id
                ? { ...candidate, scheduled: true }
                : candidate,
            ),
          );
          if (api.isTauri()) {
            void api.sessionSetScheduled(row.id, true).catch(() => {});
          }
        }

        const allPaths = chosen.flatMap(
          (message) => message.attachments?.map((attachment) => attachment.path) ?? [],
        );
        if (allPaths.length && api.isTauri()) {
          void api.pathsClassify(allPaths).then((classified) => {
            if (viewingSessionIdRef.current !== row.id) return;
            const byPath = new Map(classified.map((entry) => [entry.path, entry]));
            setMessages((current) =>
              current.map((message) => {
                if (!message.attachments?.length) return message;
                return {
                  ...message,
                  attachments: message.attachments.map((attachment) => {
                    const entry = byPath.get(attachment.path);
                    return entry
                      ? { path: entry.path, name: entry.name, isDir: entry.isDir }
                      : attachment;
                  }),
                };
              }),
            );
          });
        }
      } catch {
        if (viewingSessionIdRef.current !== row.id) {
          if (openingSessionIdRef.current === row.id) openingSessionIdRef.current = null;
          return;
        }
        const cached = messagesBySessionRef.current.get(row.id) ?? [];
        setMessages(cached);
        setContextUsage(
          reduceContextUsage(INITIAL_CONTEXT_USAGE, {
            type: "hydrate",
            messages: cached,
          }),
        );
      }

      if (viewingSessionIdRef.current !== row.id) {
        if (openingSessionIdRef.current === row.id) openingSessionIdRef.current = null;
        return;
      }

      setActiveProject(projectForSession);
      setRemoteWorkspacePath(
        remoteRuntime.enabled
          ? row.remoteCwd?.trim() || remoteRuntime.cwd.trim() || null
          : null,
      );
      setAttachments([]);

      const live = liveHostRef.current;
      if (live.sessionId === row.id) {
        setSession({
          ...live,
          title: row.title || live.title || tr("session.untitled"),
        });
      } else {
        setSession({
          ...IDLE_SNAPSHOT,
          sessionId: row.id,
          title: row.title || tr("session.untitled"),
          state: "idle",
          backend: "pi_rpc",
        });
      }
      if (openingSessionIdRef.current === row.id) openingSessionIdRef.current = null;
      setLocalError(null);
      if (live.sessionId !== row.id) {
        setPerm(null);
        setAskUser(null);
        setRetryStatus(null);
      }

      if (api.isTauri()) {
        setLastSessionId(row.id);
        void api.settingsRememberLastSession(row.id, projectForSession?.id ?? null).catch(() => {});
      }

      if (
        api.isTauri() &&
        (remoteRuntime.enabled ||
          !projectForSession ||
          (projectForSession.trusted && !isProjectPathMissing(projectForSession.pathOk))) &&
        !(live.sessionId === row.id && live.state === "ready")
      ) {
        const warmId = row.id;
        void (async () => {
          if (viewingSessionIdRef.current !== warmId) return;
          try {
            const snapshot = await api.sessionConnect({
              projectPath: remoteRuntime.enabled ? undefined : projectForSession?.path,
              remotePath: remoteRuntime.enabled
                ? row.remoteCwd?.trim() || remoteRuntime.cwd.trim() || undefined
                : undefined,
              sessionId: warmId,
            });
            if (viewingSessionIdRef.current !== warmId) return;
            setLiveHost(snapshot);
            liveHostRef.current = snapshot;
            if (snapshot.sessionId === warmId) {
              setSession((previous) => ({
                ...snapshot,
                title:
                  previous.title || row.title || snapshot.title || tr("session.untitled"),
              }));
            }
            if (snapshot.lastError && snapshot.state !== "ready") {
              console.warn(
                "warm connect:",
                snapshot.lastError.code,
                snapshot.lastError.message,
              );
            }
          } catch (error) {
            console.warn("warm connect failed", error);
          }
        })();
      }
    },
    [
      projects,
      remoteRuntime.cwd,
      remoteRuntime.enabled,
      setActiveProject,
      setAppView,
      setAskUser,
      setAttachments,
      setContextUsage,
      setEditAttachments,
      setEditingUserMessageId,
      setLocalError,
      setLiveHost,
      setMainPane,
      setMessages,
      setPerm,
      setPlan,
      setRemoteWorkspacePath,
      setRetryStatus,
      setSession,
      setSessionChangesById,
      setSessions,
      setLastSessionId,
      tr,
      tryApplyAutomationFromSession,
      messagesBySessionRef,
      messagesRef,
      openingSessionIdRef,
      planBySessionRef,
      planRef,
      liveHostRef,
      viewingSessionIdRef,
    ],
  );

  const openSessionRef = useRef(openSession);
  openSessionRef.current = openSession;
  const didRestoreLastRef = useRef(false);

  useEffect(() => {
    if (appGate !== "ready" || didRestoreLastRef.current) return;
    if (!api.isTauri()) {
      didRestoreLastRef.current = true;
      return;
    }
    const id = shouldRestoreLastSession({
      enabled: reopenLastSession,
      workbenchReady: true,
      lastSessionId,
      sessions,
      currentSessionId: session.sessionId,
    });
    didRestoreLastRef.current = true;
    if (!id) return;
    const row = sessions.find((candidate) => candidate.id === id);
    if (row) void openSessionRef.current(row);
  }, [appGate, lastSessionId, reopenLastSession, session.sessionId, sessions]);

  const ensureConnected = useCallback(
    async (
      forceOrOptions: boolean | EnsureConnectedOptions = false,
    ): Promise<string | null> => {
      const options =
        typeof forceOrOptions === "boolean"
          ? { force: forceOrOptions, sessionId: undefined as string | null | undefined }
          : forceOrOptions;
      const force = !!options.force;
      const preferredId =
        options.sessionId !== undefined ? options.sessionId : session.sessionId;

      if (!remoteRuntime.enabled && activeProject && !activeProject.trusted) {
        setLocalError(tr("project.trustFirst", { name: activeProject.name }));
        return null;
      }
      if (
        !remoteRuntime.enabled &&
        activeProject &&
        isProjectPathMissing(activeProject.pathOk)
      ) {
        setLocalError(tr("project.pathMissing", { name: activeProject.name }));
        return null;
      }
      if (
        !force &&
        preferredId &&
        session.sessionId === preferredId &&
        session.state === "ready" &&
        !session.lastError
      ) {
        return preferredId;
      }
      if (!force && preferredId) {
        const live = liveHostRef.current;
        if (live.sessionId === preferredId && live.state === "ready" && !live.lastError) {
          return preferredId;
        }
      }
      if (connecting) return null;
      setConnecting(true);
      const viewedBefore = viewingSessionIdRef.current;
      try {
        let sessionId = preferredId ?? null;
        if (!sessionId && api.isTauri()) {
          const meta = (await api.sessionCreate(
            activeProject?.id,
            tr("session.new"),
          )) as { id: string; title?: string };
          sessionId = meta.id;
          const draftMessages = messagesBySessionRef.current.get("__draft__");
          if (draftMessages?.length) {
            messagesBySessionRef.current.set(meta.id, draftMessages);
            messagesBySessionRef.current.delete("__draft__");
          }
          if (
            viewingSessionIdRef.current === viewedBefore ||
            viewingSessionIdRef.current === null ||
            viewingSessionIdRef.current === meta.id
          ) {
            viewingSessionIdRef.current = meta.id;
            setSession((previous) => ({
              ...previous,
              sessionId: meta.id,
              title: meta.title || tr("session.new"),
            }));
          }
          if (activeProject) {
            setExpandedProjects((expanded) => ({ ...expanded, [activeProject.id]: true }));
          } else {
            setHistoryOpen(true);
          }
          await refreshSessions();
        }

        const snapshot = await api.sessionConnect({
          projectPath: remoteRuntime.enabled ? undefined : activeProject?.path,
          remotePath: remoteRuntime.enabled ? resourceProjectPath ?? undefined : undefined,
          sessionId: sessionId ?? undefined,
          mode,
        });
        setLiveHost(snapshot);
        liveHostRef.current = snapshot;
        if (
          snapshot.sessionId &&
          (viewingSessionIdRef.current === snapshot.sessionId ||
            viewingSessionIdRef.current === viewedBefore ||
            (viewedBefore === null && viewingSessionIdRef.current === snapshot.sessionId))
        ) {
          viewingSessionIdRef.current = snapshot.sessionId;
          setSession(snapshot);
        }
        if (snapshot.lastError || snapshot.state !== "ready") {
          const code = snapshot.lastError?.code ?? "AGENT_CRASHED";
          const message = snapshot.lastError?.message ?? "connect failed";
          if (viewingSessionIdRef.current === (snapshot.sessionId || sessionId)) {
            setLocalError(`${code}: ${message}`);
          }
          return null;
        }
        if (viewingSessionIdRef.current === (snapshot.sessionId || sessionId)) {
          setLocalError(null);
        }
        return snapshot.sessionId || sessionId || null;
      } catch (error) {
        if (
          viewingSessionIdRef.current === viewedBefore ||
          viewingSessionIdRef.current === preferredId ||
          viewingSessionIdRef.current === session.sessionId
        ) {
          setLocalError(String(error));
        }
        return null;
      } finally {
        setConnecting(false);
      }
    },
    [
      activeProject,
      connecting,
      mode,
      refreshSessions,
      remoteRuntime.enabled,
      resourceProjectPath,
      session,
      setExpandedProjects,
      setHistoryOpen,
      setLiveHost,
      setLocalError,
      setSession,
      setConnecting,
      tr,
      liveHostRef,
      messagesBySessionRef,
      viewingSessionIdRef,
    ],
  );

  return { ensureConnected, openSession };
}
