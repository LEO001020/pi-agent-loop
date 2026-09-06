/**
 * Composer project picker — a pill trigger (sits above the input) that opens
 * a searchable popover: recent / trusted projects, "+ New project", and the
 * git-worktree section when the active project is a work tree.
 */

import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
} from "react";
import { createPortal } from "react-dom";
import {
  IconCheck,
  IconFolder,
  IconPlus,
  IconSearch,
  IconTrash,
} from "@/components/icons";
import { Tip } from "@/components/ui/tooltip";
import { useFloatingMenu } from "@/lib/floatingMenu";
import { pathsEqual, worktreeLabel } from "@/lib/gitWorktree";
import type { GitWorktreeEntry } from "@/lib/api";

export type ProjectOption = {
  id: string;
  name: string;
  path: string;
  trusted: boolean;
  pathOk: boolean;
  pinned?: boolean;
};

type Props = {
  activeProject: ProjectOption | null;
  projects: ProjectOption[];
  labels: {
    pickProject: string;
    addProject: string;
    searchProjects: string;
    newProject: string;
    chooseProject: string;
    /** Template with a `{q}` placeholder for the empty-search state. */
    noProjectsMatch: string;
    worktrees: string;
    worktreesEmpty: string;
    worktreesUnavailable: string;
    worktreesLoading?: string;
    worktreeCurrent: string;
    worktreeSwitch: string;
    worktreeMain: string;
    worktreeDetached: string;
    /** Badge when project folder is missing on disk. */
    pathMissing?: string;
    /** New worktree… (create + switch). */
    worktreeNew?: string;
    /** New worktree & chat… (create + start draft chat there). */
    worktreeNewChat?: string;
    /** Clean stale worktree admin records (prune). */
    worktreeGc?: string;
  };
  /** Linked worktrees for the active project (loaded by parent). */
  worktrees?: GitWorktreeEntry[];
  /** Actual workspace root, including an SSH worktree when the runtime is remote. */
  currentWorkspacePath?: string | null;
  /**
   * `true` only after host confirmed a git work tree.
   * `false` = not a git repo / git missing — section hidden.
   * `null` / omitted = unknown (loading or no project) — section hidden.
   */
  worktreesAvailable?: boolean | null;
  worktreesLoading?: boolean;
  worktreesReason?: string | null;
  disabled?: boolean;
  onSelect: (project: ProjectOption | null) => void;
  onAdd: () => void;
  /** Switch agent cwd to this worktree path (add project if needed + bind). */
  onSwitchWorktree?: (wt: GitWorktreeEntry) => void;
  /** Open “New worktree…” dialog (parent owns modal). */
  onCreateWorktree?: () => void;
  /** Open create dialog then start a new chat bound to the worktree path. */
  onCreateWorktreeAndChat?: () => void;
  /** Open “Clean stale worktrees…” dialog (parent owns modal). */
  onGcWorktrees?: () => void;
  onOpen?: () => void;
};

const LIST_MAX_H = 248;

