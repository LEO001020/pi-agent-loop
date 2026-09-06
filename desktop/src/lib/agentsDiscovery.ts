/**
 * Pure helpers for Settings → Extensions → Agents / Personas.
 * Definition files live under ~/.pi/agents (+ project .pi/agents)
 * and ~/.pi/personas (+ project .pi/personas). Bundled agents are
 * under ~/.pi/bundled/agents (read-only reference).
 *
 * Runtime selection uses CLI flags / config — the App only lists and opens
 * files (no fake "set active agent" without ACP session switch support).
 */

export type AgentScope = "project" | "user" | "bundled";

export type PersonaScope = "project" | "user" | "bundled";

export type AgentDefLike = {
  name: string;
  path: string;
  scope: AgentScope;
  description?: string | null;
};

export type PersonaDefLike = {
  name: string;
  path: string;
  scope: PersonaScope;
};

/** Relative dir segments under a PI home root. */
export const AGENTS_DIR_SEGMENTS = ["agents"] as const;
export const PERSONAS_DIR_SEGMENTS = ["personas"] as const;
export const BUNDLED_AGENTS_SEGMENTS = ["bundled", "agents"] as const;
export const BUNDLED_PERSONAS_SEGMENTS = ["bundled", "personas"] as const;

const AGENT_EXTS = new Set([".md", ".markdown"]);
const PERSONA_EXTS = new Set([".toml", ".md", ".markdown"]);

function joinPath(...parts: string[]): string {
  const cleaned = parts
    .map((p) => p.replace(/[/\\]+$/g, "").replace(/^[/\\]+/g, (m) => m))
    .filter((p, i) => (i === 0 ? p.length > 0 : p.length > 0));
  if (cleaned.length === 0) return "";
  const first = cleaned[0];
  const sep = first.includes("\\") && !first.includes("/") ? "\\" : "/";
  // Absolute root: keep leading slash or drive letter
  const isAbsUnix = first.startsWith("/");
  const isAbsWin = /^[A-Za-z]:/.test(first);
  const segs: string[] = [];
  for (let i = 0; i < cleaned.length; i++) {
    const piece = cleaned[i].replace(/\\/g, "/");
    for (const s of piece.split("/").filter(Boolean)) segs.push(s);
  }
  if (isAbsWin) {
    const drive = cleaned[0].slice(0, 2);
    const rest = segs.slice(1); // first seg may be "C:"
    const afterDrive = segs[0]?.includes(":") ? segs.slice(1) : rest;
    return `${drive}\\${afterDrive.join("\\")}`;
  }
  if (isAbsUnix) return `/${segs.join("/")}`;
  return segs.join(sep);
}

/** `~/.pi` style root from a user home directory. */
export function piHomeFromUserHome(userHome: string): string {
  const home = (userHome ?? "").trim().replace(/[/\\]+$/g, "");
  if (!home) return ".pi";
  const sep = home.includes("\\") && !home.includes("/") ? "\\" : "/";
  return `${home}${sep}.pi`;
}

/**
 * Absolute directories where agent definition files are discovered.
 * `projectPath` is the workbench project root (not PI_AGENT_HOME).
 */
export function resolveAgentsDirs(
  userHome: string,
  projectPath?: string | null,
): {
  user: string;
  project: string | null;
  bundled: string;
} {
  const pi = piHomeFromUserHome(userHome);
  const user = joinPath(pi, "agents");
  const bundled = joinPath(pi, "bundled", "agents");
  const proj = (projectPath ?? "").trim().replace(/[/\\]+$/g, "");
  const project = proj ? joinPath(proj, ".pi", "agents") : null;
  return { user, project, bundled };
}

/** Absolute directories for persona definition files. */
export function resolvePersonasDirs(
  userHome: string,
  projectPath?: string | null,
): {
  user: string;
  project: string | null;
  bundled: string;
} {
  const pi = piHomeFromUserHome(userHome);
  const user = joinPath(pi, "personas");
  const bundled = joinPath(pi, "bundled", "personas");
  const proj = (projectPath ?? "").trim().replace(/[/\\]+$/g, "");
  const project = proj ? joinPath(proj, ".pi", "personas") : null;
  return { user, project, bundled };
}

