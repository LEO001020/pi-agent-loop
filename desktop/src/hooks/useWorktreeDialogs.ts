/**
 * The two git-worktree dialogs: create one, and prune stale records.
 *
 * Lifted out of `App.tsx` without changing behaviour, with one boundary drawn:
 * creating a worktree also adopted the new path as a project — trust prompt,
 * session binding, opening a chat — which is the shell's business, not a
 * dialog's. That work leaves through `onCreated`, which turned five injected
 * dependencies into one.
 */

import { useCallback, useEffect, useState } from "react";
import * as api from "@/lib/api";
import {
  buildWorktreeSiblingPath,
  mainWorktreePath,
  sanitizeWorktreeName,
} from "@/lib/gitWorktree";

export interface WorktreeCreated {
  path: string;
  /** Directory name git gave the worktree. */
  name: string;
  /** Branch, or the localised placeholder when detached. */
  branch: string;
  /** The user asked for a chat on the new worktree. */
  startChat: boolean;
}

export interface WorktreeDialogsDeps {
  /** Repository the worktrees belong to; falsy disables both dialogs. */
  projectPath: string | null | undefined;
  /** Known worktrees, used to resolve the main one for the path preview. */
  worktrees: api.GitWorktreeEntry[];
  tr: (key: string, vars?: Record<string, string | number>) => string;
  showToast: (message: string, ms?: number) => void;
  /** Reload the worktree list after a change. */
  refreshWorktrees: () => Promise<void> | void;
  /** Hand the finished worktree to the shell to adopt. */
  onCreated: (created: WorktreeCreated) => Promise<void>;
}

export interface WorktreeDialogs {
  create: {
    open: boolean;
    name: string;
    startPoint: string;
    busy: boolean;
    error: string | null;
    /** Where the worktree will land, shown under the name field. */
    previewPath: string | null;
    /** Open a chat on the new worktree once it exists. */
    startChat: boolean;
    setStartChat: (v: boolean) => void;
    /** Typing clears a stale error, so the dialog stops shouting mid-fix. */
    setName: (v: string) => void;
    setStartPoint: (v: string) => void;
    openDialog: (opts?: { startNewChat?: boolean }) => void;
    /** Dismiss and reset, so the next open starts clean. */
    close: () => void;
    submit: () => Promise<void>;
  };
  gc: {
    open: boolean;
    force: boolean;
    busy: boolean;
    previewBusy: boolean;
    error: string | null;
    preview: api.GitWorktreeGcResult | null;
    setForce: (v: boolean) => void;
    openDialog: () => void;
    /** Dismiss and reset, so a stale preview never greets the next open. */
    close: () => void;
    submit: () => Promise<void>;
  };
}

