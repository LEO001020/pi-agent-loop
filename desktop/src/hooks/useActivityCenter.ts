import {
  useCallback,
  useEffect,
  useState,
  type Dispatch,
  type SetStateAction,
  type MutableRefObject,
} from "react";
import * as api from "@/lib/api";
import {
  loadActivity,
  markActivityRead,
  saveActivity,
  toggleActivityPin,
  dismissActivity,
  upsertActivity,
  isActivityActive,
  type ActivityItem,
  type ActivityPatch,
  type ActivityStatus,
} from "@/lib/activity";
import type {
  AskUserPayload,
  PermissionPayload,
  SessionSnapshot,
  TurnErrorPayload,
} from "@/lib/session";

export type ActivityTranslate = (
  key: string,
  vars?: Record<string, string | number>,
) => string;

export type ActivitySessionRow = {
  id: string;
  title: string;
  projectId: string | null;
  modelId?: string | null;
};

export type ActivityProjectRow = {
  id: string;
  name: string;
};

export type ActivityCenterDeps = {
  sessionsRef: MutableRefObject<ActivitySessionRow[]>;
  projectsRef: MutableRefObject<ActivityProjectRow[]>;
  translate: ActivityTranslate;
  storage?: Pick<Storage, "getItem" | "setItem">;
  isTauri?: () => boolean;
};

export type ActivityCenterController = {
  activityItems: ActivityItem[];
  activityOpen: boolean;
  runningSessions: api.RunningSessionSnapshot[];
  setActivityOpen: Dispatch<SetStateAction<boolean>>;
  markRead: (id: string) => void;
  togglePin: (id: string) => void;
  dismiss: (id: string) => void;
  record: (patch: ActivityPatch) => void;
  complete: (
    sessionId: string,
    title?: string,
    modelId?: string | null,
  ) => void;
};

const EMPTY_SESSIONS: ActivitySessionRow[] = [];
const EMPTY_PROJECTS: ActivityProjectRow[] = [];

/**
 * Owns the durable attention history and event subscriptions for the activity
 * center. Execution still belongs to SessionManager; this hook only projects
 * those events into the existing activity data model.
 */
