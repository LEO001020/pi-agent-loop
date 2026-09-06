// @vitest-environment happy-dom

import { act, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as api from "@/lib/api";
import { PR_REPOS_STORAGE_KEY } from "@/lib/workspace";
import { usePrWorkspace, type PrWorkspaceDeps } from "./usePrWorkspace";

vi.mock("@/lib/api", () => ({
  ghPrList: vi.fn(),
  ghPrDiff: vi.fn(),
  ghRepoList: vi.fn(),
  ghAvailable: vi.fn(),
}));

const mocked = vi.mocked(api);

function deps(over: Partial<PrWorkspaceDeps> = {}): PrWorkspaceDeps {
  return {
    tr: (key, vars) => (vars ? `${key}:${JSON.stringify(vars)}` : key),
    showToast: vi.fn(),
    openDialog: vi.fn(),
    startReviewChat: vi.fn().mockResolvedValue(undefined),
    ...over,
  };
}

beforeEach(() => {
  localStorage.clear();
  vi.clearAllMocks();
  mocked.ghPrList.mockResolvedValue([]);
});

afterEach(() => localStorage.clear());

describe("usePrWorkspace", () => {
  it("starts from the persisted selection, collapsed and unloaded", () => {
    localStorage.setItem(
      PR_REPOS_STORAGE_KEY,
      JSON.stringify(["a/one", "b/two"]),
    );
    const { result } = renderHook(() => usePrWorkspace(deps()));

    expect(result.current.repos.map((r) => r.slug)).toEqual(["a/one", "b/two"]);
    expect(result.current.repos.every((r) => !r.expanded)).toBe(true);
    expect(result.current.repos.every((r) => r.pulls === null)).toBe(true);
    expect(mocked.ghPrList).not.toHaveBeenCalled();
  });

  /**
   * Regression: expansion used to run two sequential setState calls, the second
   * reading state the first had not committed, so the fetch decision was made
   * against stale data.
   */
  it("loads pull requests once, on first expand", async () => {
    localStorage.setItem(PR_REPOS_STORAGE_KEY, JSON.stringify(["a/one"]));
    mocked.ghPrList.mockResolvedValue([
      {
        number: 1,
        title: "t",
        author: "a",
        baseRef: "main",
        headRef: "h",
        isDraft: false,
        url: "u",
      },
    ]);
    const { result } = renderHook(() => usePrWorkspace(deps()));

    act(() => result.current.toggleRepo("a/one"));
    await waitFor(() =>
      expect(result.current.repos[0]!.pulls).toHaveLength(1),
    );
    expect(mocked.ghPrList).toHaveBeenCalledTimes(1);
  });

  it("does not refetch when collapsing and reopening", async () => {
    localStorage.setItem(PR_REPOS_STORAGE_KEY, JSON.stringify(["a/one"]));
    const { result } = renderHook(() => usePrWorkspace(deps()));

    act(() => result.current.toggleRepo("a/one"));
    await waitFor(() => expect(result.current.repos[0]!.pulls).not.toBeNull());

    act(() => result.current.toggleRepo("a/one")); // collapse
    act(() => result.current.toggleRepo("a/one")); // reopen
    expect(mocked.ghPrList).toHaveBeenCalledTimes(1);
  });

  it("surfaces a failed load instead of showing an empty repository", async () => {
    localStorage.setItem(PR_REPOS_STORAGE_KEY, JSON.stringify(["a/one"]));
    mocked.ghPrList.mockRejectedValue(new Error("gh: not authenticated"));
    const { result } = renderHook(() => usePrWorkspace(deps()));

    act(() => result.current.toggleRepo("a/one"));
    await waitFor(() => expect(result.current.repos[0]!.error).toBeTruthy());
    expect(result.current.repos[0]!.error).toContain("not authenticated");
    expect(result.current.repos[0]!.loading).toBe(false);
  });

  it("explains what is missing before asking for a repository", async () => {
    const showToast = vi.fn();
    mocked.ghAvailable.mockResolvedValue({
      installed: false,
      authenticated: false,
    });
    const d = deps({ showToast });
    const { result } = renderHook(() => usePrWorkspace(d));

    act(() => result.current.addRepo());
    await waitFor(() => expect(showToast).toHaveBeenCalled());
    expect(showToast.mock.calls[0]![0]).toContain("ghMissing");
    expect(d.openDialog).not.toHaveBeenCalled();
  });

  it("asks for confirmation before dropping a repository", () => {
    localStorage.setItem(PR_REPOS_STORAGE_KEY, JSON.stringify(["a/one"]));
    const openDialog = vi.fn();
    const { result } = renderHook(() => usePrWorkspace(deps({ openDialog })));

    act(() => result.current.removeRepo("a/one"));

    const dialog = openDialog.mock.calls[0]![0];
    expect(dialog.kind).toBe("confirm");
    expect(dialog.danger).toBe(true);
    // Nothing goes until the user confirms.
    expect(result.current.repos).toHaveLength(1);

    act(() => dialog.onConfirm());
    expect(result.current.repos).toHaveLength(0);
    expect(localStorage.getItem(PR_REPOS_STORAGE_KEY)).toBe("[]");
  });

  it("opens a review chat seeded with the pull request diff", async () => {
    const startReviewChat = vi.fn().mockResolvedValue(undefined);
    mocked.ghPrDiff.mockResolvedValue({
      number: 42,
      title: "Fix it",
      body: "",
      baseRef: "main",
      headRef: "fix",
      url: "u",
      diff: "diff --git a/x b/x",
      truncated: false,
      changedFiles: 2,
    });
    const { result } = renderHook(() =>
      usePrWorkspace(deps({ startReviewChat })),
    );

    act(() =>
      result.current.openReview("a/one", {
        number: 42,
        title: "Fix it",
        author: "a",
        baseRef: "main",
        headRef: "fix",
        isDraft: false,
        url: "u",
      }),
    );

    await waitFor(() => expect(startReviewChat).toHaveBeenCalled());
    const seed = startReviewChat.mock.calls[0]![0] as string;
    expect(seed).toContain("#42");
    expect(seed).toContain("```diff");
    expect(result.current.activePr).toBe("a/one#42");
  });

  it("reports a diff that could not be fetched", async () => {
    const showToast = vi.fn();
    const startReviewChat = vi.fn();
    mocked.ghPrDiff.mockRejectedValue(new Error("boom"));
    const { result } = renderHook(() =>
      usePrWorkspace(deps({ showToast, startReviewChat })),
    );

    act(() =>
      result.current.openReview("a/one", {
        number: 1,
        title: "t",
        author: "a",
        baseRef: "main",
        headRef: "h",
        isDraft: false,
        url: "u",
      }),
    );

    await waitFor(() =>
      expect(
        showToast.mock.calls.some((c) => String(c[0]).includes("failed")),
      ).toBe(true),
    );
    expect(startReviewChat).not.toHaveBeenCalled();
  });
});
