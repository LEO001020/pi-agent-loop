# Git worktrees

Community request: [issue #42](https://github.com/AJSubrizi/Pi-App/issues/42).

## Behavior

When the active project path is a git work tree, the composer **project chip** menu lists linked worktrees from:

```bash
git worktree list --porcelain
```

- Selecting a worktree binds the open session (or draft context) to that path as agent **cwd**.
- If the path is already a project, switch only; otherwise `project_add` (trust inherited from the current project when possible).
- Soft-fail when `git` is missing or the folder is not a repo (same spirit as Workspace Changes git status).
- **UI:** section is hidden until host confirms `available: true` (non-git / loading → no “GIT WORKTREES” block). Rows match project list height; branch + badges on one line.
- **Remove:** non-main rows expose Remove… → GlassModal confirm (`git worktree remove [--force]`). Main worktree is refused on the host. After success the list refreshes; if the session was on that path it leaves to the main worktree project (or clears). If an App project row still pointed at the deleted path, offer leave/remove that project entry only (other projects untouched).

### Create worktree

From the same menu:

- **New worktree…** — create + bind current session/cwd to the new path.
- **New worktree & chat…** — create, then open a **draft new chat** whose project path is the worktree (agent cwd).

1. User enters a **name** (required) and optional **start point** (branch / tag / commit).
2. Host runs `git worktree add -b <name> <path> [<start_point>]` with argv (no shell).
3. On success: refresh the list, `project_add` with trust inherited from the source project when possible, then either bind the open session or call `newChat(worktreeProject)`.

**Path layout (sibling of main worktree):**

```text
<main_parent>/<main_basename>-<name>
```

Example: main `/Users/me/repo` + name `feat` → `/Users/me/repo-feat`.

| Choice | Why |
|--------|-----|
| **Sibling** `../<repo>-<name>` (preferred) | Matches common `git worktree add ../repo-feat` practice; checkouts sit next to the primary clone; same pattern as porcelain list samples. |
| In-repo `.worktrees/<name>` | Avoided for create — keeps build/tooling ignore noise out of the main tree and matches sibling-first docs. |

Name rules: letters, digits, `.` `_` `-` only; max 64; no path separators; must not start with `-` (so it cannot look like a git flag).

Errors when the folder is not a git repository, `git` is missing, the path already exists, or `git worktree add` fails (message surfaced in the dialog).

## Non-goals (MVP)

- Removing / pruning worktrees from the App
- Full branch browser / remote fetch UI

## Implementation

- Host: `git_worktrees_list`, `git_worktree_add` (`src-tauri/src/commands.rs`)
- Pure path / name helpers: `sanitize_worktree_name`, `build_worktree_sibling_path` (+ unit tests)
- Frontend pure helpers: `src/lib/gitWorktree.ts` (+ unit tests)
- UI: `ComposerProjectMenu` worktrees section + create dialog in `App.tsx`
- Creating worktrees from the App (see separate worktree-create PR when open)
- **GC / prune:** menu action **Clean stale worktrees…** → GlassModal dry-run preview (`git worktree prune -v --dry-run`), then apply. Optional force → `--expire now`. Does **not** delete live worktrees (use remove for that). Host: `git_worktree_gc`.

## Non-goals (MVP)

- Creating or removing individual worktrees from the App (separate PRs when open)
- Full branch browser

## Implementation

- Host: `git_worktrees_list`, `git_worktree_remove` (`src-tauri/src/commands.rs`) — argv only, no shell
- Pure path helpers + refuse-main tests on the host; parse helpers: `src/lib/gitWorktree.ts` (+ unit tests)
- UI: `ComposerProjectMenu` worktrees section + remove confirm in `App.tsx`
- Host: `git_worktrees_list`, `git_worktree_gc` (`src-tauri/src/commands.rs`) — argv only, no shell
- Pure parse + gc arg builders: `src/lib/gitWorktree.ts` (+ unit tests); host `build_worktree_gc_args`
- UI: `ComposerProjectMenu` worktrees section + gc confirm in `App.tsx`
