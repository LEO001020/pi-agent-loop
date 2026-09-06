/**
 * PR workspace sidebar — repositories and their open pull requests.
 *
 * The Code workspace's projects/chats tree, aimed at a forge instead of a
 * filesystem. Selecting a PR hands it to Pi as a review chat.
 *
 * Presentational: fetching is the caller's job, so this stays testable and the
 * loading policy lives in one place.
 */

import {
  IconChevronDown,
  IconChevronRight,
  IconPlus,
  IconTrash,
} from "@/components/icons";
import type { GhPullRequest } from "@/lib/api";

export type PrRepoState = {
  slug: string;
  expanded: boolean;
  loading: boolean;
  /** Null until first load; empty array means "loaded, none open". */
  pulls: GhPullRequest[] | null;
  error: string | null;
};

export function PrTree({
  repos,
  activePr,
  labels,
  onToggle,
  onAddRepo,
  onRemoveRepo,
  onOpenPr,
  onPostComment = () => undefined,
  reviewModelId = null,
  availableModels = [],
  onReviewModel = () => undefined,
  onMultiReview = () => undefined,
}: {
  repos: PrRepoState[];
  /** `owner/name#number` of the PR whose review chat is open. */
  activePr: string | null;
  labels: {
    repos: string;
    addRepo: string;
    removeRepo: string;
    empty: string;
    noPulls: string;
    loading: string;
    draft: string;
    reviewModel?: string;
    defaultModel?: string;
    comment?: string;
    multiReview?: string;
  };
  onToggle: (slug: string) => void;
  onAddRepo: () => void;
  onRemoveRepo: (slug: string) => void;
  onOpenPr: (slug: string, pr: GhPullRequest) => void;
  onPostComment?: (slug: string, pr: GhPullRequest) => void;
  reviewModelId?: string | null;
  availableModels?: Array<{ id: string; label: string }>;
  onReviewModel?: (modelId: string | null) => void;
  onMultiReview?: (slug: string, pr: GhPullRequest) => void;
}) {
  return (
    <div className="pr-tree">
      <div className="tree-section__head">
        <span className="tree-section__label">{labels.repos}</span>
        <label className="pr-tree__model">
          <span>{labels.reviewModel}</span>
          <select
            aria-label={labels.reviewModel}
            value={reviewModelId ?? ""}
            onChange={(event) => onReviewModel(event.target.value || null)}
          >
            <option value="">{labels.defaultModel}</option>
            {availableModels.map((model) => (
              <option value={model.id} key={model.id}>
                {model.label || model.id}
              </option>
            ))}
          </select>
        </label>
        <button
          type="button"
          className="tree-icon-btn"
          title={labels.addRepo}
          aria-label={labels.addRepo}
          onClick={onAddRepo}
        >
          <IconPlus size={14} />
        </button>
      </div>

      {repos.length === 0 ? (
        <p className="tree-empty">{labels.empty}</p>
      ) : (
        repos.map((repo) => (
          <div key={repo.slug} className="pr-tree__repo">
            <div className="pr-tree__repo-row">
              <button
                type="button"
                className="pr-tree__repo-btn"
                aria-expanded={repo.expanded}
                onClick={() => onToggle(repo.slug)}
              >
                <span className="pr-tree__chev" aria-hidden>
                  {repo.expanded ? (
                    <IconChevronDown size={13} />
                  ) : (
                    <IconChevronRight size={13} />
                  )}
                </span>
                <span className="pr-tree__repo-name">{repo.slug}</span>
                {repo.pulls && repo.pulls.length > 0 ? (
                  <span className="pr-tree__count">{repo.pulls.length}</span>
                ) : null}
              </button>
              <button
                type="button"
                className="tree-icon-btn"
                title={labels.removeRepo}
                aria-label={`${labels.removeRepo} ${repo.slug}`}
                onClick={() => onRemoveRepo(repo.slug)}
              >
                <IconTrash size={13} />
              </button>
            </div>

            {repo.expanded ? (
              <div className="pr-tree__pulls">
                {repo.loading ? (
                  <p className="tree-empty">{labels.loading}</p>
                ) : repo.error ? (
                  <p className="tree-empty tree-empty--error">{repo.error}</p>
                ) : !repo.pulls || repo.pulls.length === 0 ? (
                  <p className="tree-empty">{labels.noPulls}</p>
                ) : (
                  repo.pulls.map((pr) => {
                    const id = `${repo.slug}#${pr.number}`;
                    return (
                      <div key={id} className="pr-tree__pr-wrap">
                        <button
                          type="button"
                        className={
                          "pr-tree__pr" +
                          (activePr === id ? " pr-tree__pr--active" : "")
                        }
                        title={`#${pr.number} ${pr.title}`}
                        onClick={() => onOpenPr(repo.slug, pr)}
                        >
                          <span className="pr-tree__pr-num">#{pr.number}</span>
                          <span className="pr-tree__pr-title">{pr.title}</span>
                          {pr.isDraft ? (
                            <span className="pr-tree__badge">{labels.draft}</span>
                          ) : null}
                        </button>
                        <button
                          type="button"
                          className="tree-icon-btn pr-tree__comment"
                          title={labels.comment}
                          aria-label={`${labels.comment} #${pr.number}`}
                          onClick={() => onPostComment(repo.slug, pr)}
                        >
                          {"↗"}
                        </button>
                        <button
                          type="button"
                          className="tree-icon-btn pr-tree__comment"
                          title={labels.multiReview}
                          aria-label={`${labels.multiReview} #${pr.number}`}
                          onClick={() => onMultiReview(repo.slug, pr)}
                        >
                          {"2×"}
                        </button>
                      </div>
                    );
                  })
                )}
              </div>
            ) : null}
          </div>
        ))
      )}
    </div>
  );
}