export function useWorktreeDialogs(deps: WorktreeDialogsDeps): WorktreeDialogs {
  const { projectPath, worktrees, tr, showToast, refreshWorktrees, onCreated } =
    deps;

  const [createOpen, setCreateOpen] = useState(false);
  const [name, setName] = useState("");
  const [startPoint, setStartPoint] = useState("");
  const [createBusy, setCreateBusy] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);
  const [startChat, setStartChat] = useState(false);

  const [gcOpen, setGcOpen] = useState(false);
  const [force, setForce] = useState(false);
  const [gcBusy, setGcBusy] = useState(false);
  const [previewBusy, setPreviewBusy] = useState(false);
  const [gcError, setGcError] = useState<string | null>(null);
  const [preview, setPreview] = useState<api.GitWorktreeGcResult | null>(null);

  /** Editing any field clears the previous failure. */
  const editName = useCallback((v: string) => {
    setName(v);
    setCreateError(null);
  }, []);
  const editStartPoint = useCallback((v: string) => {
    setStartPoint(v);
    setCreateError(null);
  }, []);

  // ── Create ───────────────────────────────────────────────────────────────

  const openCreate = useCallback((opts?: { startNewChat?: boolean }) => {
    setName("");
    setStartPoint("");
    setCreateError(null);
    setCreateBusy(false);
    setStartChat(!!opts?.startNewChat);
    setCreateOpen(true);
  }, []);

  // New worktrees are siblings of the *main* one, which is not always the
  // project currently open — you can be working inside a worktree already.
  const previewPath = (() => {
    try {
      const main = mainWorktreePath(worktrees) || projectPath || "";
      if (!main || !name.trim()) return null;
      return buildWorktreeSiblingPath(main, name.trim());
    } catch {
      return null;
    }
  })();

  const submitCreate = useCallback(async () => {
    if (!api.isTauri() || !projectPath) return;
    const rawName = name.trim();
    if (!rawName) {
      setCreateError(tr("composer.worktreeNameRequired"));
      return;
    }
    let safeName: string;
    try {
      safeName = sanitizeWorktreeName(rawName);
    } catch {
      setCreateError(tr("composer.worktreeNameInvalid"));
      return;
    }
    setCreateBusy(true);
    setCreateError(null);
    try {
      const created = await api.gitWorktreeAdd(
        projectPath,
        safeName,
        startPoint.trim() || null,
      );
      setCreateOpen(false);
      await refreshWorktrees();
      await onCreated({
        path: created.path,
        name: created.name,
        branch:
          created.branch?.trim() ||
          created.name ||
          tr("composer.worktreeDetached"),
        startChat,
      });
    } catch (e) {
      setCreateError(String(e));
    } finally {
      setCreateBusy(false);
    }
  }, [
    name,
    onCreated,
    projectPath,
    refreshWorktrees,
    startChat,
    startPoint,
    tr,
  ]);

  // ── Prune ────────────────────────────────────────────────────────────────

  const closeCreate = useCallback(() => {
    setCreateOpen(false);
    setCreateError(null);
  }, []);

  const closeGc = useCallback(() => {
    setGcOpen(false);
    setGcError(null);
    setPreview(null);
    setForce(false);
  }, []);

  const openGc = useCallback(() => {
    setForce(false);
    setGcError(null);
    setGcBusy(false);
    setPreview(null);
    setGcOpen(true);
  }, []);

  /** Dry run, so the dialog can say what pruning would remove. */
  const refreshPreview = useCallback(async () => {
    if (!api.isTauri() || !projectPath || !gcOpen) return;
    setPreviewBusy(true);
    setGcError(null);
    try {
      setPreview(await api.gitWorktreeGc(projectPath, true, force));
    } catch (e) {
      setPreview(null);
      setGcError(String(e));
    } finally {
      setPreviewBusy(false);
    }
  }, [force, gcOpen, projectPath]);

  // The preview is only truthful for the options currently selected, so it is
  // recomputed when the dialog opens and whenever `force` changes.
  useEffect(() => {
    if (!gcOpen) return;
    void refreshPreview();
  }, [gcOpen, refreshPreview]);

  const submitGc = useCallback(async () => {
    if (!api.isTauri() || !projectPath) return;
    setGcBusy(true);
    setGcError(null);
    try {
      const res = await api.gitWorktreeGc(projectPath, false, force);
      setGcOpen(false);
      setPreview(null);
      setForce(false);
      await refreshWorktrees();
      const n = res.prunedCount ?? 0;
      showToast(
        n > 0
          ? tr("composer.worktreeGcDone", { n: String(n) })
          : tr("composer.worktreeGcDoneNone"),
        2800,
      );
    } catch (e) {
      setGcError(String(e));
    } finally {
      setGcBusy(false);
    }
  }, [force, projectPath, refreshWorktrees, showToast, tr]);

  return {
    create: {
      open: createOpen,
      name,
      startPoint,
      busy: createBusy,
      error: createError,
      previewPath,
      startChat,
      setStartChat,
      setName: editName,
      setStartPoint: editStartPoint,
      openDialog: openCreate,
      close: closeCreate,
      submit: submitCreate,
    },
    gc: {
      open: gcOpen,
      force,
      busy: gcBusy,
      previewBusy,
      error: gcError,
      preview,
      setForce,
      openDialog: openGc,
      close: closeGc,
      submit: submitGc,
    },
  };
}