function extensionOf(fileName: string): string {
  const base = fileName.split(/[/\\]/).pop() ?? fileName;
  const i = base.lastIndexOf(".");
  if (i <= 0) return "";
  return base.slice(i).toLowerCase();
}

/** True when a file name is a Pi agent definition (markdown). */
export function isAgentDefinitionFileName(
  fileName: string | null | undefined,
): boolean {
  const base = (fileName ?? "").trim().split(/[/\\]/).pop() ?? "";
  if (!base || base.startsWith(".")) return false;
  return AGENT_EXTS.has(extensionOf(base));
}

/** True when a file name is a persona definition (.toml / .md). */
export function isPersonaDefinitionFileName(
  fileName: string | null | undefined,
): boolean {
  const base = (fileName ?? "").trim().split(/[/\\]/).pop() ?? "";
  if (!base || base.startsWith(".")) return false;
  return PERSONA_EXTS.has(extensionOf(base));
}

/** Definition name = file stem (e.g. `explore.md` → `explore`). */
export function definitionNameFromFileName(
  fileName: string | null | undefined,
): string {
  const base = (fileName ?? "").trim().split(/[/\\]/).pop() ?? "";
  if (!base) return "";
  const ext = extensionOf(base);
  if (ext && base.toLowerCase().endsWith(ext)) {
    return base.slice(0, -ext.length);
  }
  return base;
}

/**
 * Build agent entries from a flat directory listing (no recursion).
 * Ignores non-definition files and empty names.
 */
export function agentEntriesFromFileNames(
  fileNames: string[],
  dir: string,
  scope: AgentScope,
): AgentDefLike[] {
  const root = (dir ?? "").replace(/[/\\]+$/g, "");
  const sep = root.includes("\\") && !root.includes("/") ? "\\" : "/";
  const out: AgentDefLike[] = [];
  for (const raw of fileNames) {
    const base = (raw ?? "").trim().split(/[/\\]/).pop() ?? "";
    if (!isAgentDefinitionFileName(base)) continue;
    const name = definitionNameFromFileName(base);
    if (!name) continue;
    out.push({
      name,
      path: root ? `${root}${sep}${base}` : base,
      scope,
    });
  }
  return out;
}

/** Build persona entries from a flat directory listing. */
export function personaEntriesFromFileNames(
  fileNames: string[],
  dir: string,
  scope: PersonaScope,
): PersonaDefLike[] {
  const root = (dir ?? "").replace(/[/\\]+$/g, "");
  const sep = root.includes("\\") && !root.includes("/") ? "\\" : "/";
  const out: PersonaDefLike[] = [];
  for (const raw of fileNames) {
    const base = (raw ?? "").trim().split(/[/\\]/).pop() ?? "";
    if (!isPersonaDefinitionFileName(base)) continue;
    const name = definitionNameFromFileName(base);
    if (!name) continue;
    out.push({
      name,
      path: root ? `${root}${sep}${base}` : base,
      scope,
    });
  }
  return out;
}

/** Scope sort key: project (overrides) → user → bundled. */
export function agentScopeRank(scope: string | null | undefined): number {
  switch ((scope ?? "").trim().toLowerCase()) {
    case "project":
      return 0;
    case "user":
      return 1;
    case "bundled":
    case "builtin":
    case "built-in":
      return 2;
    default:
      return 9;
  }
}

/** Sort: scope rank, then name (case-insensitive). Stable copy. */
export function sortAgentDefs<T extends { name: string; scope: string }>(
  agents: T[],
): T[] {
  return [...agents].sort((a, b) => {
    const sr = agentScopeRank(a.scope) - agentScopeRank(b.scope);
    if (sr !== 0) return sr;
    return a.name.localeCompare(b.name, undefined, { sensitivity: "base" });
  });
}

export function sortPersonaDefs<T extends { name: string; scope: string }>(
  personas: T[],
): T[] {
  return sortAgentDefs(personas);
}

