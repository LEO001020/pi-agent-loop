/**
 * PR workspace state: which repositories are followed, their open pull
 * requests, and opening one as a review chat.
 *
 * Extracted from `App.tsx` so the domain is readable on its own and the shell
 * keeps only the wiring. Everything it needs from the app arrives as injected
 * callbacks, the same shape `runTaskBatchWith` uses, so nothing here reaches
 * back into component state it does not own.
 */

import { useCallback, useState } from "react";
import * as api from "@/lib/api";
import type { GhPullRequest } from "@/lib/api";
import { buildPrReviewPrompt } from "@/lib/ghReview";
import { addPrRepo, loadPrRepos, removePrRepo, savePrRepos } from "@/lib/workspace";
import type { PrRepoState } from "@/components/PrTree";

/** Shape of an `owner/name` slug, matching what the host enforces. */
const REPO_SLUG = /^[A-Za-z0-9._-]+\/[A-Za-z0-9._-]+$/;

export interface PrWorkspaceDeps {
  /** Localised copy; same `tr` the shell uses. */
  tr: (key: string, vars?: Record<string, string | number>) => string;
  showToast: (message: string, ms?: number) => void;
  /** Opens the app's own dialog — never `window.confirm` (see dialogs.md). */
  openDialog: (dialog: PrWorkspaceDialog) => void;
  /** Starts a chat seeded with the review prompt. */
  startReviewChat: (seedDraft: string, modelId: string | null) => Promise<void>;
  reviewModelId?: string | null;
  postInlineComment?: (slug: string, pr: GhPullRequest) => void;
  startMultiReview?: (slug: string, pr: GhPullRequest) => void;
}

export type PrWorkspaceDialog =
  | {
      kind: "prompt";
      title: string;
      message: string;
      initial: string;
      placeholder: string;
      submitLabel: string;
      onSubmit: (value: string) => void;
    }
  | {
      kind: "confirm";
      title: string;
      message: string;
      danger: boolean;
      onConfirm: () => void;
    };

export interface PrWorkspace {
  repos: PrRepoState[];
  /** `owner/name#number` of the PR whose review chat is open. */
  activePr: string | null;
  toggleRepo: (slug: string) => void;
  addRepo: () => void;
  removeRepo: (slug: string) => void;
  openReview: (slug: string, pr: GhPullRequest) => void;
  postInlineComment: (slug: string, pr: GhPullRequest) => void;
  startMultiReview: (slug: string, pr: GhPullRequest) => void;
}

export function usePrWorkspace(deps: PrWorkspaceDeps): PrWorkspace {
  const {
    tr,
    showToast,
    openDialog,
    startReviewChat,
    reviewModelId = null,
    postInlineComment = () => undefined,
    startMultiReview = () => undefined,
  } = deps;

  const [repos, setRepos] = useState<PrRepoState[]>(() =>
    loadPrRepos(localStorage).map((slug) => ({
      slug,
      expanded: false,
      loading: false,
      pulls: null,
      error: null,
    })),
  );
  const [activePr, setActivePr] = useState<string | null>(null);

  const persist = useCallback((next: PrRepoState[]) => {
    savePrRepos(
      localStorage,
      next.map((r) => r.slug),
    );
    return next;
  }, []);

  /** Load a repository's open pull requests once, on first expand. */
  const loadPulls = useCallback((slug: string) => {
    setRepos((prev) =>
      prev.map((r) => (r.slug === slug ? { ...r, loading: true } : r)),
    );
    void (async () => {
      try {
        const pulls = await api.ghPrList({ repo: slug });
        setRepos((cur) =>
          cur.map((r) =>
            r.slug === slug ? { ...r, loading: false, pulls, error: null } : r,
          ),
        );
      } catch (e) {
        setRepos((cur) =>
          cur.map((r) =>
            r.slug === slug
              ? { ...r, loading: false, pulls: [], error: String(e) }
              : r,
          ),
        );
      }
    })();
  }, []);

  const toggleRepo = useCallback(
    (slug: string) => {
      setRepos((prev) => {
        const repo = prev.find((r) => r.slug === slug);
        if (!repo) return prev;
        const expanded = !repo.expanded;
        // Fetch only when opening something never loaded — collapsing and
        // re-opening must not hit the network again.
        if (expanded && repo.pulls === null && !repo.loading) {
          loadPulls(slug);
        }
        return prev.map((r) => (r.slug === slug ? { ...r, expanded } : r));
      });
    },
    [loadPulls],
  );

  const addRepo = useCallback(() => {
    void (async () => {
      const gh = await api.ghAvailable(null);
      if (!gh.installed) {
        showToast(tr("reviewPr.ghMissing"), 6000);
        return;
      }
      if (!gh.authenticated) {
        showToast(tr("reviewPr.ghUnauthenticated"), 6000);
        return;
      }
      let choices: string[] = [];
      try {
        choices = (await api.ghRepoList()).map((r) => r.nameWithOwner);
      } catch (e) {
        showToast(tr("pr.repoListFailed", { reason: String(e) }), 6000);
        return;
      }
      openDialog({
        kind: "prompt",
        title: tr("pr.addRepo"),
        message: choices.length
          ? tr("pr.addRepoHint", { sample: choices.slice(0, 3).join(", ") })
          : tr("pr.addRepoNoneFound"),
        initial: "",
        placeholder: "owner/name",
        submitLabel: tr("pr.addRepoSubmit"),
        onSubmit: (raw) => {
          const slug = raw.trim();
          if (!REPO_SLUG.test(slug)) {
            showToast(tr("pr.badRepo"));
            return;
          }
          setRepos((prev) => {
            const slugs = addPrRepo(
              prev.map((r) => r.slug),
              slug,
            );
            if (slugs.length === prev.length) return prev;
            return persist([
              ...prev,
              {
                slug,
                expanded: true,
                loading: false,
                pulls: null,
                error: null,
              },
            ]);
          });
          loadPulls(slug);
        },
      });
    })();
  }, [loadPulls, openDialog, persist, showToast, tr]);

  const removeRepo = useCallback(
    (slug: string) => {
      openDialog({
        kind: "confirm",
        title: tr("pr.removeRepo"),
        message: tr("pr.removeRepoConfirm", { name: slug }),
        danger: true,
        onConfirm: () => {
          setRepos((prev) => {
            const keep = removePrRepo(
              prev.map((r) => r.slug),
              slug,
            );
            return persist(prev.filter((r) => keep.includes(r.slug)));
          });
        },
      });
    },
    [openDialog, persist, tr],
  );

  const openReview = useCallback(
    (slug: string, pr: GhPullRequest) => {
      void (async () => {
        setActivePr(`${slug}#${pr.number}`);
        showToast(tr("reviewPr.loading", { number: pr.number }));
        try {
          const full = await api.ghPrDiff({ repo: slug }, pr.number);
          await startReviewChat(buildPrReviewPrompt(full), reviewModelId);
          showToast(
            tr("reviewPr.ready", {
              number: full.number,
              files: full.changedFiles,
            }),
          );
        } catch (e) {
          showToast(tr("reviewPr.failed", { reason: String(e) }), 6000);
        }
      })();
    },
    [reviewModelId, showToast, startReviewChat, tr],
  );

  return {
    repos,
    activePr,
    toggleRepo,
    addRepo,
    removeRepo,
    openReview,
    postInlineComment,
    startMultiReview,
  };
}
