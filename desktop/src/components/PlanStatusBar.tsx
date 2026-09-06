/** Sticky plan/goal strip — stays put while the in-thread plan card scrolls away. */

import { useMemo } from "react";
import { IconCheck, IconPlan, IconClose } from "@/components/icons";
import {
  canExitPlanMode,
  formatPlanFraction,
  resolvePlanBarModel,
  shouldShowPlanBar,
  type PlanBarModel,
} from "@/lib/planStatus";

export type PlanStatusBarLabels = {
  goal: string;
  planMode: string;
  progress: string;
  review: string;
  done: string;
  fraction: string;
  current: string;
  approve: string;
  changes: string;
  dismiss: string;
  expand: string;
  /** Exit goal mode (goal strip only). */
  clearGoal: string;
  exitPlanMode: string;
  aria: string;
};

export type PlanStatusBarProps = {
  goalMode: boolean;
  mode: string;
  planVisible: boolean;
  planWaiting: boolean;
  planRpcId?: number | null;
  entries: unknown[];
  labels: PlanStatusBarLabels;
  onApprove?: () => void;
  onRequestChanges?: () => void;
  onDismiss?: () => void;
  /** Exit goal mode from the sticky goal strip. */
  onClearGoal?: () => void;
  /** Return the composer to agent mode when no plan review gate is pending. */
  onExitPlanMode?: () => void;
  /** Scroll / focus the in-thread plan card when present. */
  onOpenDetails?: () => void;
};

function headlineFor(model: PlanBarModel, labels: PlanStatusBarLabels): string {
  switch (model.headlineKey) {
    case "planBar.goal":
      return labels.goal;
    case "planBar.planMode":
      return labels.planMode;
    case "planBar.progress":
      return labels.progress;
    case "planBar.review":
      return labels.review;
    case "planBar.done":
      return labels.done;
    default:
      return labels.planMode;
  }
}

export function PlanStatusBar({
  goalMode,
  mode,
  planVisible,
  planWaiting,
  planRpcId = null,
  entries,
  labels,
  onApprove,
  onRequestChanges,
  onDismiss,
  onClearGoal,
  onExitPlanMode,
  onOpenDetails,
}: PlanStatusBarProps) {
  const model = useMemo(
    () =>
      resolvePlanBarModel({
        goalMode,
        mode,
        planVisible,
        planWaiting,
        planRpcId,
        entries,
      }),
    [goalMode, mode, planVisible, planWaiting, planRpcId, entries],
  );

  if (!shouldShowPlanBar(model)) return null;

  const fraction = formatPlanFraction(model.progress);
  const headline = headlineFor(model, labels);
  const showExitPlanMode = canExitPlanMode({ mode, planRpcId });
  const kindClass =
    model.kind === "goal"
      ? "plan-bar--goal"
      : model.kind === "plan_review"
        ? "plan-bar--review"
        : model.kind === "plan_progress"
          ? "plan-bar--progress"
          : "plan-bar--mode";

  return (
    <div
      className={`plan-bar ${kindClass}`}
      role="status"
      aria-live="polite"
      aria-label={labels.aria}
      data-testid="plan-status-bar"
      data-kind={model.kind}
    >
      <div className="plan-bar__main">
        <span className="plan-bar__icon" aria-hidden>
          {model.headlineKey === "planBar.done" ? (
            <IconCheck size={14} />
          ) : (
            <IconPlan size={14} />
          )}
        </span>
        <div className="plan-bar__text">
          <div className="plan-bar__headline">
            <strong>{headline}</strong>
            {fraction ? (
              <span className="plan-bar__fraction">
                {labels.fraction.replace("{n}", fraction)}
              </span>
            ) : null}
          </div>
          {model.currentLabel ? (
            <div className="plan-bar__current" title={model.currentLabel}>
              <span className="plan-bar__current-label">{labels.current}</span>
              <span className="plan-bar__current-step">{model.currentLabel}</span>
            </div>
          ) : null}
        </div>
      </div>

      {model.progress.total > 0 ? (
        <div
          className="plan-bar__meter"
          role="progressbar"
          aria-valuemin={0}
          aria-valuemax={model.progress.total}
          aria-valuenow={model.progress.completed}
          aria-label={fraction || headline}
        >
          <div
            className="plan-bar__meter-fill"
            style={{ width: `${model.progress.percent}%` }}
          />
        </div>
      ) : null}

      <div className="plan-bar__actions">
        {planVisible && onOpenDetails ? (
          <button
            type="button"
            className="btn btn--ghost btn--sm plan-bar__btn"
            onClick={onOpenDetails}
          >
            {labels.expand}
          </button>
        ) : null}
        {model.showActions && onApprove ? (
          <button
            type="button"
            className="btn btn--solid btn--sm plan-bar__btn"
            onClick={onApprove}
          >
            {labels.approve}
          </button>
        ) : null}
        {model.showActions && onRequestChanges ? (
          <button
            type="button"
            className="btn btn--ghost btn--sm plan-bar__btn"
            onClick={onRequestChanges}
          >
            {labels.changes}
          </button>
        ) : null}
        {model.kind === "goal" && onClearGoal ? (
          <button
            type="button"
            className="btn btn--ghost btn--sm plan-bar__btn plan-bar__btn--clear-goal"
            onClick={onClearGoal}
            data-testid="plan-status-clear-goal"
            title={labels.clearGoal}
          >
            <IconClose size={12} />
            <span>{labels.clearGoal}</span>
          </button>
        ) : null}
        {showExitPlanMode && onExitPlanMode ? (
          <button
            type="button"
            className="btn btn--ghost btn--sm plan-bar__btn"
            onClick={onExitPlanMode}
          >
            {labels.exitPlanMode}
          </button>
        ) : null}
        {(model.kind === "plan_progress" ||
          model.kind === "plan_review" ||
          planVisible) &&
        onDismiss ? (
          <button
            type="button"
            className="icon-btn plan-bar__close"
            onClick={onDismiss}
            aria-label={labels.dismiss}
            title={labels.dismiss}
          >
            <IconClose size={14} />
          </button>
        ) : null}
      </div>
    </div>
  );
}
