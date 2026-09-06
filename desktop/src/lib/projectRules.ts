/**
 * Pure helpers for project rule / instruction files (AGENTS.md, CLAUDE.md, .pi rules).
 * Classification only — disk I/O lives in the Tauri host (`project_rules_*` commands).
 */

export type ProjectRuleKind =
  | "agents_md"
  | "claude_md"
  | "pi_rules"
  | "nested_agents";

/** One classified rule path (relative to project root). */
export type ClassifiedProjectRule = {
  relativePath: string;
  kind: ProjectRuleKind;
  /** Basename for display. */
  name: string;
};

/** Canonical root AGENTS template path created by ensure_template. */
export const AGENTS_MD_TEMPLATE_PATH = "AGENTS.md";

/**
 * Common root filenames to probe on case-sensitive filesystems.
 * Order is preference (first match wins for "primary agents file").
 */
export const ROOT_AGENTS_PROBE_NAMES = [
  "AGENTS.md",
  "Agents.md",
  "agents.md",
  "AGENT.md",
  "Agent.md",
] as const;

export const ROOT_CLAUDE_PROBE_NAMES = [
  "CLAUDE.md",
  "Claude.md",
  "claude.md",
] as const;

/** Normalize a project-relative path: forward slashes, no leading `./` or `/`. */
export function normalizeRuleRelativePath(path: string): string {
  return (path ?? "")
    .trim()
    .replace(/\\/g, "/")
    .replace(/^\.\/+/, "")
    .replace(/^\/+/, "")
    .replace(/\/+$/, "");
}

function baseName(relativePath: string): string {
  const parts = normalizeRuleRelativePath(relativePath).split("/").filter(Boolean);
  return parts[parts.length - 1] || relativePath;
}

function isAgentsFileName(name: string): boolean {
  const n = name.trim().toLowerCase();
  return n === "agents.md" || n === "agent.md";
}

function isClaudeFileName(name: string): boolean {
  return name.trim().toLowerCase() === "claude.md";
}

/**
 * True when path is a Pi rules file/dir pattern:
 * - `.pi/rules`
 * - `.pi/rules.md` / `.pi/rules.txt` / `.pi/rules.*`
 * - anything under `.pi/rules/`
 */
export function isPiRulesPath(relativePath: string): boolean {
  const p = normalizeRuleRelativePath(relativePath);
  if (!p) return false;
  const lower = p.toLowerCase();
  if (lower === ".pi/rules") return true;
  if (lower.startsWith(".pi/rules.")) return true;
  if (lower.startsWith(".pi/rules/")) return true;
  return false;
}

/**
 * True when path is an AGENTS.md under `.pi/` (not project root).
 * Matches `.pi/**\/AGENTS.md` (any depth).
 */
export function isNestedAgentsPath(relativePath: string): boolean {
  const p = normalizeRuleRelativePath(relativePath);
  if (!p) return false;
  const lower = p.toLowerCase();
  if (!lower.startsWith(".pi/")) return false;
  if (isPiRulesPath(p)) return false;
  const name = baseName(p);
  return isAgentsFileName(name);
}

/**
 * Classify a project-relative path as a known rule location.
 * Does not check disk existence.
 */
export function classifyProjectRulePath(
  relativePath: string,
): ClassifiedProjectRule | null {
  const p = normalizeRuleRelativePath(relativePath);
  if (!p) return null;

  // Root-level only (no slash)
  if (!p.includes("/")) {
    const name = p;
    if (isAgentsFileName(name)) {
      return { relativePath: p, kind: "agents_md", name };
    }
    if (isClaudeFileName(name)) {
      return { relativePath: p, kind: "claude_md", name };
    }
    return null;
  }

  if (isPiRulesPath(p)) {
    return { relativePath: p, kind: "pi_rules", name: baseName(p) };
  }

  if (isNestedAgentsPath(p)) {
    return { relativePath: p, kind: "nested_agents", name: baseName(p) };
  }

  return null;
}

/** Stable sort: agents_md → claude_md → pi_rules → nested_agents, then path. */
const KIND_ORDER: Record<ProjectRuleKind, number> = {
  agents_md: 0,
  claude_md: 1,
  pi_rules: 2,
  nested_agents: 3,
};

export function compareProjectRules(
  a: ClassifiedProjectRule,
  b: ClassifiedProjectRule,
): number {
  const ko = KIND_ORDER[a.kind] - KIND_ORDER[b.kind];
  if (ko !== 0) return ko;
  return a.relativePath.localeCompare(b.relativePath);
}

/**
 * From existing relative paths under a project, return classified rule files.
 * Dedupes by normalized path; stable kind/path order.
 */
export function selectExistingProjectRules(
  existingRelativePaths: readonly string[],
): ClassifiedProjectRule[] {
  const byPath = new Map<string, ClassifiedProjectRule>();
  for (const raw of existingRelativePaths) {
    const hit = classifyProjectRulePath(raw);
    if (!hit) continue;
    if (!byPath.has(hit.relativePath)) {
      byPath.set(hit.relativePath, hit);
    }
  }
  return Array.from(byPath.values()).sort(compareProjectRules);
}

/**
 * Whether any existing path is a root AGENTS.md (any case / AGENT.md).
 */
export function hasRootAgentsMd(
  existingRelativePaths: readonly string[],
): boolean {
  return selectExistingProjectRules(existingRelativePaths).some(
    (r) => r.kind === "agents_md",
  );
}

/**
 * Prefer existing root AGENTS.md path for open/reveal; else the template path.
 * Canonical `AGENTS.md` wins over case variants when both are listed.
 */
export function preferredAgentsMdPath(
  existingRelativePaths: readonly string[],
): string {
  const agents = selectExistingProjectRules(existingRelativePaths).filter(
    (r) => r.kind === "agents_md",
  );
  if (agents.length === 0) return AGENTS_MD_TEMPLATE_PATH;
  const canonical = agents.find((r) => r.relativePath === AGENTS_MD_TEMPLATE_PATH);
  return (canonical ?? agents[0]).relativePath;
}

/**
 * Short AGENTS.md stub for new projects (not marketing fluff).
 * Used by the host `project_rules_ensure_template` command and tests.
 */
export function agentsMdTemplateBody(): string {
  return [
    "# Project rules",
    "",
    "Instructions for coding agents in this repository.",
    "",
    "## Layout",
    "",
    "- Describe important directories and entry points.",
    "",
    "## Commands",
    "",
    "- test:",
    "- build:",
    "- lint:",
    "",
    "## Conventions",
    "",
    "- Prefer small, reviewable changes.",
    "- Match existing style; avoid unrelated refactors.",
    "- Do not commit secrets, auth tokens, or local credentials.",
    "",
  ].join("\n");
}