export function ComposerProjectMenu({
  activeProject,
  projects,
  labels,
  worktrees = [],
  currentWorkspacePath = null,
  worktreesAvailable = null,
  worktreesLoading = false,
  worktreesReason = null,
  disabled,
  onSelect,
  onAdd,
  onSwitchWorktree,
  onCreateWorktree,
  onCreateWorktreeAndChat,
  onGcWorktrees,
  onOpen,
}: Props) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const rootRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const popRef = useRef<HTMLDivElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  /** Avoid putting unstable parent callbacks in the open-effect deps. */
  const onOpenRef = useRef(onOpen);
  onOpenRef.current = onOpen;

  // Only for confirmed git work trees — hide while loading / non-git / no project.
  const showWorktrees =
    (!!activeProject || !!currentWorkspacePath) && worktreesAvailable === true;
  const canCreate = showWorktrees && !!onCreateWorktree && !!labels.worktreeNew;
  const canCreateChat =
    showWorktrees &&
    !!onCreateWorktreeAndChat &&
    !!labels.worktreeNewChat;
  const canGc = showWorktrees && !!onGcWorktrees && !!labels.worktreeGc;
  const actionRows =
    (canCreate ? 1 : 0) + (canCreateChat ? 1 : 0) + (canGc ? 1 : 0);

  const q = query.trim().toLowerCase();
  const filtered = useMemo(() => {
    if (!q) return projects;
    return projects.filter(
      (p) =>
        p.name.toLowerCase().includes(q) ||
        p.path.toLowerCase().includes(q),
    );
  }, [projects, q]);

  const estHeight = Math.min(
    440,
    48 +
      Math.min(LIST_MAX_H, Math.max(filtered.length, 1) * 40 + 8) +
      44 +
      (showWorktrees
        ? 28 +
          Math.min(160, Math.max(worktrees.length, 1) * 36 + 8) +
          actionRows * 36
        : 0),
  );
  const { pos, style: popStyle } = useFloatingMenu({
    open,
    triggerRef,
    panelRef: popRef,
    roots: [rootRef],
    onClose: () => setOpen(false),
    placement: "up",
    fitContent: true,
    minWidth: 268,
    estHeight,
    gap: 8,
    deps: [filtered.length, worktrees.length, showWorktrees, canCreate, canGc],
  });

  // Refresh list + focus the search field each time the menu opens.
  useEffect(() => {
    if (!open) {
      setQuery("");
      return;
    }
    onOpenRef.current?.();
    const t = window.setTimeout(() => searchRef.current?.focus(), 20);
    return () => window.clearTimeout(t);
  }, [open]);

  const activeMissing = activeProject?.pathOk === false;
  const triggerLabel = activeProject?.name ?? labels.chooseProject;
  const tip = activeMissing
    ? (labels.pathMissing
        ? `${labels.pathMissing}: ${activeProject?.path || ""}`.trim()
        : activeProject?.path) || labels.pickProject
    : activeProject?.path || labels.pickProject;

  return (
    <div ref={rootRef} className={`cpm${open ? " is-open" : ""}`}>
      <Tip label={tip} disabled={open}>
        <button
          ref={triggerRef}
          type="button"
          className={
            "cpm__trigger" +
            (open ? " is-open" : "") +
            (!activeProject ? " is-empty" : "") +
            (activeMissing ? " is-missing" : "")
          }
          disabled={disabled}
          aria-haspopup="menu"
          aria-expanded={open}
          aria-label={labels.pickProject}
          onClick={() => setOpen((v) => !v)}
        >
          <IconFolder size={14} aria-hidden />
          <span className="cpm__trigger-label">{triggerLabel}</span>
        </button>
      </Tip>
      {open &&
        pos &&
        typeof document !== "undefined" &&
        createPortal(
          <div
            ref={popRef}
            className="cmm__pop cmm__pop--portal cpm__pop"
            role="menu"
            aria-label={labels.pickProject}
            style={popStyle as CSSProperties}
          >
            <div className="cpm__search">
              <IconSearch size={14} aria-hidden />
              <input
                ref={searchRef}
                type="search"
                className="cpm__search-input"
                placeholder={labels.searchProjects}
                aria-label={labels.searchProjects}
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Escape" && query) {
                    e.stopPropagation();
                    setQuery("");
                  }
                }}
              />
            </div>

            {filtered.length > 0 ? (
              <div
                className="cpm__list"
                style={{ maxHeight: LIST_MAX_H }}
                role="group"
                aria-label={labels.pickProject}
              >
                {filtered.map((p) => {
                  const active = activeProject?.id === p.id;
                  const missing = p.pathOk === false;
                  return (
                    <button
                      key={p.id}
                      type="button"
                      role="menuitem"
                      className={
                        "cmm__opt cpm__item" +
                        (active ? " is-active" : "") +
                        (missing ? " cpm__item--path-missing" : "")
                      }
                      title={
                        missing && labels.pathMissing
                          ? `${labels.pathMissing}: ${p.path}`
                          : p.path
                      }
                      onClick={() => {
                        onSelect(p);
                        setOpen(false);
                      }}
                    >
                      <span className="cpm__item-ico" aria-hidden>
                        <IconFolder size={15} />
                      </span>
                      <span className="cmm__opt-main">
                        <span className="cmm__opt-title">{p.name}</span>
                        {missing && labels.pathMissing ? (
                          <span className="cpm__path-badge">
                            {labels.pathMissing}
                          </span>
                        ) : null}
                      </span>
                      {active ? (
                        <span className="cmm__opt-check" aria-hidden>
                          <IconCheck size={16} />
                        </span>
                      ) : null}
                    </button>
                  );
                })}
              </div>
            ) : (
              <p className="cpm__empty">
                {q
                  ? labels.noProjectsMatch.replace("{q}", query.trim())
                  : labels.searchProjects}
              </p>
            )}

            <div className="cpm__foot">
              <button
                type="button"
                role="menuitem"
                className="cpm__action cpm__action--new"
                onClick={() => {
                  setOpen(false);
                  onAdd();
                }}
              >
                <IconPlus size={15} aria-hidden />
                <span>{labels.newProject}</span>
              </button>
            </div>

            {showWorktrees ? (
              <div
                className="cpm__worktrees"
                role="group"
                aria-label={labels.worktrees}
              >
                <div className="cpm__worktrees-head">{labels.worktrees}</div>
                {worktrees.length > 0 ? (
                  <ul
                    className={
                      "cpm__worktrees-list" +
                      (worktreesLoading ? " is-loading" : "")
                    }
                    aria-busy={worktreesLoading || undefined}
                  >
                    {worktrees.map((wt) => {
                      const current = pathsEqual(
                        wt.path,
                        currentWorkspacePath || activeProject?.path,
                      );
                      const name = worktreeLabel(wt);
                      const meta = [
                        wt.isMain ? labels.worktreeMain : null,
                        wt.detached ? labels.worktreeDetached : null,
                        current ? labels.worktreeCurrent : null,
                      ]
                        .filter(Boolean)
                        .join(" · ");
                      return (
                        <li key={wt.path}>
                          <button
                            type="button"
                            role="menuitem"
                            className={
                              "cmm__opt cpm__item cpm__worktree" +
                              (current ? " is-active" : "")
                            }
                            title={wt.path}
                            disabled={current || !onSwitchWorktree}
                            onClick={() => {
                              if (current || !onSwitchWorktree) return;
                              setOpen(false);
                              onSwitchWorktree(wt);
                            }}
                          >
                            <span className="cpm__item-ico" aria-hidden>
                              <IconFolder size={15} />
                            </span>
                            <span className="cpm__worktree-row">
                              <span className="cpm__worktree-name">{name}</span>
                              {meta ? (
                                <span className="cpm__worktree-meta">
                                  {meta}
                                </span>
                              ) : null}
                            </span>
                            {current ? (
                              <span className="cmm__opt-check" aria-hidden>
                                <IconCheck size={16} />
                              </span>
                            ) : null}
                          </button>
                        </li>
                      );
                    })}
                  </ul>
                ) : (
                  <p className="cpm__worktrees-empty">
                    {worktreesReason?.trim()
                      ? labels.worktreesUnavailable
                      : labels.worktreesEmpty}
                  </p>
                )}
                {canCreate ? (
                  <button
                    type="button"
                    role="menuitem"
                    className="cpm__action cpm__worktree-new"
                    onClick={() => {
                      setOpen(false);
                      onCreateWorktree?.();
                    }}
                  >
                    <IconPlus size={14} aria-hidden />
                    <span>{labels.worktreeNew}</span>
                  </button>
                ) : null}
                {canCreateChat ? (
                  <button
                    type="button"
                    role="menuitem"
                    className="cpm__action cpm__worktree-new"
                    onClick={() => {
                      setOpen(false);
                      onCreateWorktreeAndChat?.();
                    }}
                  >
                    <IconPlus size={14} aria-hidden />
                    <span>{labels.worktreeNewChat}</span>
                  </button>
                ) : null}
                {canGc ? (
                  <button
                    type="button"
                    role="menuitem"
                    className="cpm__action cpm__worktree-gc"
                    onClick={() => {
                      setOpen(false);
                      onGcWorktrees?.();
                    }}
                  >
                    <IconTrash size={14} aria-hidden />
                    <span>{labels.worktreeGc}</span>
                  </button>
                ) : null}
              </div>
            ) : null}
          </div>,
          document.body,
        )}
    </div>
  );
}
