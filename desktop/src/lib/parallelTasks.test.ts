import { describe, expect, it } from "vitest";
import {
  TASK_BATCH_FENCE_LANG,
  hasTaskBatchFence,
  looksLikeParallelIntent,
  parseTaskBatch,
  planTaskWaves,
  resolveTaskModel,
  runTaskBatchWith,
  taskBatchAgentPrefix,
  wrapTaskBatchAgentText,
  type ParallelTask,
  type TaskRunnerDeps,
} from "./parallelTasks";

const MODELS = ["auto", "grok-4.5", "gpt-5.6", "gpt-5.6-luna", "claude-opus-5"];

function fence(body: unknown): string {
  return "```" + TASK_BATCH_FENCE_LANG + "\n" + JSON.stringify(body) + "\n```";
}

describe("resolveTaskModel", () => {
  it("matches an exact id", () => {
    expect(resolveTaskModel("grok-4.5", MODELS)).toBe("grok-4.5");
  });

  it("matches how people actually type model names", () => {
    expect(resolveTaskModel("grok 4.5", MODELS)).toBe("grok-4.5");
    expect(resolveTaskModel("GROK4.5", MODELS)).toBe("grok-4.5");
    expect(resolveTaskModel("Claude Opus 5", MODELS)).toBe("claude-opus-5");
  });

  it("prefers the longest match so a prefix does not shadow a variant", () => {
    expect(resolveTaskModel("gpt 5.6 luna", MODELS)).toBe("gpt-5.6-luna");
  });

  it("returns null when nothing matches, so spawn keeps its default", () => {
    expect(resolveTaskModel("llama-9", MODELS)).toBeNull();
    expect(resolveTaskModel("", MODELS)).toBeNull();
    expect(resolveTaskModel(null, MODELS)).toBeNull();
    expect(resolveTaskModel("!!!", MODELS)).toBeNull();
  });

  it("returns null against an empty catalog rather than echoing the input", () => {
    expect(resolveTaskModel("grok-4.5", [])).toBeNull();
  });

  it("resolves a named role before fuzzy model matching", () => {
    expect(
      resolveTaskModel("review", MODELS, { review: "grok-4.5" }),
    ).toBe("grok-4.5");
  });
});

describe("parseTaskBatch", () => {
  it("reads tasks and strips the fence from the visible text", () => {
    const text =
      "Running these now.\n\n" +
      fence({
        tasks: [
          { title: "Review 233311", prompt: "Review PR 233311", model: "grok 4.5" },
          { title: "Review 2223", prompt: "Review PR 2223", model: "gpt 5.6 luna" },
        ],
      });
    const { tasks, cleanText } = parseTaskBatch(text, MODELS);
    expect(tasks).toHaveLength(2);
    expect(tasks[0]!.modelId).toBe("grok-4.5");
    expect(tasks[1]!.modelId).toBe("gpt-5.6-luna");
    expect(cleanText).toBe("Running these now.");
    expect(cleanText).not.toContain("```");
  });

  it("keeps the task when the model is unknown, dropping only the assignment", () => {
    const { tasks } = parseTaskBatch(
      fence({ tasks: [{ title: "t", prompt: "do it", model: "nope-9" }] }),
      MODELS,
    );
    expect(tasks).toHaveLength(1);
    expect(tasks[0]!.modelId).toBeNull();
  });

  it("drops tasks with no prompt rather than launching them empty", () => {
    const { tasks } = parseTaskBatch(
      fence({
        tasks: [
          { title: "empty", prompt: "   " },
          { title: "real", prompt: "do it" },
        ],
      }),
      MODELS,
    );
    expect(tasks).toHaveLength(1);
    expect(tasks[0]!.title).toBe("real");
  });

  it("falls back to a title derived from the prompt", () => {
    const { tasks } = parseTaskBatch(
      fence({ tasks: [{ prompt: "upgrade every dependency in the workspace" }] }),
      MODELS,
    );
    expect(tasks[0]!.title.length).toBeGreaterThan(0);
    expect(tasks[0]!.title.length).toBeLessThanOrEqual(40);
  });

  it("ignores malformed or empty payloads", () => {
    expect(parseTaskBatch("", MODELS).tasks).toEqual([]);
    expect(parseTaskBatch("no fence here", MODELS).tasks).toEqual([]);
    expect(
      parseTaskBatch("```" + TASK_BATCH_FENCE_LANG + "\n{oops\n```", MODELS)
        .tasks,
    ).toEqual([]);
    expect(parseTaskBatch(fence({ tasks: "nope" }), MODELS).tasks).toEqual([]);
    expect(parseTaskBatch(fence({}), MODELS).tasks).toEqual([]);
  });

  it("detects a fence for the streaming guard", () => {
    expect(hasTaskBatchFence(fence({ tasks: [] }))).toBe(true);
    expect(hasTaskBatchFence("plain reply")).toBe(false);
  });
});

