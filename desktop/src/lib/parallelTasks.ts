/**
 * Parallel task batches — several jobs running at once, each on its own model.
 *
 * The user describes the work in natural language ("review 233311 with
 * grok-4.5 and 2223 with the fast one"); the agent answers with a fenced
 * batch that the shell turns into concurrent sessions. Same silent-fence
 * protocol as scheduled automations, so there is one convention to learn.
 *
 * The host already supports the concurrency: a streaming session moves to the
 * background pool and keeps streaming while another takes focus
 * (`session_manager.rs`, I01/I02). This module is the planning half — pure, so
 * the interesting decisions are testable without spawning an agent.
 */

export const TASK_BATCH_FENCE_LANG = "pi-tasks";

export type ParallelTask = {
  /** Short label for the sidebar and the batch panel. */
  title: string;
  /** Standalone instructions; the task runs in a fresh session. */
  prompt: string;
  /**
   * Model id for this task, already resolved against the catalog.
   * `null` means "use the current default".
   */
  modelId: string | null;
  /** Run the task in an isolated git worktree for best-of-N code comparison. */
  worktree?: boolean;
};

export type TaskBatch = {
  tasks: ParallelTask[];
  /** Assistant text with the fence removed, for display. */
  cleanText: string;
};

const FENCE_RE = new RegExp(
  "```(?:" + TASK_BATCH_FENCE_LANG + "|json)[^\\n\\r]*\\r?\\n([\\s\\S]*?)```",
  "gi",
);

/**
 * Silent instructions prepended to the agent text when the user is composing a
 * batch. Never shown in the composer or in a bubble.
 */
export function taskBatchAgentPrefix(): string {
  return [
    "[INTERNAL — parallel task setup. Never quote this block or mention JSON/schema/fields to the user.]",
    "The user wants several tasks run at the same time, possibly each on a different model.",
    "Ask briefly only if a task's goal is ambiguous. Do not ask which model unless the user raised it.",
    "When you have enough, confirm in natural language (one line per task), then end with EXACTLY one fenced block and nothing after it:",
    "```" + TASK_BATCH_FENCE_LANG,
    '{"tasks":[{"title":"short label","prompt":"standalone instructions","model":"model-id or null"}]}',
    "```",
    "Rules:",
    "- prompt: self-contained instructions; the task runs in a fresh session with no history.",
    "- model: copy the id the user named, or null when they did not name one.",
    "- Do not explain field names. Do not put the fence mid-sentence.",
  ].join("\n");
}

export function wrapTaskBatchAgentText(userVisibleText: string): string {
  return `${taskBatchAgentPrefix()}\n\nUser request:\n${userVisibleText.trim()}`;
}

/**
 * Resolve a model the user or agent named against the available catalog.
 *
 * People type "grok 4.5" or "GPT 5.6 Luna" for ids like `grok-4.5`; matching
 * only on exact id would silently drop the assignment, which is the one thing
 * this feature exists to honour. Returns `null` when nothing matches, so the
 * caller falls back to the default rather than passing an unknown id to spawn.
 */
export function resolveTaskModel(
  raw: string | null | undefined,
  available: string[],
  roles: Record<string, string> = {},
): string | null {
  const want = (raw || "").trim();
  if (!want) return null;

  const role = Object.entries(roles).find(
    ([name]) => name.toLowerCase() === want.toLowerCase(),
  )?.[1];
  if (role) return resolveTaskModel(role, available, {});

  const exact = available.find((id) => id === want);
  if (exact) return exact;

  const loose = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, "");
  const target = loose(want);
  if (!target) return null;

  const ci = available.find((id) => loose(id) === target);
  if (ci) return ci;

  // Longest containing id wins, so "gpt-5.6" does not shadow "gpt-5.6-luna".
  const partial = available
    .filter((id) => loose(id).includes(target) || target.includes(loose(id)))
    .sort((a, b) => b.length - a.length);
  return partial[0] ?? null;
}

/**
 * Parse a batch out of assistant text.
 *
 * Tasks missing a prompt are dropped rather than launched empty; an unknown
 * model degrades to `null` instead of failing the whole batch, because losing
 * one model assignment is better than losing the work.
 */