export function useActivityCenter({
  sessionsRef,
  projectsRef,
  translate,
  storage = localStorage,
  isTauri = api.isTauri,
}: ActivityCenterDeps): ActivityCenterController {
  const [activityItems, setActivityItems] = useState<ActivityItem[]>(() =>
    loadActivity(storage),
  );
  const [activityOpen, setActivityOpen] = useState(false);
  const [runningSessions, setRunningSessions] = useState<
    api.RunningSessionSnapshot[]
  >([]);

  const activityContext = useCallback(
    (
      sessionId: string,
      fallbackTitle?: string,
      fallbackModelId?: string | null,
    ) => {
      const row = sessionsRef.current.find((session) => session.id === sessionId);
      const project = row?.projectId
        ? projectsRef.current.find((candidate) => candidate.id === row.projectId) ?? null
        : null;
      return {
        sessionId,
        projectId: row?.projectId ?? null,
        projectName: project?.name ?? null,
        title: fallbackTitle || row?.title || translate("session.new"),
        modelId:
          fallbackModelId !== undefined
            ? fallbackModelId
            : row?.modelId ?? null,
      };
    },
    [projectsRef, sessionsRef, translate],
  );

  const record = useCallback(
    (patch: ActivityPatch) => {
      setActivityItems((current) =>
        upsertActivity(
          current,
          { ...activityContext(patch.sessionId), ...patch },
          new Date().toISOString(),
        ),
      );
    },
    [activityContext],
  );

  const complete = useCallback(
    (sessionId: string, title?: string, modelId?: string | null) => {
      setActivityItems((current) => {
        const existing = current.find((item) => item.sessionId === sessionId);
        if (!existing || !isActivityActive(existing.status)) return current;
        return upsertActivity(
          current,
          {
            ...activityContext(sessionId, title, modelId),
            sessionId,
            status: "completed",
            source: "session",
          },
          new Date().toISOString(),
        );
      });
    },
    [activityContext],
  );

  useEffect(() => {
    saveActivity(storage, activityItems);
  }, [activityItems, storage]);

  useEffect(() => {
    if (!isTauri()) return;
    let cancelled = false;
    const refresh = () => {
      void api
        .sessionsRunning()
        .then((rows) => {
          if (cancelled) return;
          setRunningSessions(rows);
          setActivityItems((current) => {
            const now = new Date().toISOString();
            return rows.reduce((next, row) => {
              const status: ActivityStatus =
                row.state === "awaiting_permission"
                  ? "awaiting_permission"
                  : "running";
              return upsertActivity(
                next,
                {
                  ...activityContext(row.sessionId, row.title, row.modelId),
                  sessionId: row.sessionId,
                  status,
                  source: "session",
                },
                now,
              );
            }, current);
          });
        })
        .catch(() => {
          // The activity center is secondary UI; polling failures are transient.
        });
    };
    refresh();
    const timer = window.setInterval(refresh, 1500);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [activityContext, isTauri]);

  useEffect(() => {
    if (!isTauri()) return;
    let cancelled = false;
    const cleanups: Array<() => void> = [];
    const track = async (subscription: Promise<() => void>) => {
      const cleanup = await subscription;
      if (cancelled) cleanup();
      else cleanups.push(cleanup);
    };

    void (async () => {
      await track(
        api.listen<SessionSnapshot>("session://state", (snapshot) => {
          if (cancelled || !snapshot.sessionId) return;
          if (snapshot.state === "streaming") {
            record({
              ...activityContext(snapshot.sessionId, snapshot.title, snapshot.modelId),
              sessionId: snapshot.sessionId,
              status: "running",
              source: "session",
            });
          } else if (snapshot.state === "awaiting_permission") {
            record({
              ...activityContext(snapshot.sessionId, snapshot.title, snapshot.modelId),
              sessionId: snapshot.sessionId,
              status: "awaiting_permission",
              source: "permission",
            });
          } else if (snapshot.state === "disconnected" && snapshot.lastError) {
            record({
              ...activityContext(snapshot.sessionId, snapshot.title, snapshot.modelId),
              sessionId: snapshot.sessionId,
              status: "failed",
              detail: snapshot.lastError.message,
              source: "error",
            });
          } else if (snapshot.state === "ready") {
            complete(snapshot.sessionId, snapshot.title, snapshot.modelId);
          }
        }),
      );
      await track(
        api.listen<PermissionPayload>("session://permission", (payload) => {
          if (cancelled || !payload?.sessionId) return;
          record({
            ...activityContext(payload.sessionId, payload.title),
            sessionId: payload.sessionId,
            status: "awaiting_permission",
            detail: payload.title || payload.preview,
            source: "permission",
          });
        }),
      );
      await track(
        api.listen<AskUserPayload>("session://ask_user", (payload) => {
          if (cancelled || !payload?.sessionId) return;
          record({
            ...activityContext(payload.sessionId),
            sessionId: payload.sessionId,
            status: "awaiting_input",
            detail: translate("activity.status.awaiting_input"),
            source: "input",
          });
        }),
      );
      await track(
        api.listen<{ sessionId?: string; waiting?: boolean; body?: string }>(
          "session://plan",
          (payload) => {
            if (cancelled || !payload?.sessionId) return;
            record({
              ...activityContext(payload.sessionId),
              sessionId: payload.sessionId,
              status: payload.waiting === false ? "running" : "awaiting_plan",
              detail: payload.body || undefined,
              source: "plan",
            });
          },
        ),
      );
      await track(
        api.listen<{
          sessionId?: string;
          attempt?: number;
          maxRetries?: number;
          reason?: string;
        }>("session://retry", (payload) => {
          if (cancelled || !payload?.sessionId) return;
          const attempt = payload.attempt ?? 0;
          const max = payload.maxRetries ?? 0;
          record({
            ...activityContext(payload.sessionId),
            sessionId: payload.sessionId,
            status: "running",
            detail:
              payload.reason ||
              (attempt > 0 ? `Retry ${attempt}/${max}` : undefined),
            source: "retry",
          });
        }),
      );
      await track(
        api.listen<TurnErrorPayload>("session://turn_error", (payload) => {
          if (cancelled || !payload?.sessionId) return;
          record({
            ...activityContext(payload.sessionId),
            sessionId: payload.sessionId,
            status: "failed",
            detail: payload.message || payload.content || payload.code || undefined,
            source: "error",
          });
        }),
      );
      await track(
        api.listen<{ sessionId?: string; message?: string }>(
          "session://stream_stall",
          (payload) => {
            if (cancelled || !payload?.sessionId) return;
            record({
              ...activityContext(payload.sessionId),
              sessionId: payload.sessionId,
              status: "stalled",
              detail: payload.message || undefined,
              source: "stall",
            });
          },
        ),
      );
      await track(
        api.listen<{ sessionId?: string; marker?: string; reason?: string }>(
          "session://turn_marker",
          (payload) => {
            if (
              cancelled ||
              payload?.marker !== "turn_cancelled" ||
              !payload.sessionId
            ) {
              return;
            }
            record({
              ...activityContext(payload.sessionId),
              sessionId: payload.sessionId,
              status: "interrupted",
              detail: payload.reason || undefined,
              source: "marker",
            });
          },
        ),
      );
    })().catch(() => {
      // Listener failures must never affect the chat surface.
    });

    return () => {
      cancelled = true;
      cleanups.splice(0).forEach((cleanup) => cleanup());
    };
  }, [activityContext, complete, isTauri, record, translate]);

  const markRead = useCallback((id: string) => {
    setActivityItems((current) => markActivityRead(current, id));
  }, []);
  const togglePin = useCallback((id: string) => {
    setActivityItems((current) => toggleActivityPin(current, id));
  }, []);
  const dismiss = useCallback((id: string) => {
    setActivityItems((current) => dismissActivity(current, id));
  }, []);

  return {
    activityItems,
    activityOpen,
    runningSessions,
    setActivityOpen,
    markRead,
    togglePin,
    dismiss,
    record,
    complete,
  };
}

export function activityDepsForTests(
  over: Partial<ActivityCenterDeps> = {},
): ActivityCenterDeps {
  return {
    sessionsRef: { current: EMPTY_SESSIONS },
    projectsRef: { current: EMPTY_PROJECTS },
    translate: (key) => key,
    isTauri: () => false,
    ...over,
  };
}
