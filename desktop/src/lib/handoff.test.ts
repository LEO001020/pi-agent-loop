import { describe, expect, it } from "vitest";
import { buildHandoffDraft, type HandoffLabels } from "./handoff";

const labels: HandoffLabels = {
  heading: "Focused handoff",
  goal: "Next objective",
  source: "Source conversation",
  project: "Workspace",
  files: "Relevant files",
  recent: "Recent context",
  user: "User",
  assistant: "Pi",
  instruction: "Continue from the inherited context and verify the workspace.",
};

describe("buildHandoffDraft", () => {
  it("includes the objective, project, context, and deduplicated files", () => {
    const draft = buildHandoffDraft({
      goal: "Finish image support",
      sourceTitle: "Pi migration",
      projectPath: "/work/pi-app",
      labels,
      messages: [
        {
          role: "user",
          content: "[[skill:tdd]] add images",
          attachments: [{ path: "/tmp/screenshot.png" }],
        },
        {
          role: "assistant",
          content: "The RPC payload needs an images array.",
          toolPath: "src-tauri/src/acp_client.rs",
          attachments: [{ path: "/tmp/screenshot.png" }],
        },
      ],
    });

    expect(draft).toContain("Next objective: Finish image support");
    expect(draft).toContain("Workspace: /work/pi-app");
    expect(draft).toContain("- User: /tdd add images");
    expect(draft).toContain("- src-tauri/src/acp_client.rs");
    expect(draft.match(/screenshot\.png/g)).toHaveLength(1);
  });

  it("omits empty optional sections", () => {
    const draft = buildHandoffDraft({
      goal: "Continue",
      sourceTitle: "Chat",
      labels,
      messages: [],
    });
    expect(draft).not.toContain("Relevant files");
    expect(draft).not.toContain("Recent context");
  });
});
