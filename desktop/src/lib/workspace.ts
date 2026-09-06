/**
 * Workspaces — the top-level context the shell is working in.
 *
 * A workspace decides what the sidebar lists and what "new chat" means. It is
 * orthogonal to `mainPane` (which pane of the current workspace is showing) and
 * to layout (how wide the panes are).
 *
 * `code` is the historical behaviour and must stay the default so an upgrade
 * lands users exactly where they were.
 */

export const WORKSPACE_STORAGE_KEY = "pi-app.workspace";

export const WORKSPACE_IDS = ["code", "pr"] as const;
export type WorkspaceId = (typeof WORKSPACE_IDS)[number];

export const DEFAULT_WORKSPACE: WorkspaceId = "code";

export type WorkspaceMeta = {
  id: WorkspaceId;
  /** i18n key for the tooltip / aria-label. */
  labelKey: string;
  /** Not yet built: selectable but shows a placeholder instead of content. */
  comingSoon: boolean;
};

export const WORKSPACES: WorkspaceMeta[] = [
  { id: "code", labelKey: "workspace.code", comingSoon: false },
  { id: "pr", labelKey: "workspace.pr", comingSoon: false },
];

export function isWorkspaceId(value: unknown): value is WorkspaceId {
  return (
    typeof value === "string" &&
    (WORKSPACE_IDS as readonly string[]).includes(value)
  );
}

export function workspaceMeta(id: WorkspaceId): WorkspaceMeta {
  return WORKSPACES.find((w) => w.id === id) ?? WORKSPACES[0]!;
}

/** True when the workspace has no real content yet. */
export function isComingSoon(id: WorkspaceId): boolean {
  return workspaceMeta(id).comingSoon;
}

/** Storage-like object (localStorage or a test double), as in `theme.ts`. */
export interface WorkspaceStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

/**
 * Read the persisted workspace.
 *
 * Anything unrecognised — a hand-edited value, an id from a newer build the user
 * rolled back from, or the removed `design` workspace — falls back to `code`
 * rather than leaving the shell in a workspace it cannot render.
 */
export function loadWorkspace(storage: WorkspaceStorage): WorkspaceId {
  try {
    const raw = storage.getItem(WORKSPACE_STORAGE_KEY);
    return isWorkspaceId(raw) ? raw : DEFAULT_WORKSPACE;
  } catch {
    return DEFAULT_WORKSPACE;
  }
}

export function saveWorkspace(
  storage: WorkspaceStorage,
  id: WorkspaceId,
): void {
  try {
    storage.setItem(WORKSPACE_STORAGE_KEY, id);
  } catch {
    // Private mode / quota: the switcher still works for this session.
  }
}

/** Resolve the workspace to activate when the user clicks an icon. */
export function nextWorkspace(
  current: WorkspaceId,
  clicked: WorkspaceId,
): WorkspaceId {
  return clicked === current ? current : clicked;
}

// ── Per-workspace colour skin ──────────────────────────────────────────────

export const WORKSPACE_SKINS_STORAGE_KEY = "pi-app.workspace-skins";

/**
 * Which colour skin each workspace wears.
 *
 * Switching workspace re-skins the shell, so the contexts are recognisable at a
 * glance. Defaults are distinct on purpose; the user can override either of
 * them in Settings → Appearance.
 *
 * The skin id type is owned by `themeSkin.ts` — kept as a plain string here so
 * this module stays free of that dependency and remains trivially testable.
 */
export type WorkspaceSkins = Record<WorkspaceId, string>;

export const DEFAULT_WORKSPACE_SKINS: WorkspaceSkins = {
  code: "default",
  pr: "ocean",
};

/**
 * Read the map, filling any missing or non-string entry from the defaults.
 *
 * A partial object is expected, not exceptional: it is what a user who has
 * only ever customised one workspace produces.
 */
