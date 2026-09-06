import { describe, expect, it } from "vitest";
import {
  buildUnifiedDiff,
  isEditToolKind,
  mergeSessionChange,
  normalizePath,
  pathBaseName,
  pathRelativeToProject,
  sessionChangesFromMessages,
  type SessionFileChange,
} from "./sessionChanges";
import type { ChatMessage } from "./session";

describe("normalizePath", () => {
  it("unifies separators and strips trailing slash", () => {
    expect(normalizePath("a\\b\\c\\")).toBe("a/b/c");
    expect(normalizePath("/tmp/foo/")).toBe("/tmp/foo");
    expect(normalizePath("/")).toBe("/");
  });

  it("collapses duplicate slashes", () => {
    expect(normalizePath("/tmp//foo///bar")).toBe("/tmp/foo/bar");
  });

  it("trims whitespace", () => {
    expect(normalizePath("  /x/y  ")).toBe("/x/y");
  });
});

describe("pathBaseName / relative", () => {
  it("basename", () => {
    expect(pathBaseName("/a/b/c.ts")).toBe("c.ts");
    expect(pathBaseName("c.ts")).toBe("c.ts");
  });

  it("relative under project", () => {
    expect(
      pathRelativeToProject("/Users/me/proj/src/a.ts", "/Users/me/proj"),
    ).toBe("src/a.ts");
    expect(pathRelativeToProject("/other/x", "/Users/me/proj")).toBe(
      "/other/x",
    );
  });
});

describe("isEditToolKind", () => {
  it("recognizes write / replace / edit family", () => {
    expect(isEditToolKind("write")).toBe(true);
    expect(isEditToolKind("search_replace")).toBe(true);
    expect(isEditToolKind("str_replace")).toBe(true);
    expect(isEditToolKind("apply_patch")).toBe(true);
    expect(isEditToolKind("create_file")).toBe(true);
    expect(isEditToolKind("delete_file")).toBe(true);
    expect(isEditToolKind("Write")).toBe(true);
  });

  it("rejects read / search / shell", () => {
    expect(isEditToolKind("read")).toBe(false);
    expect(isEditToolKind("bash")).toBe(false);
    expect(isEditToolKind("grep")).toBe(false);
    expect(isEditToolKind("")).toBe(false);
  });
});

describe("mergeSessionChange", () => {
  it("ignores non-edit tools and empty paths", () => {
    expect(
      mergeSessionChange([], {
        kind: "read",
        path: "/a.ts",
        status: "completed",
      }),
    ).toEqual([]);
    expect(
      mergeSessionChange([], {
        kind: "write",
        path: "",
        status: "completed",
      }),
    ).toEqual([]);
  });

  it("upserts by normalized path and moves to front", () => {
    let list: SessionFileChange[] = [];
    list = mergeSessionChange(list, {
      toolCallId: "t1",
      kind: "write",
      path: "/proj/a.ts",
      status: "in_progress",
      updatedAt: "2026-01-01T00:00:00.000Z",
    });
    list = mergeSessionChange(list, {
      toolCallId: "t2",
      kind: "search_replace",
      path: "/proj\\b.ts",
      status: "completed",
      after: "hello",
      updatedAt: "2026-01-01T00:01:00.000Z",
    });
    expect(list).toHaveLength(2);
    expect(list[0]?.path).toBe("/proj/b.ts");
    expect(list[0]?.after).toBe("hello");

    // Update a.ts again — should move to front, preserve identity of b
    list = mergeSessionChange(list, {
      toolCallId: "t3",
      kind: "write",
      path: "/proj/a.ts",
      status: "completed",
      after: "new a",
      updatedAt: "2026-01-01T00:02:00.000Z",
    });
    expect(list).toHaveLength(2);
    expect(list[0]?.path).toBe("/proj/a.ts");
    expect(list[0]?.after).toBe("new a");
    expect(list[0]?.status).toBe("completed");
    expect(list[1]?.path).toBe("/proj/b.ts");
  });

  it("keeps earlier before when later event only has after", () => {
    let list = mergeSessionChange([], {
      kind: "str_replace",
      path: "/f.ts",
      status: "completed",
      before: "old",
      after: "mid",
    });
    list = mergeSessionChange(list, {
      kind: "write",
      path: "/f.ts",
      status: "completed",
      after: "new",
    });
    expect(list[0]?.before).toBe("old");
    expect(list[0]?.after).toBe("new");
  });
});

describe("sessionChangesFromMessages", () => {
  it("builds from tool_step rows with paths", () => {
    const messages: ChatMessage[] = [
      {
        id: "tool-1",
        role: "tool",
        content: "tool_step|completed|write|Write foo\ndetail\n/tmp/foo.ts",
        marker: "tool_step",
        toolKind: "write",
        toolPath: "/tmp/foo.ts",
        toolStatus: "completed",
        createdAt: "2026-01-01T00:00:00.000Z",
      },
      {
        id: "tool-2",
        role: "tool",
        content: "tool_step|completed|read|Read bar\n/tmp/bar.ts",
        marker: "tool_step",
        toolKind: "read",
        toolPath: "/tmp/bar.ts",
        toolStatus: "completed",
      },
    ];
    const changes = sessionChangesFromMessages(messages);
    expect(changes).toHaveLength(1);
    expect(changes[0]?.path).toBe("/tmp/foo.ts");
    expect(changes[0]?.toolKind).toBe("write");
  });
});

describe("buildUnifiedDiff", () => {
  it("produces unified headers and +/- lines", () => {
    const d = buildUnifiedDiff(
      "a.ts",
      "line1\nline2\nline3\n",
      "line1\nline2-changed\nline3\n",
    );
    expect(d).toContain("--- a/a.ts");
    expect(d).toContain("+++ b/a.ts");
    expect(d).toContain("-line2");
    expect(d).toContain("+line2-changed");
  });
});
