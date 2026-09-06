// @vitest-environment happy-dom

import { act, renderHook } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { createT } from "@/i18n";
import { usePrActions, type PrActionsDeps } from "./usePrActions";

function deps(over: Partial<PrActionsDeps> = {}): PrActionsDeps {
  return {
    activeProjectPath: "/repo",
    reviewModelId: null,
    reviewRoleModelId: null,
    availableModels: [],
    runBatch: vi.fn().mockResolvedValue(undefined),
    openDialog: vi.fn(),
    startReviewChat: vi.fn().mockResolvedValue(undefined),
    setComparisonOpen: vi.fn(),
    showToast: vi.fn(),
    tr: createT("en"),
    ...over,
  };
}

describe("usePrActions", () => {
  it("opens an explicit inline-comment draft before publishing", () => {
    const openDialog = vi.fn();
    const d = deps({ openDialog });
    const { result } = renderHook(() => usePrActions(d));

    act(() => result.current.postPrComment("owner/repo", {
      number: 42,
      title: "Fix",
      author: "owner",
      baseRef: "main",
      headRef: "fix",
      isDraft: false,
      url: "https://example.test/pr/42",
    }));

    expect(openDialog).toHaveBeenCalledTimes(1);
    expect(openDialog.mock.calls[0]![0].kind).toBe("prompt");
  });

  it("reports a missing project before opening the review prompt", () => {
    const showToast = vi.fn();
    const d = deps({ activeProjectPath: null, showToast });
    const { result } = renderHook(() => usePrActions(d));

    act(() => result.current.openReviewPrDialog());

    expect(showToast).toHaveBeenCalledWith(createT("en")("reviewPr.noProject"));
  });
});
