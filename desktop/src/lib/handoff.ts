export type HandoffMessageLike = {
  role: string;
  content?: string | null;
  toolPath?: string | null;
  attachments?: Array<{ path: string }> | null;
};

export type HandoffLabels = {
  heading: string;
  goal: string;
  source: string;
  project: string;
  files: string;
  recent: string;
  user: string;
  assistant: string;
  instruction: string;
};

export type BuildHandoffDraftInput = {
  goal: string;
  sourceTitle: string;
  projectPath?: string | null;
  messages: HandoffMessageLike[];
  labels: HandoffLabels;
};

const MAX_CONTEXT_MESSAGES = 8;
const MAX_CONTEXT_CHARS = 4_000;
const MAX_MESSAGE_CHARS = 700;
const MAX_FILES = 16;

function compactText(value: string, limit = MAX_MESSAGE_CHARS): string {
  const cleaned = value
    .replace(/\[\[skill:([^\]]+)\]\]/g, "/$1")
    .replace(/\s+/g, " ")
    .trim();
  if (cleaned.length <= limit) return cleaned;
  return `${cleaned.slice(0, Math.max(0, limit - 1)).trimEnd()}…`;
}

function collectFiles(messages: HandoffMessageLike[]): string[] {
  const seen = new Set<string>();
  for (const message of messages) {
    if (message.toolPath?.trim()) seen.add(message.toolPath.trim());
    for (const attachment of message.attachments ?? []) {
      if (attachment.path?.trim()) seen.add(attachment.path.trim());
    }
  }
  return Array.from(seen).slice(-MAX_FILES);
}

function recentContext(
  messages: HandoffMessageLike[],
  labels: HandoffLabels,
): string[] {
  const candidates = messages
    .filter(
      (message) =>
        (message.role === "user" || message.role === "assistant") &&
        !!message.content?.trim(),
    )
    .slice(-MAX_CONTEXT_MESSAGES);

  const lines: string[] = [];
  let used = 0;
  for (const message of candidates) {
    const role =
      message.role === "user" ? labels.user : labels.assistant;
    const text = compactText(message.content ?? "");
    if (!text) continue;
    const line = `- ${role}: ${text}`;
    if (used + line.length > MAX_CONTEXT_CHARS) break;
    lines.push(line);
    used += line.length;
  }
  return lines;
}

/**
 * Build an editable, deterministic handoff draft. The forked session still
 * owns the complete journal; this draft gives the next run a focused objective
 * and a compact map of the context it should verify.
 */
export function buildHandoffDraft(input: BuildHandoffDraftInput): string {
  const { labels } = input;
  const sections = [
    `## ${labels.heading}`,
    `${labels.goal}: ${compactText(input.goal, 2_000)}`,
    `${labels.source}: ${compactText(input.sourceTitle, 300)}`,
  ];
  if (input.projectPath?.trim()) {
    sections.push(`${labels.project}: ${input.projectPath.trim()}`);
  }

  const files = collectFiles(input.messages);
  if (files.length) {
    sections.push(
      "",
      `### ${labels.files}`,
      ...files.map((path) => `- ${path}`),
    );
  }

  const context = recentContext(input.messages, labels);
  if (context.length) {
    sections.push("", `### ${labels.recent}`, ...context);
  }

  sections.push("", labels.instruction);
  return sections.join("\n").trim();
}
