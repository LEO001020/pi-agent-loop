// @vitest-environment happy-dom

import { act, renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import * as api from "@/lib/api";
import {
  useWorktreeDialogs,
  type WorktreeDialogsDeps,
} from "./useWorktreeDialogs";

vi.mock("@/lib/api", () => ({
  isTauri: () => true,
  gitWorktreeAdd: vi.fn(),
  gitWorktreeGc: vi.fn(),
}));

const mocked = vi.mocked(api);

function deps(over: Partial<WorktreeDialogsDeps> = {}): WorktreeDialogsDeps {
  return {
    projectPath: "/repo",
    worktrees: [],
    tr: (key, vars) => (vars ? `${key}:${JSON.stringify(vars)}` : key),
    showToast: vi.fn(),
    refreshWorktrees: vi.fn().mockResolvedValue(undefined),
    onCreated: vi.fn().mockResolvedValue(undefined),
    ...over,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  mocked.gitWorktreeGc.mockResolvedValue({ prunedCount: 0 } as never);
  mocked.gitWorktreeAdd.mockResolvedValue({
    path: "/repo-feat",
    name: "feat",
    branch: "feat",
  } as never);
});

describe("create dialog", () => {
  it("opens clean, so a previous error never greets the next use", () => {
    const { result } = renderHook(() => useWorktreeDialogs(deps()));
    act(() => result.current.create.setName("old"));
    act(() => result.current.create.openDialog());

    expect(result.current.create.open).toBe(true);
    expect(result.current.create.name).toBe("");
    expect(result.current.create.error).toBeNull();
    expect(result.current.create.busy).toBe(false);
  });

  it("refuses an empty name without calling git", async () => {
    const { result } = renderHook(() => useWorktreeDialogs(deps()));
    act(() => result.current.create.openDialog());
    act(() => result.current.create.setName("   "));

    await act(async () => {
      await result.current.create.submit();
    });
    expect(result.current.create.error).toContain("worktreeNameRequired");
    expect(mocked.gitWorktreeAdd).not.toHaveBeenCalled();
  });

  it("creates, refreshes, then hands the result to the shell", async () => {
    const d = deps();
    const { result } = renderHook(() => useWorktreeDialogs(d));
    act(() => result.current.create.openDialog({ startNewChat: true }));
    act(() => result.current.create.setName("feat"));

    await act(async () => {
      await result.current.create.submit();
    });

    expect(mocked.gitWorktreeAdd).toHaveBeenCalledWith("/repo", "feat", null);
    expect(d.refreshWorktrees).toHaveBeenCalled();
    expect(d.onCreated).toHaveBeenCalledWith({
      path: "/repo-feat",
      name: "feat",
      branch: "feat",
      startChat: true,
    });
    expect(result.current.create.open).toBe(false);
  });

  it("passes a start point only when one was given", async () => {
    const { result } = renderHook(() => useWorktreeDialogs(deps()));
    act(() => result.current.create.openDialog());
    act(() => result.current.create.setName("feat"));
    act(() => result.current.create.setStartPoint("  main  "));

    await act(async () => {
      await result.current.create.submit();
    });
    expect(mocked.gitWorktreeAdd).toHaveBeenCalledWith("/repo", "feat", "main");
  });

  it("labels a detached worktree rather than leaving the branch blank", async () => {
    mocked.gitWorktreeAdd.mockResolvedValue({
      path: "/repo-x",
      name: "x",
      branch: "   ",
    } as never);
    const d = deps();
    const { result } = renderHook(() => useWorktreeDialogs(d));
    act(() => result.current.create.openDialog());
    act(() => result.current.create.setName("x"));

    await act(async () => {
      await result.current.create.submit();
    });
    expect(vi.mocked(d.onCreated).mock.calls[0]![0]!.branch).toBe("x");
  });

  it("keeps the dialog open and shows why when git fails", async () => {
    mocked.gitWorktreeAdd.mockRejectedValue(new Error("already exists"));
    const d = deps();
    const { result } = renderHook(() => useWorktreeDialogs(d));
    act(() => result.current.create.openDialog());
    act(() => result.current.create.setName("feat"));

    await act(async () => {
      await result.current.create.submit();
    });
    expect(result.current.create.error).toContain("already exists");
    expect(result.current.create.busy).toBe(false);
    expect(d.onCreated).not.toHaveBeenCalled();
  });

  it("previews the path as a sibling of the main worktree, not the open one", () => {
    const { result } = renderHook(() =>
      useWorktreeDialogs(
        deps({
          projectPath: "/repo-feat",
          worktrees: [
            { path: "/repo", name: "repo", branch: "main", isMain: true },
            { path: "/repo-feat", name: "feat", branch: "feat" },
          ] as never,
        }),
      ),
    );
    act(() => result.current.create.setName("next"));
    // Sibling of /repo — chaining off the checked-out worktree would nest them.
    expect(result.current.create.previewPath).toContain("repo");
    expect(result.current.create.previewPath).not.toContain("repo-feat-");
  });

  it("has no preview until a name is typed", () => {
    const { result } = renderHook(() => useWorktreeDialogs(deps()));
    expect(result.current.create.previewPath).toBeNull();
  });

  it("clears a stale error as soon as the user edits a field", async () => {
    const { result } = renderHook(() => useWorktreeDialogs(deps()));
    act(() => result.current.create.openDialog());
    await act(async () => {
      await result.current.create.submit();
    });
    expect(result.current.create.error).toBeTruthy();

    act(() => result.current.create.setName("f"));
    expect(result.current.create.error).toBeNull();
  });

  it("close() resets, so the next open is not greeted by the last failure", async () => {
    const { result } = renderHook(() => useWorktreeDialogs(deps()));
    act(() => result.current.create.openDialog());
    await act(async () => {
      await result.current.create.submit();
    });

    act(() => result.current.create.close());
    expect(result.current.create.open).toBe(false);
    expect(result.current.create.error).toBeNull();
  });
});

describe("prune dialog", () => {
  it("runs a dry run when opened, so the count shown is real", async () => {
    mocked.gitWorktreeGc.mockResolvedValue({ prunedCount: 2 } as never);
    const { result } = renderHook(() => useWorktreeDialogs(deps()));

    act(() => result.current.gc.openDialog());
    await waitFor(() => expect(result.current.gc.preview).not.toBeNull());
    expect(mocked.gitWorktreeGc).toHaveBeenCalledWith("/repo", true, false);
  });

  it("re-previews when force changes, because the answer changes", async () => {
    const { result } = renderHook(() => useWorktreeDialogs(deps()));
    act(() => result.current.gc.openDialog());
    await waitFor(() => expect(mocked.gitWorktreeGc).toHaveBeenCalledTimes(1));

    act(() => result.current.gc.setForce(true));
    await waitFor(() =>
      expect(mocked.gitWorktreeGc).toHaveBeenLastCalledWith("/repo", true, true),
    );
  });

  it("prunes for real, then refreshes and reports the count", async () => {
    const d = deps();
    const { result } = renderHook(() => useWorktreeDialogs(d));
    act(() => result.current.gc.openDialog());
    await waitFor(() => expect(result.current.gc.preview).not.toBeNull());

    mocked.gitWorktreeGc.mockResolvedValue({ prunedCount: 3 } as never);
    await act(async () => {
      await result.current.gc.submit();
    });

    expect(mocked.gitWorktreeGc).toHaveBeenLastCalledWith("/repo", false, false);
    expect(d.refreshWorktrees).toHaveBeenCalled();
    expect(result.current.gc.open).toBe(false);
    expect(vi.mocked(d.showToast).mock.calls.at(-1)![0]).toContain(
      "worktreeGcDone",
    );
  });

  it("says nothing was stale rather than claiming a cleanup", async () => {
    const d = deps();
    const { result } = renderHook(() => useWorktreeDialogs(d));
    act(() => result.current.gc.openDialog());

    mocked.gitWorktreeGc.mockResolvedValue({ prunedCount: 0 } as never);
    await act(async () => {
      await result.current.gc.submit();
    });
    expect(vi.mocked(d.showToast).mock.calls.at(-1)![0]).toContain(
      "worktreeGcDoneNone",
    );
  });

  it("keeps the dialog open and shows why when pruning fails", async () => {
    const d = deps();
    const { result } = renderHook(() => useWorktreeDialogs(d));
    act(() => result.current.gc.openDialog());

    mocked.gitWorktreeGc.mockRejectedValue(new Error("locked"));
    await act(async () => {
      await result.current.gc.submit();
    });
    expect(result.current.gc.open).toBe(true);
    expect(result.current.gc.error).toContain("locked");
    expect(d.refreshWorktrees).not.toHaveBeenCalled();
  });

  it("close() drops the preview and the force flag together", async () => {
    mocked.gitWorktreeGc.mockResolvedValue({ prunedCount: 4 } as never);
    const { result } = renderHook(() => useWorktreeDialogs(deps()));
    act(() => result.current.gc.openDialog());
    act(() => result.current.gc.setForce(true));
    await waitFor(() => expect(result.current.gc.preview).not.toBeNull());

    act(() => result.current.gc.close());
    expect(result.current.gc.open).toBe(false);
    expect(result.current.gc.preview).toBeNull();
    expect(result.current.gc.force).toBe(false);
  });

  it("does nothing at all without a project", async () => {
    const { result } = renderHook(() =>
      useWorktreeDialogs(deps({ projectPath: null })),
    );
    act(() => result.current.gc.openDialog());
    await act(async () => {
      await result.current.gc.submit();
    });
    expect(mocked.gitWorktreeGc).not.toHaveBeenCalled();
  });
});
