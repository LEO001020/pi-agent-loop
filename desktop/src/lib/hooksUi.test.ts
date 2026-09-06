import { describe, expect, it } from "vitest";
import {
  formatHookMtime,
  formatHookSize,
  hookMetaLine,
  hookRowKey,
  hookTypeLabel,
  joinHooksPath,
  projectHooksDir,
  sortHooksByScopeName,
} from "./hooksUi";

describe("joinHooksPath", () => {
  it("joins simple names", () => {
    expect(joinHooksPath("/Users/me/.pi/hooks", "session-start.json")).toBe(
      "/Users/me/.pi/hooks/session-start.json",
    );
    expect(joinHooksPath("/tmp/hooks/", "  a.md  ")).toBe("/tmp/hooks/a.md");
  });

  it("uses backslash when dir is Windows-style", () => {
    expect(joinHooksPath("C:\\Users\\me\\.pi\\hooks", "x.json")).toBe(
      "C:\\Users\\me\\.pi\\hooks\\x.json",
    );
  });

  it("rejects empty, traversal, and absolute names", () => {
    expect(joinHooksPath("/tmp/hooks", "")).toBeNull();
    expect(joinHooksPath("", "a.json")).toBeNull();
    expect(joinHooksPath("/tmp/hooks", "..")).toBeNull();
    expect(joinHooksPath("/tmp/hooks", "../x")).toBeNull();
    expect(joinHooksPath("/tmp/hooks", "a/b.json")).toBeNull();
    expect(joinHooksPath("/tmp/hooks", "/etc/passwd")).toBeNull();
  });
});

describe("projectHooksDir", () => {
  it("joins project root", () => {
    expect(projectHooksDir("/tmp/my-app")).toBe("/tmp/my-app/.pi/hooks");
    expect(projectHooksDir("/tmp/my-app/")).toBe("/tmp/my-app/.pi/hooks");
  });

  it("returns null for empty", () => {
    expect(projectHooksDir(null)).toBeNull();
    expect(projectHooksDir("  ")).toBeNull();
  });
});

describe("formatHookSize / type / meta", () => {
  it("formats sizes", () => {
    expect(formatHookSize(0)).toBe("0 B");
    expect(formatHookSize(512)).toBe("512 B");
    expect(formatHookSize(2048)).toBe("2.0 KB");
    expect(formatHookSize(2 * 1024 * 1024)).toBe("2.0 MB");
  });

  it("type label prefers ext", () => {
    expect(hookTypeLabel({ kind: "file", ext: "json" })).toBe("json");
    expect(hookTypeLabel({ kind: "dir", ext: "" })).toBe("dir");
    expect(hookTypeLabel({ kind: "file", ext: "" })).toBe("file");
  });

  it("meta line includes scope type size", () => {
    const line = hookMetaLine({
      name: "a.json",
      path: "/u/a.json",
      scope: "user",
      kind: "file",
      ext: "json",
      size: 100,
      mtimeMs: 0,
    });
    expect(line).toContain("user");
    expect(line).toContain("json");
    expect(line).toContain("100 B");
  });

  it("row key is stable", () => {
    expect(
      hookRowKey({ scope: "user", path: "/h/a.json", name: "a.json" }),
    ).toBe("user:/h/a.json");
  });
});

describe("formatHookMtime", () => {
  it("empty for zero", () => {
    expect(formatHookMtime(0)).toBe("");
    expect(formatHookMtime(undefined)).toBe("");
  });

  it("formats a real timestamp", () => {
    const s = formatHookMtime(1_700_000_000_000, "en-US");
    expect(s.length).toBeGreaterThan(4);
  });
});

describe("sortHooksByScopeName", () => {
  it("orders user before project, then name", () => {
    const sorted = sortHooksByScopeName([
      { name: "z.json", scope: "project", path: "/p/z" },
      { name: "b.json", scope: "user", path: "/u/b" },
      { name: "a.json", scope: "user", path: "/u/a" },
    ]);
    expect(sorted.map((h) => h.name)).toEqual(["a.json", "b.json", "z.json"]);
    expect(sorted[2].scope).toBe("project");
  });
});
