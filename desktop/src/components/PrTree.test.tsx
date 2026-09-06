// @vitest-environment happy-dom

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { PrTree, type PrRepoState } from "./PrTree";
import type { GhPullRequest } from "@/lib/api";

afterEach(cleanup);

const labels = {
  repos: "Repositories",
  addRepo: "Follow a repository",
  removeRepo: "Stop following",
  empty: "No repositories yet. Click + to follow one.",
  noPulls: "No open pull requests.",
  loading: "Loading pull requests…",
  draft: "Draft",
};

function pull(number: number, over: Partial<GhPullRequest> = {}): GhPullRequest {
  return {
    number,
    title: `Pull ${number}`,
    author: "someone",
    baseRef: "main",
    headRef: `feat/${number}`,
    isDraft: false,
    url: `https://github.com/o/r/pull/${number}`,
    ...over,
  };
}

function repo(over: Partial<PrRepoState> = {}): PrRepoState {
  return {
    slug: "o/r",
    expanded: false,
    loading: false,
    pulls: null,
    error: null,
    ...over,
  };
}

function renderTree(
  repos: PrRepoState[],
  over: Partial<Parameters<typeof PrTree>[0]> = {},
) {
  const handlers = {
    onToggle: vi.fn(),
    onAddRepo: vi.fn(),
    onRemoveRepo: vi.fn(),
    onOpenPr: vi.fn(),
  };
  render(
    <PrTree repos={repos} activePr={null} labels={labels} {...handlers} {...over} />,
  );
  return handlers;
}

describe("PrTree", () => {
  it("explains how to start when nothing is followed", () => {
    renderTree([]);
    expect(screen.getByText(labels.empty)).toBeDefined();
  });

  it("lists followed repositories collapsed", () => {
    renderTree([repo({ slug: "a/one" }), repo({ slug: "b/two" })]);
    expect(screen.getByText("a/one")).toBeDefined();
    expect(screen.getByText("b/two")).toBeDefined();
    // Collapsed: no pull request rows yet.
    expect(screen.queryByText("Pull 1")).toBeNull();
  });

  it("reports the repository the user expanded", () => {
    const h = renderTree([repo({ slug: "a/one" })]);
    fireEvent.click(screen.getByText("a/one"));
    expect(h.onToggle).toHaveBeenCalledWith("a/one");
  });

  it("shows pull requests once expanded", () => {
    renderTree([repo({ expanded: true, pulls: [pull(7), pull(8)] })]);
    expect(screen.getByText("Pull 7")).toBeDefined();
    expect(screen.getByText("#8")).toBeDefined();
  });

  it("marks drafts, so a sweep result reads correctly", () => {
    renderTree([
      repo({ expanded: true, pulls: [pull(1, { isDraft: true }), pull(2)] }),
    ]);
    expect(screen.getAllByText(labels.draft)).toHaveLength(1);
  });

  /** Three states share one slot; each must be distinguishable. */
  it("separates loading, error and genuinely empty", () => {
    const { rerender } = render(
      <PrTree
        repos={[repo({ expanded: true, loading: true })]}
        activePr={null}
        labels={labels}
        onToggle={vi.fn()}
        onAddRepo={vi.fn()}
        onRemoveRepo={vi.fn()}
        onOpenPr={vi.fn()}
      />,
    );
    expect(screen.getByText(labels.loading)).toBeDefined();

    const props = {
      activePr: null,
      labels,
      onToggle: vi.fn(),
      onAddRepo: vi.fn(),
      onRemoveRepo: vi.fn(),
      onOpenPr: vi.fn(),
    };
    rerender(
      <PrTree
        repos={[repo({ expanded: true, pulls: [], error: "gh: not found" })]}
        {...props}
      />,
    );
    expect(screen.getByText("gh: not found")).toBeDefined();
    expect(screen.queryByText(labels.noPulls)).toBeNull();

    rerender(
      <PrTree repos={[repo({ expanded: true, pulls: [] })]} {...props} />,
    );
    expect(screen.getByText(labels.noPulls)).toBeDefined();
  });

  it("counts open pull requests on the repository row", () => {
    renderTree([repo({ expanded: true, pulls: [pull(1), pull(2), pull(3)] })]);
    expect(screen.getByText("3")).toBeDefined();
  });

  it("reports the pull request to review with its repository", () => {
    const h = renderTree([
      repo({ slug: "a/one", expanded: true, pulls: [pull(42)] }),
    ]);
    fireEvent.click(screen.getByText("Pull 42"));
    expect(h.onOpenPr).toHaveBeenCalledWith(
      "a/one",
      expect.objectContaining({ number: 42 }),
    );
  });

  it("names the repository in the remove control, not just the icon", () => {
    const h = renderTree([repo({ slug: "a/one" })]);
    fireEvent.click(
      screen.getByLabelText(`${labels.removeRepo} a/one`),
    );
    expect(h.onRemoveRepo).toHaveBeenCalledWith("a/one");
  });

  it("offers a way to follow a repository", () => {
    const h = renderTree([]);
    fireEvent.click(screen.getByLabelText(labels.addRepo));
    expect(h.onAddRepo).toHaveBeenCalled();
  });
});
