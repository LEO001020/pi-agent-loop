# Agent GUI reference notes

Local reference clone: `.refs/aider-desk` (gitignored — do not commit).

## Where the ideas came from

| Source | Borrowed idea | Implemented as |
|--------|---------------|----------------|
| **AiderDesk** `ProjectFilesSection` / `FileViewerModal` | Project file tree + read-only file preview + search/refresh | `ResourceViewer` + `fs_list_dir` / `fs_read_file` |
| **Pi permission docs** | `default` / `acceptEdits` / `dontAsk` / `bypassPermissions` | `PERMISSION_POLICIES` + host `PermissionPolicy` |
| **Product sheet UI (reference mock)** | Two chips: model + effort / access (mode and permission merged); narrow widths collapse to short copy or icon only | `ComposerModelMenu` · `ComposerAccessMenu` |
| **OpenHands Canvas / common three-column** | Chats left, conversation centre, resources right; side panels closable | `sidebar--hidden` / `aside--hidden` + top-bar icons |
| **Session change review (L06)** | List of files the agent wrote/changed + unified diff / open in external editor | `ResourceViewer` Changes mode + `sessionChanges` + optional `git_file_diff` |
| **Workspace git changes** | Project `git status` list + click to see the diff | `git_status` / `git_show_file` + Changes → **Workspace** section |
| **Plan review** | Full pending-plan markdown + approve/request changes | `ResourceViewer` **Plan** mode + sticky `PlanStatusBar` |

## Interaction rules

1. Left and right panels close **completely** (width 0, no icon rail); the top bar's `IconPanel` / `IconFiles` toggle them.
2. The right panel is the current project's resource viewer (session project path), with multi-format preview (text/code/md/json/csv/html/image/svg/pdf/audio/video).
3. The composer's model area collapses into the ⚡ menu: model / reasoning effort / permission mode; session mode lives under advanced.
4. **Changes (session + workspace)**: diff icon in the right-panel chrome + a **Files | Changes** toggle in the sidebar.
   - **Session**: write/edit-class tools from `session://tool` (`isEditToolKind`) plus historical `tool_step` messages.
   - **Workspace**: `git_status` on the project path (soft-fails when there is no git / not a repository); refresh button; branch name hint.
   - Clicking an entry: prefer the tool payload's before/after → local unified diff; else `git_file_diff`; else `git_show_file` (HEAD) + working-tree content; else the current file content.
   - Row actions: open in editor / reveal / copy path. Discard is deliberately **not** offered, so the working tree cannot be wiped by accident.
   - Pure helpers: `src/lib/sessionChanges.ts`, `src/lib/workspaceGit.ts`.
5. **Plan (resource review)**: the top bar's "open in resources", or `exit_plan_mode` becoming ready, switches the right panel to **Plan** mode automatically.
   - Body: `MarkdownBody` (`planContent` when present, otherwise markdown synthesised from entries).
   - Actions: approve / request changes / close (sharing `sessionResolvePlan` with the top bar).
   - A compact preview card stays in the thread; the full review surface is the resource panel.
   - Helpers: `src/lib/planBody.ts`, `PlanReviewPanel`.
