/** Build a markdown export for a whole chat session. */

export type ExportableMessage = {
  role: "user" | "assistant" | "tool" | string;
  content: string;
  thought?: string;
  createdAt?: string;
};

export type SessionExportInput = {
  title: string;
  projectName?: string | null;
  projectPath?: string | null;
  sessionId?: string | null;
  exportedAt?: string;
  messages: ExportableMessage[];
};

function roleHeading(role: string): string {
  if (role === "user") return "User";
  if (role === "assistant") return "Assistant";
  if (role === "tool") return "Tool";
  return role;
}

/**
 * Render a session as GitHub-flavored markdown.
 * Skips empty tool shells; keeps assistant thought in a collapsed details block.
 */
export function sessionToMarkdown(input: SessionExportInput): string {
  const lines: string[] = [];
  const title = (input.title || "Untitled").trim() || "Untitled";
  lines.push(`# ${title}`);
  lines.push("");

  const meta: string[] = [];
  if (input.projectName) meta.push(`Project: ${input.projectName}`);
  if (input.projectPath) meta.push(`Path: ${input.projectPath}`);
  if (input.sessionId) meta.push(`Session: ${input.sessionId}`);
  meta.push(`Exported: ${input.exportedAt || new Date().toISOString()}`);
  lines.push(meta.map((m) => `- ${m}`).join("\n"));
  lines.push("");
  lines.push("---");
  lines.push("");

  for (const m of input.messages) {
    const body = (m.content || "").trim();
    const thought = (m.thought || "").trim();
    if (!body && !thought) continue;
    if (m.role === "tool" && !body) continue;

    lines.push(`## ${roleHeading(m.role)}`);
    if (m.createdAt) {
      lines.push(`*${m.createdAt}*`);
      lines.push("");
    }
    if (thought) {
      lines.push("<details>");
      lines.push("<summary>Thinking</summary>");
      lines.push("");
      lines.push(thought);
      lines.push("");
      lines.push("</details>");
      lines.push("");
    }
    if (body) {
      lines.push(body);
      lines.push("");
    }
  }

  return lines.join("\n").replace(/\n{3,}/g, "\n\n").trim() + "\n";
}

/** Safe download filename from a session title. */
export function sessionExportFilename(title: string, sessionId?: string | null): string {
  const base = (title || "session")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9\u4e00-\u9fff]+/gi, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48);
  const id = (sessionId || "").slice(0, 8);
  const name = base || "session";
  return id ? `pi-${name}-${id}.md` : `pi-${name}.md`;
}
