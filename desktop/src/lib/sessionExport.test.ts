import { describe, expect, it } from "vitest";
import { sessionExportFilename, sessionToMarkdown } from "./sessionExport";

describe("sessionToMarkdown", () => {
  it("builds a title, meta block, and role sections", () => {
    const md = sessionToMarkdown({
      title: "Doctor reset",
      projectName: "pi-app",
      projectPath: "/tmp/pi-app",
      sessionId: "abc12345-full",
      exportedAt: "2026-07-24T00:00:00.000Z",
      messages: [
        { role: "user", content: "Add reset data" },
        {
          role: "assistant",
          content: "Done.",
          thought: "Need double confirm.",
        },
      ],
    });
    expect(md).toContain("# Doctor reset");
    expect(md).toContain("Project: pi-app");
    expect(md).toContain("Session: abc12345-full");
    expect(md).toContain("## User");
    expect(md).toContain("Add reset data");
    expect(md).toContain("## Assistant");
    expect(md).toContain("<summary>Thinking</summary>");
    expect(md).toContain("Need double confirm.");
    expect(md).toContain("Done.");
  });

  it("skips empty tool messages", () => {
    const md = sessionToMarkdown({
      title: "t",
      exportedAt: "2026-07-24T00:00:00.000Z",
      messages: [
        { role: "tool", content: "" },
        { role: "user", content: "hi" },
      ],
    });
    expect(md).not.toContain("## Tool");
    expect(md).toContain("## User");
  });

  it("falls back to Untitled", () => {
    const md = sessionToMarkdown({
      title: "   ",
      exportedAt: "2026-07-24T00:00:00.000Z",
      messages: [],
    });
    expect(md.startsWith("# Untitled")).toBe(true);
  });
});

describe("sessionExportFilename", () => {
  it("slugifies title and appends short id", () => {
    expect(sessionExportFilename("Fix Doctor Reset!", "abcdef12-xxxx")).toBe(
      "pi-fix-doctor-reset-abcdef12.md",
    );
  });

  it("handles empty title", () => {
    expect(sessionExportFilename("", null)).toBe("pi-session.md");
  });
});