/** Badge tone aligned with skill source colors. */
export function agentScopeTone(
  scope: string | null | undefined,
): "user" | "project" | "plugin" | "muted" {
  switch ((scope ?? "").trim().toLowerCase()) {
    case "user":
      return "user";
    case "project":
      return "project";
    case "bundled":
    case "builtin":
    case "built-in":
      return "plugin";
    default:
      return "muted";
  }
}

/**
 * Pull a short description from agent markdown frontmatter when present.
 * Handles `description: text` and multi-line `description: >` blocks (first line).
 */
export function extractAgentDescription(
  content: string | null | undefined,
): string | null {
  const raw = content ?? "";
  if (!raw.startsWith("---")) return null;
  const end = raw.indexOf("\n---", 3);
  if (end < 0) return null;
  const fm = raw.slice(3, end);
  // description: plain value
  const plain = fm.match(/^\s*description:\s*(.+)\s*$/m);
  if (plain) {
    let v = plain[1].trim();
    if (v === ">" || v === "|" || v === ">-" || v === "|-") {
      // Folded block: take first non-empty indented line after description
      const after = fm.slice(plain.index! + plain[0].length);
      const line = after.match(/^\s+(.+)$/m);
      if (line) {
        v = line[1].trim();
      } else {
        return null;
      }
    }
    // Strip surrounding quotes
    if (
      (v.startsWith('"') && v.endsWith('"')) ||
      (v.startsWith("'") && v.endsWith("'"))
    ) {
      v = v.slice(1, -1);
    }
    v = v.replace(/\s+/g, " ").trim();
    return v || null;
  }
  return null;
}

/** Compact meta under an agent row (scope · optional description snippet). */
export function agentMetaLine(agent: {
  scope?: string | null;
  description?: string | null;
}): string {
  const parts: string[] = [(agent.scope ?? "").trim() || "unknown"];
  const desc = (agent.description ?? "").trim();
  if (desc) {
    const short = desc.length > 80 ? `${desc.slice(0, 77)}…` : desc;
    parts.push(short);
  }
  return parts.join(" · ");
}

export function personaMetaLine(persona: {
  scope?: string | null;
}): string {
  return (persona.scope ?? "").trim() || "unknown";
}

/**
 * Merge multi-scope directory listings into one sorted agent list.
 * Later scopes do not dedupe — Pi keeps same-name defs visible per scope;
 * project still wins at runtime via CLI priority.
 */
export function collectAgentDefs(input: {
  projectFiles?: string[];
  projectDir?: string | null;
  userFiles?: string[];
  userDir?: string | null;
  bundledFiles?: string[];
  bundledDir?: string | null;
}): AgentDefLike[] {
  const out: AgentDefLike[] = [];
  if (input.projectDir && input.projectFiles) {
    out.push(
      ...agentEntriesFromFileNames(
        input.projectFiles,
        input.projectDir,
        "project",
      ),
    );
  }
  if (input.userDir && input.userFiles) {
    out.push(
      ...agentEntriesFromFileNames(input.userFiles, input.userDir, "user"),
    );
  }
  if (input.bundledDir && input.bundledFiles) {
    out.push(
      ...agentEntriesFromFileNames(
        input.bundledFiles,
        input.bundledDir,
        "bundled",
      ),
    );
  }
  return sortAgentDefs(out);
}

export function collectPersonaDefs(input: {
  projectFiles?: string[];
  projectDir?: string | null;
  userFiles?: string[];
  userDir?: string | null;
  bundledFiles?: string[];
  bundledDir?: string | null;
}): PersonaDefLike[] {
  const out: PersonaDefLike[] = [];
  if (input.projectDir && input.projectFiles) {
    out.push(
      ...personaEntriesFromFileNames(
        input.projectFiles,
        input.projectDir,
        "project",
      ),
    );
  }
  if (input.userDir && input.userFiles) {
    out.push(
      ...personaEntriesFromFileNames(input.userFiles, input.userDir, "user"),
    );
  }
  if (input.bundledDir && input.bundledFiles) {
    out.push(
      ...personaEntriesFromFileNames(
        input.bundledFiles,
        input.bundledDir,
        "bundled",
      ),
    );
  }
  return sortPersonaDefs(out);
}
