// @vitest-environment happy-dom

import { act, renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import * as api from "@/lib/api";
import { useContentSearch } from "./useContentSearch";

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("useContentSearch", () => {
  it("debounces journal queries and ignores stale results", async () => {
    vi.useFakeTimers();
    const search = vi.spyOn(api, "sessionsSearch");
    search
      .mockResolvedValueOnce([
        {
          id: "old",
          title: "Old",
          projectId: null,
          snippet: "old",
          matchCount: 1,
          updatedAt: "2026-08-03",
          archived: false,
        },
      ])
      .mockResolvedValueOnce([
        {
          id: "new",
          title: "New",
          projectId: null,
          snippet: "new",
          matchCount: 2,
          updatedAt: "2026-08-03",
          archived: false,
        },
      ]);
    const { result, rerender } = renderHook(
      ({ query }) => useContentSearch({ showSearch: true, searchQuery: query, debounceMs: 10 }),
      { initialProps: { query: "old" } },
    );

    await act(async () => {
      vi.advanceTimersByTime(10);
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(search).toHaveBeenCalledWith("old", 20);
    act(() => rerender({ query: "new" }));
    await act(async () => {
      vi.advanceTimersByTime(10);
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(search).toHaveBeenCalledWith("new", 20);
    expect(result.current.contentSearchHits[0]?.id).toBe("new");
  });
});
