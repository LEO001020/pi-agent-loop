// @vitest-environment happy-dom
//
// Per-file DOM environment: the pure-logic suites stay on `node`, which is
// faster, and only the tests that need a document pay for one.

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { WorkspaceSwitcher } from "./WorkspaceSwitcher";
import { WORKSPACES } from "@/lib/workspace";

afterEach(cleanup);

const labels = {
  code: "Code",
  pr: "Pull requests",
};

function renderSwitcher(over: Partial<Parameters<typeof WorkspaceSwitcher>[0]> = {}) {
  const onSelect = vi.fn();
  render(
    <WorkspaceSwitcher
      active="code"
      onSelect={onSelect}
      labels={labels}
      comingSoonSuffix="coming soon"
      {...over}
    />,
  );
  return { onSelect };
}

describe("WorkspaceSwitcher", () => {
  it("renders one tab per workspace", () => {
    renderSwitcher();
    expect(screen.getAllByRole("tab")).toHaveLength(WORKSPACES.length);
  });

  it("marks only the active workspace as selected", () => {
    renderSwitcher({ active: "pr" });
    const tabs = screen.getAllByRole("tab");
    const selected = tabs.filter(
      (t) => t.getAttribute("aria-selected") === "true",
    );
    expect(selected).toHaveLength(1);
    expect(selected[0]!).toHaveProperty("title", "Pull requests");
  });

  /**
   * Roving tabindex: a tablist should be one stop in the tab order, with the
   * arrows moving inside it. Three separate stops would make the sidebar
   * tedious to traverse by keyboard.
   */
  it("keeps exactly one tab in the tab order", () => {
    renderSwitcher({ active: "pr" });
    const reachable = screen
      .getAllByRole("tab")
      .filter((t) => t.getAttribute("tabindex") === "0");
    expect(reachable).toHaveLength(1);
  });

  it("gives every workspace a usable title", () => {
    renderSwitcher();
    expect(screen.getByTitle("Code")).toBeDefined();
    expect(screen.getByTitle("Pull requests")).toBeDefined();
  });

  /** The Design workspace was removed; nothing should still offer it. */
  it("offers no workspace beyond the ones it was given", () => {
    renderSwitcher();
    expect(screen.queryByTitle("Design")).toBeNull();
    expect(screen.getAllByRole("tab")).toHaveLength(Object.keys(labels).length);
  });

  it("reports the clicked workspace", () => {
    const { onSelect } = renderSwitcher();
    fireEvent.click(screen.getByTitle("Pull requests"));
    expect(onSelect).toHaveBeenCalledWith("pr");
  });

  it("moves along the list with the arrow keys", () => {
    const { onSelect } = renderSwitcher({ active: "code" });
    fireEvent.keyDown(screen.getByTitle("Code"), { key: "ArrowRight" });
    expect(onSelect).toHaveBeenCalledWith("pr");
  });

  it("wraps around at both ends rather than stopping", () => {
    const first = WORKSPACES[0]!.id;
    const last = WORKSPACES[WORKSPACES.length - 1]!.id;

    const a = renderSwitcher({ active: first });
    fireEvent.keyDown(screen.getByTitle("Code"), { key: "ArrowLeft" });
    expect(a.onSelect).toHaveBeenCalledWith(last);

    cleanup();

    const b = renderSwitcher({ active: last });
    fireEvent.keyDown(screen.getByTitle("Pull requests"), {
      key: "ArrowRight",
    });
    expect(b.onSelect).toHaveBeenCalledWith(first);
  });

  it("ignores keys that are not navigation", () => {
    const { onSelect } = renderSwitcher();
    fireEvent.keyDown(screen.getByTitle("Code"), { key: "a" });
    fireEvent.keyDown(screen.getByTitle("Code"), { key: "ArrowDown" });
    expect(onSelect).not.toHaveBeenCalled();
  });
});
