// @vitest-environment happy-dom

import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { CacheChip } from "./CacheChip";
import type { UsagePayload } from "@/lib/cacheUsage";

afterEach(cleanup);

const labels = {
  title: "Cache",
  tipCold: "Cache barely paying off",
  tipWarming: "Cache warming up",
  tipGood: "Cache working well",
  prompt: "Prompt",
  cached: "Cached",
  output: "Output",
  cost: "Cost",
};

function payload(over: Partial<UsagePayload> = {}): UsagePayload {
  const zero = {
    input: 0,
    output: 0,
    cacheRead: 0,
    cacheWrite: 0,
    totalTokens: 0,
  };
  return {
    sessionId: "s1",
    turn: zero,
    total: {
      input: 2000,
      output: 500,
      cacheRead: 8000,
      cacheWrite: 0,
      totalTokens: 10_500,
      costTotal: 0.42,
    },
    cacheHitRate: 0.8,
    ...over,
  };
}

describe("CacheChip", () => {
  it("shows the measured rate", () => {
    render(<CacheChip usage={payload()} viewedSessionId="s1" labels={labels} />);
    expect(screen.getByText("80%")).toBeDefined();
  });

  it("hides another chat's figures instead of showing them here", () => {
    const { container } = render(
      <CacheChip usage={payload()} viewedSessionId="other" labels={labels} />,
    );
    expect(container.textContent).toBe("");
  });

  it("renders nothing before anything has been measured", () => {
    const { container } = render(<CacheChip usage={null} viewedSessionId="s1" labels={labels} />);
    expect(container.textContent).toBe("");
  });

  it("renders nothing when no prompt tokens were counted", () => {
    const { container } = render(
      <CacheChip
        usage={payload({ cacheHitRate: null })}
        viewedSessionId="s1"
        labels={labels}
      />,
    );
    expect(container.textContent).toBe("");
  });

  it("carries the breakdown for screen readers, not just the tooltip", () => {
    render(<CacheChip usage={payload()} viewedSessionId="s1" labels={labels} />);
    const label = screen.getByLabelText(/Cache 80%/);
    expect(label.getAttribute("aria-label")).toContain("Cached: 8k");
    expect(label.getAttribute("aria-label")).toContain("Cost: $0.42");
  });

  it("marks a cold cache differently from a good one", () => {
    const { container, rerender } = render(
      <CacheChip
        viewedSessionId="s1"
        usage={payload({
          cacheHitRate: 0,
          total: {
            input: 5000,
            output: 0,
            cacheRead: 0,
            cacheWrite: 0,
            totalTokens: 5000,
            costTotal: null,
          },
        })}
        labels={labels}
      />,
    );
    expect(container.querySelector(".cache-chip--cold")).not.toBeNull();

    rerender(<CacheChip usage={payload()} viewedSessionId="s1" labels={labels} />);
    expect(container.querySelector(".cache-chip--good")).not.toBeNull();
  });

  it("omits cost when the provider reported none", () => {
    render(
      <CacheChip
        viewedSessionId="s1"
        usage={payload({
          total: {
            input: 2000,
            output: 0,
            cacheRead: 8000,
            cacheWrite: 0,
            totalTokens: 10_000,
            costTotal: null,
          },
        })}
        labels={labels}
      />,
    );
    expect(screen.getByLabelText(/Cache/).getAttribute("aria-label")).not.toContain(
      "Cost",
    );
  });

  /**
   * The cold band tip says the prompt is being resent, which on a session's
   * first turn describes something unavoidable. Leading with it and appending
   * the explanation is how a healthy provider gets read as broken.
   */
  it("lets a note replace the alarming band tip rather than trail it", () => {
    const { unmount } = render(
      <CacheChip
        viewedSessionId="s1"
        usage={payload({ cacheHitRate: 0.01 })}
        labels={labels}
      />,
    );
    // Without a note the band tip is what explains the number.
    expect(screen.getByLabelText(/Cache/).getAttribute("aria-label")).toContain(
      "Cache barely paying off",
    );
    unmount();

    render(
      <CacheChip
        viewedSessionId="s1"
        usage={payload({ cacheHitRate: 0.01 })}
        breakHint="First turn of this chat"
        labels={labels}
      />,
    );
    const aria = screen.getByLabelText(/Cache/).getAttribute("aria-label") ?? "";
    expect(aria).toContain("First turn of this chat");
    expect(aria).not.toContain("Cache barely paying off");
    // The figures are still announced alongside it.
    expect(aria).toContain("Prompt");
  });
});