describe("planTaskWaves", () => {
  const tasks = (n: number): ParallelTask[] =>
    Array.from({ length: n }, (_, i) => ({
      title: `t${i}`,
      prompt: `p${i}`,
      modelId: null,
    }));

  it("fills waves up to the process cap", () => {
    expect(planTaskWaves(tasks(5), 3).map((w) => w.length)).toEqual([3, 2]);
    expect(planTaskWaves(tasks(3), 3)).toHaveLength(1);
  });

  it("never returns an empty or zero-sized wave", () => {
    expect(planTaskWaves(tasks(2), 0).map((w) => w.length)).toEqual([1, 1]);
    expect(planTaskWaves(tasks(2), -4).map((w) => w.length)).toEqual([1, 1]);
    expect(planTaskWaves([], 3)).toEqual([]);
  });

  it("loses no task across waves", () => {
    const all = tasks(7);
    expect(planTaskWaves(all, 3).flat()).toEqual(all);
  });
});

describe("looksLikeParallelIntent", () => {
  it("spots explicit parallel phrasing", () => {
    expect(looksLikeParallelIntent("run these in parallel")).toBe(true);
    expect(looksLikeParallelIntent("do both at once")).toBe(true);
  });

  it("spots two numbered tasks with different models", () => {
    expect(
      looksLikeParallelIntent(
        "use grok 4.5 for task 233311 and use gpt 5.6 for task 2223",
      ),
    ).toBe(true);
  });

  it("does not fire on ordinary single requests", () => {
    expect(looksLikeParallelIntent("fix the login bug")).toBe(false);
    expect(looksLikeParallelIntent("")).toBe(false);
    expect(looksLikeParallelIntent("review task 12")).toBe(false);
  });
});

describe("agent prefix", () => {
  it("carries the fence language and forbids leaking the block", () => {
    const p = taskBatchAgentPrefix();
    expect(p).toContain(TASK_BATCH_FENCE_LANG);
    expect(p.toLowerCase()).toContain("never quote this block");
  });

  it("keeps the user text under a labelled heading", () => {
    const w = wrapTaskBatchAgentText("  two things please  ");
    expect(w).toContain("User request:");
    expect(w).toContain("two things please");
  });
});