export function loadWorkspaceSkins(
  storage: WorkspaceStorage,
  validSkin: (value: unknown) => boolean = () => true,
): WorkspaceSkins {
  const out: WorkspaceSkins = { ...DEFAULT_WORKSPACE_SKINS };
  let raw: unknown;
  try {
    raw = JSON.parse(storage.getItem(WORKSPACE_SKINS_STORAGE_KEY) || "null");
  } catch {
    return out;
  }
  if (!raw || typeof raw !== "object") return out;
  for (const id of WORKSPACE_IDS) {
    const value = (raw as Record<string, unknown>)[id];
    if (typeof value === "string" && validSkin(value)) out[id] = value;
  }
  return out;
}

export function saveWorkspaceSkins(
  storage: WorkspaceStorage,
  skins: WorkspaceSkins,
): void {
  try {
    storage.setItem(WORKSPACE_SKINS_STORAGE_KEY, JSON.stringify(skins));
  } catch {
    // Private mode / quota: the choice still applies for this session.
  }
}

/** Assign `skin` to one workspace, leaving the others untouched. */
export function setWorkspaceSkin(
  skins: WorkspaceSkins,
  id: WorkspaceId,
  skin: string,
): WorkspaceSkins {
  return { ...skins, [id]: skin };
}

export function workspaceSkin(skins: WorkspaceSkins, id: WorkspaceId): string {
  return skins[id] ?? DEFAULT_WORKSPACE_SKINS[id];
}

// ── PR workspace: selected repositories ────────────────────────────────────

export const PR_REPOS_STORAGE_KEY = "pi-app.pr-repos";
export const PR_REVIEW_MODEL_STORAGE_KEY = "pi-app.pr-review-model";

export function loadPrReviewModel(storage: WorkspaceStorage): string | null {
  try {
    const value = storage.getItem(PR_REVIEW_MODEL_STORAGE_KEY)?.trim();
    return value || null;
  } catch {
    return null;
  }
}

export function savePrReviewModel(
  storage: WorkspaceStorage,
  modelId: string | null,
): void {
  try {
    if (modelId?.trim()) storage.setItem(PR_REVIEW_MODEL_STORAGE_KEY, modelId.trim());
    else storage.setItem(PR_REVIEW_MODEL_STORAGE_KEY, "");
  } catch {
    // Private mode / quota: the choice still applies for this session.
  }
}

/**
 * Repositories pinned into the PR workspace tree, as `owner/name`.
 *
 * The analogue of projects in the Code workspace: the user picks which ones to
 * follow, and order is theirs to keep.
 */
export function loadPrRepos(storage: WorkspaceStorage): string[] {
  let raw: unknown;
  try {
    raw = JSON.parse(storage.getItem(PR_REPOS_STORAGE_KEY) || "null");
  } catch {
    return [];
  }
  if (!Array.isArray(raw)) return [];
  const seen = new Set<string>();
  const out: string[] = [];
  for (const v of raw) {
    if (typeof v !== "string") continue;
    const slug = v.trim();
    // Same shape the host enforces before the value reaches `gh`.
    if (!/^[A-Za-z0-9._-]+\/[A-Za-z0-9._-]+$/.test(slug)) continue;
    const key = slug.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(slug);
  }
  return out;
}

export function savePrRepos(
  storage: WorkspaceStorage,
  repos: string[],
): void {
  try {
    storage.setItem(PR_REPOS_STORAGE_KEY, JSON.stringify(repos));
  } catch {
    // Private mode / quota: the selection still holds for this session.
  }
}

/** Add a repository, keeping order and ignoring case-insensitive duplicates. */
export function addPrRepo(repos: string[], slug: string): string[] {
  const clean = slug.trim();
  if (!clean) return repos;
  const key = clean.toLowerCase();
  if (repos.some((r) => r.toLowerCase() === key)) return repos;
  return [...repos, clean];
}

export function removePrRepo(repos: string[], slug: string): string[] {
  const key = slug.trim().toLowerCase();
  return repos.filter((r) => r.toLowerCase() !== key);
}
