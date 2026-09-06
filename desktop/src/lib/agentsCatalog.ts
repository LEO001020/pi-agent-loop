/**
 * Pure helpers for discovering selectable Pi CLI agent definitions.
 *
 * Sources (CLI `--agent <NAME>`):
 * - Built-ins: explore, plan, general-purpose
 * - User: ~/.pi/agents/*.md
 * - Project: <project>/.pi/agents/*.md
 *
 * Runtime selection is spawn-time only (`pi --agent NAME agent stdio`).
 * Changing the preferred agent requires reconnect / new session — no mid-turn
 * hot-swap over ACP.
 */

export type AgentCatalogSource = "builtin" | "user" | "project";

export type AgentCatalogEntry = {
  /** CLI name (file stem or built-in id). */
  name: string;
  source: AgentCatalogSource;
  /** Absolute path when discovered from a file; omitted for pure built-ins. */
  path?: string | null;
};

/** Well-known built-in agent names shipped with Pi CLI. */
export const BUILTIN_AGENT_NAMES = [
  "explore",
  "general-purpose",
  "plan",
] as const;

export type BuiltinAgentName = (typeof BUILTIN_AGENT_NAMES)[number];

const AGENT_MD_RE = /\.(md|markdown)$/i;

/** Values that mean "use CLI default — do not pass --agent". */
export const DEFAULT_AGENT_SENTINELS = new Set([
  "",
  "default",
  "none",
  "cli-default",
  "pi-build",
]);

/**
 * Normalize a settings / UI value into a spawn agent name.
 * Returns null when the CLI default should be used (no `--agent` flag).
 */
export function normalizePreferredAgent(
  raw: string | null | undefined,
): string | null {
  const name = (raw ?? "").trim();
  if (!name) return null;
  if (DEFAULT_AGENT_SENTINELS.has(name.toLowerCase())) return null;
  // Reject control chars / path traversal noise in the name form.
  if (/[\0\r\n]/.test(name)) return null;
  return name;
}

/** Top-level CLI args when a preferred agent is set: `["--agent", name]`. */
export function agentSpawnCliArgs(
  raw: string | null | undefined,
): string[] | null {
  const name = normalizePreferredAgent(raw);
  if (!name) return null;
  return ["--agent", name];
}

/** Definition name = file stem (`explore.md` → `explore`). */
export function agentNameFromFileName(fileName: string): string | null {
  const base = fileName.replace(/^.*[/\\]/, "").trim();
  if (!base || base.startsWith(".")) return null;
  if (!AGENT_MD_RE.test(base)) return null;
  const stem = base.replace(AGENT_MD_RE, "").trim();
  if (!stem || stem === "README" || stem.toLowerCase() === "readme") return null;
  return stem;
}

/** Collect agent names from bare file basenames in a directory listing. */
export function agentNamesFromFileList(fileNames: string[]): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const f of fileNames) {
    const name = agentNameFromFileName(f);
    if (!name) continue;
    const key = name.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(name);
  }
  out.sort((a, b) => a.localeCompare(b, undefined, { sensitivity: "base" }));
  return out;
}

/**
 * Merge built-ins + user + project agent names.
 * Priority when the same name appears in multiple scopes: project > user > builtin.
 */
export function mergeAgentCatalog(input: {
  userFiles?: string[];
  projectFiles?: string[];
  /** Extra built-in names (defaults to BUILTIN_AGENT_NAMES). */
  builtins?: readonly string[];
  userDir?: string | null;
  projectDir?: string | null;
}): AgentCatalogEntry[] {
  const builtins = input.builtins ?? BUILTIN_AGENT_NAMES;
  const byKey = new Map<string, AgentCatalogEntry>();

  for (const name of builtins) {
    const n = name.trim();
    if (!n) continue;
    byKey.set(n.toLowerCase(), { name: n, source: "builtin" });
  }

  const userDir = (input.userDir ?? "").trim() || null;
  for (const name of agentNamesFromFileList(input.userFiles ?? [])) {
    const path = userDir ? joinDirFile(userDir, `${name}.md`) : null;
    byKey.set(name.toLowerCase(), {
      name,
      source: "user",
      path,
    });
  }

  const projectDir = (input.projectDir ?? "").trim() || null;
  for (const name of agentNamesFromFileList(input.projectFiles ?? [])) {
    const path = projectDir ? joinDirFile(projectDir, `${name}.md`) : null;
    byKey.set(name.toLowerCase(), {
      name,
      source: "project",
      path,
    });
  }

  return Array.from(byKey.values()).sort((a, b) =>
    a.name.localeCompare(b.name, undefined, { sensitivity: "base" }),
  );
}

function joinDirFile(dir: string, file: string): string {
  const d = dir.replace(/[/\\]+$/g, "");
  const sep = d.includes("\\") && !d.includes("/") ? "\\" : "/";
  return `${d}${sep}${file}`;
}

/** Absolute dirs the catalog scans (mirrors CLI discovery roots). */
export function resolveAgentCatalogDirs(
  userHome: string,
  projectPath?: string | null,
): { user: string; project: string | null; bundled: string } {
  const home = (userHome ?? "").trim().replace(/[/\\]+$/g, "");
  const sep =
    home.includes("\\") && !home.includes("/") ? "\\" : "/";
  const pi = home ? `${home}${sep}.pi` : `.pi`;
  const user = `${pi}${sep}agents`;
  const bundled = `${pi}${sep}bundled${sep}agents`;
  const proj = (projectPath ?? "").trim().replace(/[/\\]+$/g, "");
  const project = proj ? `${proj}${sep}.pi${sep}agents` : null;
  return { user, project, bundled };
}
