/**
 * Pull-request review and hand-off helpers.
 *
 * Pure functions only: parsing what the user typed, and turning a PR into
 * prompt text. Everything that touches `gh` lives in the host (`gh_cli.rs`).
 */

export type PullRequestRef = {
  number: number;
  /** Present when the user pasted a full URL rather than a bare number. */
  owner?: string;
  repo?: string;
};

/**
 * Parse a PR reference the user typed or pasted.
 *
 * Accepts `123`, `#123`, `pr 123`, and GitHub URLs (including `/files` and
 * anchors). Returns `null` when nothing looks like a PR number, so the caller
 * can fall back to listing open PRs.
 */
export function parsePullRequestRef(raw: string): PullRequestRef | null {
  const s = (raw || "").trim();
  if (!s) return null;

  const url =
    /github\.com\/([^/\s]+)\/([^/\s]+)\/pull\/(\d+)(?:[/?#]\S*)?$/i.exec(s);
  if (url) {
    const number = Number(url[3]);
    if (Number.isSafeInteger(number) && number > 0) {
      return { number, owner: url[1], repo: url[2] };
    }
    return null;
  }

  const bare = /^(?:pr\s*)?#?(\d+)$/i.exec(s);
  if (bare) {
    const number = Number(bare[1]);
    if (Number.isSafeInteger(number) && number > 0) return { number };
  }
  return null;
}

export type PrDiffLike = {
  number: number;
  title: string;
  body: string;
  baseRef: string;
  headRef: string;
  url: string;
  diff: string;
  truncated: boolean;
  changedFiles: number;
};

/**
 * Build the prompt sent to Pi for a PR review.
 *
 * The diff is fenced so the agent treats it as data, and the instructions come
 * first so a very long diff cannot push them out of attention.
 */
export function buildPrReviewPrompt(pr: PrDiffLike): string {
  const head = [
    `Review pull request #${pr.number}: ${pr.title || "(no title)"}`,
    "",
    `- Branch: \`${pr.headRef}\` → \`${pr.baseRef}\``,
    `- Files changed: ${pr.changedFiles}`,
    pr.url ? `- Link: ${pr.url}` : null,
    pr.truncated
      ? "- NOTE: the diff below was truncated because it exceeded the size limit. Say so if a conclusion depends on the missing part."
      : null,
  ]
    .filter(Boolean)
    .join("\n");

  const description = pr.body.trim()
    ? ["", "## Author's description", "", pr.body.trim()].join("\n")
    : "";

  const ask = [
    "",
    "## What I want",
    "",
    "Review the diff for correctness, security and clarity. Prioritise defects",
    "that would break at runtime over style. For each finding give the file,",
    "the line, why it is wrong and the smallest fix. If you find nothing",
    "material, say so plainly rather than inventing nits.",
  ].join("\n");

  const diff = ["", "## Diff", "", "```diff", pr.diff.trimEnd(), "```"].join(
    "\n",
  );

  return `${head}${description}${ask}${diff}\n`;
}

/**
 * Branch name for an agent working in an isolated worktree.
 *
 * Lowercases, collapses runs of unsafe characters to a single `-`, and trims
 * to a length git and GitHub both accept. Falls back to a timestamped name
 * when the title carries nothing usable (e.g. it was all punctuation).
 */
export function buildAgentBranchName(
  title: string,
  opts?: { prefix?: string; now?: Date; maxLength?: number },
): string {
  const prefix = (opts?.prefix ?? "pi").replace(/[^a-zA-Z0-9._-]/g, "") || "pi";
  const maxLength = opts?.maxLength ?? 60;

  const slug = (title || "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");

  if (!slug) {
    const now = opts?.now ?? new Date();
    const stamp = now.toISOString().slice(0, 16).replace(/[-:T]/g, "");
    return `${prefix}/task-${stamp}`;
  }

  const room = Math.max(1, maxLength - prefix.length - 1);
  const trimmed = slug.slice(0, room).replace(/-+$/g, "") || "task";
  return `${prefix}/${trimmed}`;
}

/**
 * Split an agent-authored summary into a PR title and body.
 *
 * The first non-empty line becomes the title (markdown heading markers
 * stripped); the rest becomes the body. Titles are capped so GitHub does not
 * silently truncate them mid-word.
 */
export function splitPrTitleAndBody(
  summary: string,
  maxTitle = 72,
): { title: string; body: string } {
  const lines = (summary || "").split(/\r?\n/);
  const firstIdx = lines.findIndex((l) => l.trim().length > 0);
  if (firstIdx === -1) return { title: "", body: "" };

  let title = lines[firstIdx]!.trim().replace(/^#+\s*/, "");
  if (title.length > maxTitle) {
    const cut = title.slice(0, maxTitle);
    const lastSpace = cut.lastIndexOf(" ");
    title = (lastSpace > 20 ? cut.slice(0, lastSpace) : cut).trimEnd() + "…";
  }

  const body = lines
    .slice(firstIdx + 1)
    .join("\n")
    .trim();
  return { title, body };
}
