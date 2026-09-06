/**
 * Cache hit rate for the current session, next to the context chip.
 *
 * Fed by `session://usage`, which carries the figures Pi already reports —
 * these are measured, not the chars/4 estimate the shell shows elsewhere.
 */

import { Tip } from "@/components/ui/tooltip";
import { IconActivity } from "@/components/icons";
import { cacheChipView, type UsagePayload } from "@/lib/cacheUsage";

export type CacheChipLabels = {
  /** e.g. "Cache" */
  title: string;
  tipCold: string;
  tipWarming: string;
  tipGood: string;
  prompt: string;
  cached: string;
  output: string;
  cost: string;
  breakHint?: string;
};

export function CacheChip({
  usage,
  viewedSessionId,
  labels,
  breakHint,
}: {
  usage: UsagePayload | null;
  /** Figures from another chat are not shown. */
  viewedSessionId: string | null;
  labels: CacheChipLabels;
  breakHint?: string;
}) {
  const view = cacheChipView(usage, viewedSessionId);
  // Nothing measured yet: no chip, rather than a 0% that reads as failure.
  if (!view) return null;

  const tip =
    view.standing === "good"
      ? labels.tipGood
      : view.standing === "warming"
        ? labels.tipWarming
        : labels.tipCold;

  const detail = [
    `${labels.prompt}: ${view.promptTokens}`,
    `${labels.cached}: ${view.cachedTokens}`,
    `${labels.output}: ${view.outputTokens}`,
    view.costLabel ? `${labels.cost}: ${view.costLabel}` : null,
  ]
    .filter(Boolean)
    .join(" · ");

  // A note leads, replacing the band tip rather than trailing it. The cold tip
  // reads "most of the prompt is being resent" — true but alarming, and on a
  // session's first turn it describes something unavoidable. Leaving it in
  // front and appending the explanation is how a healthy provider gets read as
  // broken, which is the misreading this note exists to prevent.
  const headline = breakHint || tip;

  return (
    <Tip label={`${headline}\n${detail}`}>
      <span
        className={`cache-chip cache-chip--${view.standing}`}
        // The headline belongs here too, not only in the hover tooltip: it is
        // the part that explains the number, and a screen reader (or anyone not
        // hovering) would otherwise get the figures with none of the meaning.
        aria-label={`${labels.title} ${view.rateLabel} — ${headline} — ${detail}`}
      >
        <IconActivity size={13} />
        <span className="cache-chip__rate">{view.rateLabel}</span>
      </span>
    </Tip>
  );
}