describe("runTaskBatchWith", () => {
  type Call = string;

  function fakeDeps(over: Partial<TaskRunnerDeps> = {}) {
    const calls: Call[] = [];
    let n = 0;
    const deps: TaskRunnerDeps = {
      createSession: async (title) => {
        calls.push(`create:${title}`);
        return { id: `s${++n}` };
      },
      setModel: async (id, model) => {
        calls.push(`model:${id}=${model}`);
      },
      connect: async (id) => {
        calls.push(`connect:${id}`);
        return { ready: true };
      },
      send: async (prompt, id) => {
        calls.push(`send:${id}:${prompt}`);
      },
      ...over,
    };
    return { deps, calls };
  }

  const task = (title: string, modelId: string | null = null): ParallelTask => ({
    title,
    prompt: `do ${title}`,
    modelId,
  });

  it("creates, models, connects and sends each task in order", async () => {
    const { deps, calls } = fakeDeps();
    const out = await runTaskBatchWith(deps, [task("a", "grok-4.5")], 3);

    expect(calls).toEqual([
      "create:a",
      "model:s1=grok-4.5",
      "connect:s1",
      "send:s1:do a",
    ]);
    expect(out).toEqual([
      {
        title: "a",
        sessionId: "s1",
        status: "running",
        appliedModel: "grok-4.5",
        error: null,
      },
    ]);
  });

  it("skips the model step when the task did not name one", async () => {
    const { deps, calls } = fakeDeps();
    await runTaskBatchWith(deps, [task("a")], 3);
    expect(calls.some((c) => c.startsWith("model:"))).toBe(false);
  });

  it("gives every task its own model", async () => {
    const { deps, calls } = fakeDeps();
    await runTaskBatchWith(
      deps,
      [task("a", "grok-4.5"), task("b", "gpt-5.6-luna")],
      3,
    );
    expect(calls).toContain("model:s1=grok-4.5");
    expect(calls).toContain("model:s2=gpt-5.6-luna");
  });

  it("runs the task anyway when setting the model fails", async () => {
    const { deps, calls } = fakeDeps({
      setModel: async () => {
        throw new Error("prefs unavailable");
      },
    });
    const out = await runTaskBatchWith(deps, [task("a", "grok-4.5")], 3);
    expect(out[0]!.status).toBe("running");
    expect(out[0]!.appliedModel).toBeNull();
    expect(calls).toContain("send:s1:do a");
  });

  it("reports a connect that never became ready", async () => {
    const { deps, calls } = fakeDeps({
      connect: async () => ({ ready: false, error: "AGENT_CRASHED" }),
    });
    const out = await runTaskBatchWith(deps, [task("a")], 3);
    expect(out[0]!.status).toBe("failed");
    expect(out[0]!.error).toBe("AGENT_CRASHED");
    expect(calls.some((c) => c.startsWith("send:"))).toBe(false);
  });

  it("keeps going after one task fails — a batch is not a transaction", async () => {
    let attempt = 0;
    const { deps } = fakeDeps({
      createSession: async () => {
        attempt += 1;
        if (attempt === 1) throw new Error("store locked");
        return { id: `s${attempt}` };
      },
    });
    const out = await runTaskBatchWith(deps, [task("a"), task("b")], 3);
    expect(out.map((o) => o.status)).toEqual(["failed", "running"]);
    expect(out[0]!.error).toBe("store locked");
  });

  it("respects the process cap across waves without losing a task", async () => {
    const { deps, calls } = fakeDeps();
    const tasks = [task("a"), task("b"), task("c"), task("d")];
    const out = await runTaskBatchWith(deps, tasks, 2);
    expect(out).toHaveLength(4);
    expect(out.every((o) => o.status === "running")).toBe(true);
    expect(calls.filter((c) => c.startsWith("create:"))).toEqual([
      "create:a",
      "create:b",
      "create:c",
      "create:d",
    ]);
  });

  it("reports progress as each task settles", async () => {
    const { deps } = fakeDeps();
    const seen: string[] = [];
    await runTaskBatchWith(deps, [task("a"), task("b")], 3, (o) =>
      seen.push(`${o.title}:${o.status}`),
    );
    expect(seen).toEqual(["a:running", "b:running"]);
  });

  it("does nothing for an empty batch", async () => {
    const { deps, calls } = fakeDeps();
    expect(await runTaskBatchWith(deps, [], 3)).toEqual([]);
    expect(calls).toEqual([]);
  });

  it("creates an isolated worktree and connects the task to it", async () => {
    const { deps, calls } = fakeDeps({
      createWorktree: async (name) => {
        calls.push(`worktree:${name}`);
        return { path: "/repo-candidate", branch: "pi/candidate" };
      },
      connect: async (id, projectPath) => {
        calls.push(`connect:${id}:${projectPath}`);
        return { ready: true };
      },
    });
    const out = await runTaskBatchWith(
      deps,
      [{ ...task("review", "grok-4.5"), worktree: true }],
      2,
    );
    expect(out[0]?.worktreePath).toBe("/repo-candidate");
    expect(calls).toContain("connect:s1:/repo-candidate");
  });
});
