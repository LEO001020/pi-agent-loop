/**
 * Parallel task batch state for the shell.
 *
 * The orchestration itself lives in `runTaskBatchWith`, which is unit tested
 * against fake host calls. This hook owns only what React needs: the strip's
 * entries, and supplying the real bindings.
 */

import { useCallback, useState } from "react";
import * as api from "@/lib/api";
import {
  runTaskBatchWith,
  type ParallelTask,
  type TaskRunnerDeps,
} from "@/lib/parallelTasks";

export type BatchEntry = ParallelTask & {
  sessionId: string | null;
  status: "pending" | "starting" | "running" | "failed";
  error: string | null;
  worktreePath: string | null;
};

export interface TaskBatchDeps {
  tr: (key: string, vars?: Record<string, string | number>) => string;
  showToast: (message: string, ms?: number) => void;
  /** Project the tasks belong to; `null` runs them as orphan chats. */
  project: { id?: string; path?: string } | null;
  /** Refresh the sidebar once the batch has started. */
  onStarted: () => Promise<void> | void;
}

export interface TaskBatchState {
  entries: BatchEntry[];
  run: (tasks: ParallelTask[], options?: { worktree?: boolean }) => Promise<void>;
}

export function useTaskBatch(deps: TaskBatchDeps): TaskBatchState {
  const { tr, showToast, project, onStarted } = deps;
  const [entries, setEntries] = useState<BatchEntry[]>([]);

  const run = useCallback(
    async (tasks: ParallelTask[], options: { worktree?: boolean } = {}) => {
      if (tasks.length === 0) return;
      if (options.worktree && !project?.path) {
        showToast(tr("batch.worktreeNeedsProject"), 4500);
        return;
      }
      const settings = await api.settingsGet().catch(() => null);
      const cap = Math.max(1, settings?.maxConcurrentAgents ?? 3);

      setEntries(
        tasks.map((t) => ({
          ...t,
          sessionId: null,
          status: "pending" as const,
          error: null,
          worktreePath: null,
          worktree: options.worktree,
        })),
      );

      const runnerDeps: TaskRunnerDeps = {
        createSession: async (title) =>
          (await api.sessionCreate(project?.id, title)) as { id: string },
        setModel: async (sessionId, modelId) => {
          await api.composerPrefsSet({
            sessionId,
            projectId: project?.id ?? null,
            modelId,
          });
        },
        connect: async (sessionId, taskProjectPath) => {
          const remote = !!settings?.remoteRuntime?.enabled;
          if (remote && taskProjectPath) {
            await api.sessionSetRemoteCwd(sessionId, taskProjectPath);
          }
          const snap = await api.sessionConnect({
            projectPath: remote ? undefined : taskProjectPath ?? project?.path,
            remotePath: remote ? taskProjectPath ?? project?.path : undefined,
            sessionId,
            mode: "agent",
          });
          return {
            ready: snap.state === "ready",
            error: snap.lastError?.message,
          };
        },
        send: async (prompt, sessionId) => {
          await api.sessionSend(prompt, null, null, sessionId);
        },
        createWorktree: async (name) => {
          if (!project?.path) throw new Error("worktree project missing");
          const safe = name
            .toLowerCase()
            .replace(/[^a-z0-9._-]+/g, "-")
            .replace(/^-+|-+$/g, "")
            .slice(0, 48) || "pi-best-of-n";
          return api.gitWorktreeAdd(project.path, safe);
        },
      };

      const outcomes = await runTaskBatchWith(runnerDeps, tasks, cap, (o) =>
        setEntries((prev) =>
          prev.map((e) =>
            e.title === o.title
              ? {
                  ...e,
                  sessionId: o.sessionId,
                  status: o.status,
                  error: o.error,
                  worktreePath: o.worktreePath ?? null,
                  // Show what was applied, not what was asked for.
                  modelId: o.appliedModel,
                }
              : e,
          ),
        ),
      );

      await onStarted();
      const started = outcomes.filter((o) => o.status === "running").length;
      const failed = outcomes.length - started;
      showToast(
        failed > 0
          ? tr("batch.startedPartial", { n: started, failed })
          : tr("batch.started", { n: started }),
        failed > 0 ? 6000 : 3200,
      );
    },
    [onStarted, project, showToast, tr],
  );

  return { entries, run };
}