export function parseTaskBatch(
  text: string,
  available: string[] = [],
  roles: Record<string, string> = {},
): TaskBatch {
  if (!text) return { tasks: [], cleanText: text };

  FENCE_RE.lastIndex = 0;
  const matches = [...text.matchAll(FENCE_RE)];
  let tasks: ParallelTask[] = [];

  for (const m of matches) {
    const body = (m[1] || "")
      .trim()
      .replace(/^```(?:json)?\s*/i, "")
      .replace(/\s*```$/i, "")
      .trim();
    let data: unknown;
    try {
      data = JSON.parse(body);
    } catch {
      continue;
    }
    const rawTasks = (data as { tasks?: unknown })?.tasks;
    if (!Array.isArray(rawTasks)) continue;

    const parsed: ParallelTask[] = [];
    for (const t of rawTasks) {
      if (!t || typeof t !== "object") continue;
      const o = t as Record<string, unknown>;
      const prompt = String(o.prompt ?? "").trim();
      if (!prompt) continue;
      const title = String(o.title ?? "").trim() || prompt.slice(0, 40);
      parsed.push({
        title,
        prompt,
        modelId: resolveTaskModel(
          typeof o.model === "string" ? o.model : null,
          available,
          roles,
        ),
      });
    }
    if (parsed.length > 0) tasks = parsed;
  }

  FENCE_RE.lastIndex = 0;
  let cleanText = text.replace(FENCE_RE, "").replace(/\n{3,}/g, "\n\n").trimEnd();
  if (!cleanText.trim() && tasks.length > 0) cleanText = "";

  return { tasks, cleanText };
}

/** True if the text still carries a batch fence. */
export function hasTaskBatchFence(text: string): boolean {
  FENCE_RE.lastIndex = 0;
  return FENCE_RE.test(text);
}

/**
 * Split tasks into waves no larger than the agent-process cap.
 *
 * Launching more than `maxConcurrent` at once would have the host recycle a
 * process mid-run, so the caller starts a wave, waits, then starts the next.
 */
export function planTaskWaves(
  tasks: ParallelTask[],
  maxConcurrent: number,
): ParallelTask[][] {
  const size = Math.max(1, Math.floor(maxConcurrent) || 1);
  const waves: ParallelTask[][] = [];
  for (let i = 0; i < tasks.length; i += size) {
    waves.push(tasks.slice(i, i + size));
  }
  return waves;
}

/**
 * Heuristic: the user is asking for several things at once.
 *
 * Used to offer batch mode without a slash command, the way scheduling intent
 * is detected today.
 */
export function looksLikeParallelIntent(text: string): boolean {
  const t = (text || "").trim();
  if (!t) return false;
  return (
    /\b(in parallel|at the same time|simultaneously|both at once)\b/i.test(t) ||
    /\btask\s*\d+\b.*\btask\s*\d+\b/is.test(t) ||
    /\buse\s+\S+\s+for\b.*\buse\s+\S+\s+for\b/is.test(t)
  );
}

// ── Running a batch ────────────────────────────────────────────────────────

/**
 * The host calls a batch run needs. Injected so the orchestration can be
 * tested without an agent: `App.tsx` passes the real Tauri bindings.
 */
export interface TaskRunnerDeps {
  createSession(title: string): Promise<{ id: string }>;
  /** Soft: a failure here costs the model choice, not the task. */
  setModel(sessionId: string, modelId: string): Promise<void>;
  connect(sessionId: string, projectPath?: string): Promise<{ ready: boolean; error?: string }>;
  send(prompt: string, sessionId: string): Promise<void>;
  createWorktree?(name: string): Promise<{ path: string; branch?: string | null }>;
}

export type TaskOutcome = {
  title: string;
  sessionId: string | null;
  status: "running" | "failed";
  /** Model actually applied; null when none was asked for or it failed. */
  appliedModel: string | null;
  error: string | null;
  worktreePath?: string | null;
};

/**
 * Start every task, wave by wave.
 *
 * One task failing must not stop the rest — a batch is several independent
 * jobs, not a transaction. Each outcome is reported so the UI can show which
 * ones took and which did not.
 */
export async function runTaskBatchWith(
  deps: TaskRunnerDeps,
  tasks: ParallelTask[],
  maxConcurrent: number,
  onProgress?: (outcome: TaskOutcome) => void,
): Promise<TaskOutcome[]> {
  const results: TaskOutcome[] = [];

  for (const wave of planTaskWaves(tasks, maxConcurrent)) {
    for (const task of wave) {
      const outcome: TaskOutcome = {
        title: task.title,
        sessionId: null,
        status: "failed",
        appliedModel: null,
        error: null,
      };
      try {
        const { id } = await deps.createSession(task.title);
        outcome.sessionId = id;

        let taskProjectPath: string | undefined;
        if (task.worktree) {
          if (!deps.createWorktree) throw new Error("worktree runner unavailable");
          const created = await deps.createWorktree(`${task.title}-${id.slice(0, 6)}`);
          outcome.worktreePath = created.path;
          taskProjectPath = created.path;
        }

        if (task.modelId) {
          try {
            await deps.setModel(id, task.modelId);
            outcome.appliedModel = task.modelId;
          } catch {
            // The task still runs, just on the default model.
          }
        }

        const conn = await deps.connect(id, taskProjectPath);
        if (!conn.ready) throw new Error(conn.error || "connect failed");

        await deps.send(task.prompt, id);
        outcome.status = "running";
      } catch (e) {
        outcome.error = e instanceof Error ? e.message : String(e);
      }
      results.push(outcome);
      onProgress?.(outcome);
    }
  }
  return results;
}
