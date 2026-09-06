/**
 * Contribution-style activity heatmap — adapted from sister project pi-go.
 * Levels use GitHub-green palette; layout stretches cells to fill width.
 * Day detail tip is portaled (fixed) so overflow parents cannot clip it.
 */

import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import type { HeatmapDay } from "@/lib/api";
import { Tip } from "@/components/ui/tooltip";

type Metric = "requests" | "tokens";

type Cell = {
  date: string | null;
  day: HeatmapDay | null;
  value: number;
  level: 0 | 1 | 2 | 3 | 4;
  empty: boolean;
};

const GAP = 3;
const LABEL_COL = 22;
const MONTH_ROW = 16;
/** Prefer ≥10px so a full year (~53 weeks) stays readable when content is ≥ ~900px. */
const MIN_CELL = 10;
const MAX_CELL = 14;

const LEVEL_COLORS = [
  "var(--heatmap-0, #ebedf0)",
  "var(--heatmap-1, #9be9a8)",
  "var(--heatmap-2, #40c463)",
  "var(--heatmap-3, #30a14e)",
  "var(--heatmap-4, #216e39)",
] as const;

function metricValue(day: HeatmapDay, metric: Metric): number {
  if (metric === "tokens") return day.tokens;
  return day.requests;
}

function computeLevel(value: number, thresholds: number[]): 0 | 1 | 2 | 3 | 4 {
  if (value <= 0) return 0;
  if (value <= thresholds[0]!) return 1;
  if (value <= thresholds[1]!) return 2;
  if (value <= thresholds[2]!) return 3;
  return 4;
}

function levelThresholds(values: number[]): number[] {
  const positive = values.filter((v) => v > 0).sort((a, b) => a - b);
  if (positive.length === 0) return [1, 2, 3];
  const at = (p: number) => {
    const i = Math.min(
      positive.length - 1,
      Math.floor(p * (positive.length - 1)),
    );
    return positive[i]!;
  };
  const t1 = Math.max(at(0.25), Number.EPSILON);
  const t2 = Math.max(at(0.5), t1);
  const t3 = Math.max(at(0.75), t2);
  return [t1, t2, t3];
}

function parseYmd(date: string): Date {
  const [y, m, d] = date.split("-").map(Number);
  return new Date(y!, m! - 1, d);
}

function formatYmd(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function weekdaySun0(d: Date): number {
  return d.getDay();
}

function buildGrid(
  days: HeatmapDay[],
  metric: Metric,
): { weeks: Cell[][]; monthLabels: { week: number; label: string }[] } {
  if (days.length === 0) return { weeks: [], monthLabels: [] };

  const byDate = new Map(days.map((d) => [d.date, d]));
  const first = parseYmd(days[0]!.date);
  const last = parseYmd(days[days.length - 1]!.date);

  const start = new Date(first);
  start.setDate(start.getDate() - weekdaySun0(start));

  const end = new Date(last);
  end.setDate(end.getDate() + (6 - weekdaySun0(end)));

  const raw: {
    date: string | null;
    day: HeatmapDay | null;
    value: number;
    empty: boolean;
  }[] = [];
  for (let cur = new Date(start); cur <= end; cur.setDate(cur.getDate() + 1)) {
    const key = formatYmd(cur);
    const inRange = cur >= first && cur <= last;
    const day = byDate.get(key) ?? null;
    raw.push({
      date: inRange ? key : null,
      day: inRange ? day : null,
      value: day ? metricValue(day, metric) : 0,
      empty: !inRange,
    });
  }

  const thresholds = levelThresholds(
    raw.filter((c) => !c.empty).map((c) => c.value),
  );
  const cells: Cell[] = raw.map((c) => ({
    ...c,
    level: c.empty ? 0 : computeLevel(c.value, thresholds),
  }));

  const weeks: Cell[][] = [];
  for (let i = 0; i < cells.length; i += 7) {
    weeks.push(cells.slice(i, i + 7));
  }

  const monthLabels: { week: number; label: string }[] = [];
  let lastMonth = -1;
  weeks.forEach((week, wi) => {
    const sample = week.find((c) => c.date)?.date;
    if (!sample) return;
    const m = parseYmd(sample).getMonth();
    if (m !== lastMonth) {
      lastMonth = m;
      const next = { week: wi, label: sample.slice(5, 7) };
      const previous = monthLabels.at(-1);
      // A trailing-year range can begin in the last few days of a month.
      // Replace that fragment label so two month names never collide.
      if (previous && wi - previous.week < 3) {
        monthLabels[monthLabels.length - 1] = next;
      } else {
        monthLabels.push(next);
      }
    }
  });

  return { weeks, monthLabels };
}

export function Heatmap({
  days,
  metric = "requests",
  labels,
}: {
  days: HeatmapDay[];
  metric?: Metric;
  labels: {
    less: string;
    more: string;
    noData: string;
    aria: string;
    requests: string;
    tokens: string;
  };
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [containerWidth, setContainerWidth] = useState(0);
  /** Viewport coords for fixed portal tip (not clipped by overflow parents). */
  const [tip, setTip] = useState<{
    date: string;
    requests: number;
    tokens: number;
    left: number;
    top: number;
    placeAbove: boolean;
  } | null>(null);

  const { weeks, monthLabels } = useMemo(
    () => buildGrid(days, metric),
    [days, metric],
  );

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const ro = new ResizeObserver((entries) => {
      const w = entries[0]?.contentRect.width ?? 0;
      setContainerWidth(w);
    });
    ro.observe(el);
    setContainerWidth(el.clientWidth);
    return () => ro.disconnect();
  }, []);

  useEffect(() => {
    if (!tip) return;
    const onDown = (e: PointerEvent) => {
      const t = e.target as HTMLElement | null;
      if (t?.closest("[data-heatmap-tip]") || t?.closest("button[role='gridcell']"))
        return;
      setTip(null);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setTip(null);
    };
    const onScroll = () => setTip(null);
    document.addEventListener("pointerdown", onDown, true);
    document.addEventListener("keydown", onKey);
    // Any scroll (heatmap body / modal / window) can move the anchor — dismiss.
    window.addEventListener("scroll", onScroll, true);
    return () => {
      document.removeEventListener("pointerdown", onDown, true);
      document.removeEventListener("keydown", onKey);
      window.removeEventListener("scroll", onScroll, true);
    };
  }, [tip]);

  const cell = useMemo(() => {
    if (weeks.length === 0) return MIN_CELL;
    // Reserve a little right padding so the last month label is not clipped.
    const rightPad = 12;
    if (containerWidth <= 0) return MIN_CELL;
    const available = Math.max(0, containerWidth - LABEL_COL - rightPad);
    const size = Math.floor(
      (available - (weeks.length - 1) * GAP) / weeks.length,
    );
    return Math.max(MIN_CELL, Math.min(MAX_CELL, size));
  }, [containerWidth, weeks.length]);

  const dayLabels = useMemo(
    () => ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"],
    [],
  );

  const monthName = (mm: string) => {
    const idx = Number(mm) - 1;
    return (
      ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"][
        idx
      ] ?? mm
    );
  };

  if (weeks.length === 0) {
    return <div className="account-heatmap__empty">{labels.noData}</div>;
  }

  const graphWidth = weeks.length * (cell + GAP) - GAP;
  const graphHeight = 7 * (cell + GAP) - GAP;
  // Extra trailing space so the last month label is not cut at the card edge.
  const monthTrail = 16;
  const totalWidth = LABEL_COL + graphWidth + monthTrail;

  return (
    <div ref={containerRef} className="gh-heatmap">
      <div className="gh-heatmap__inner" style={{ width: totalWidth }}>
        <div
          className="gh-heatmap__months"
          style={{ height: MONTH_ROW, marginLeft: LABEL_COL }}
        >
          {monthLabels.map(({ week, label }) => (
            <span
              key={`${week}-${label}`}
              className="gh-heatmap__month"
              style={{ left: week * (cell + GAP) }}
            >
              {monthName(label)}
            </span>
          ))}
        </div>

        <div className="gh-heatmap__body">
          <div
            className="gh-heatmap__dow"
            style={{ width: LABEL_COL, height: graphHeight, gap: GAP }}
          >
            {dayLabels.map((label, i) => (
              <div
                key={label + i}
                className="gh-heatmap__dow-label"
                style={{
                  height: cell,
                  visibility: i % 2 === 1 ? "visible" : "hidden",
                }}
              >
                {label}
              </div>
            ))}
          </div>

          <div
            className="gh-heatmap__grid"
            role="grid"
            aria-label={labels.aria}
            style={{
              gridTemplateColumns: `repeat(${weeks.length}, ${cell}px)`,
              gridTemplateRows: `repeat(7, ${cell}px)`,
              columnGap: GAP,
              rowGap: GAP,
              width: graphWidth,
              height: graphHeight,
            }}
          >
            {weeks.map((week, wi) =>
              week.map((cellItem, di) => {
                const hoverLabel = cellItem.date
                  ? `${cellItem.date}: ${cellItem.value}`
                  : "";
                return (
                  <Tip
                    key={`${wi}-${di}`}
                    label={hoverLabel}
                    disabled={!hoverLabel}
                  >
                    <button
                      type="button"
                      role="gridcell"
                      disabled={cellItem.empty || !cellItem.date}
                      className={
                        "gh-heatmap__cell" +
                        (cellItem.empty ? " is-empty" : "") +
                        (tip?.date === cellItem.date ? " is-selected" : "")
                      }
                      style={{
                        gridColumn: wi + 1,
                        gridRow: di + 1,
                        width: cell,
                        height: cell,
                        backgroundColor: cellItem.empty
                          ? "transparent"
                          : LEVEL_COLORS[cellItem.level],
                      }}
                      onClick={(e) => {
                        if (!cellItem.date || cellItem.empty) return;
                        // Toggle off if same cell already open
                        if (tip?.date === cellItem.date) {
                          setTip(null);
                          return;
                        }
                        const rect = (
                          e.currentTarget as HTMLElement
                        ).getBoundingClientRect();
                        const tipW = 200;
                        const tipH = 78; // approx date + 2 rows
                        const gap = 8;
                        const pad = 8;
                        // Prefer above the cell; flip below if not enough room
                        const placeAbove = rect.top - tipH - gap >= pad;
                        let left = rect.left + rect.width / 2 - tipW / 2;
                        left = Math.min(
                          Math.max(pad, left),
                          Math.max(pad, window.innerWidth - tipW - pad),
                        );
                        const top = placeAbove
                          ? rect.top - gap
                          : rect.bottom + gap;
                        setTip({
                          date: cellItem.date,
                          requests: cellItem.day?.requests ?? 0,
                          tokens: cellItem.day?.tokens ?? 0,
                          left,
                          top,
                          placeAbove,
                        });
                      }}
                    />
                  </Tip>
                );
              }),
            )}
          </div>
        </div>

        <div className="gh-heatmap__legend">
          <span>{labels.less}</span>
          {LEVEL_COLORS.map((color, level) => (
            <span
              key={level}
              className="gh-heatmap__cell"
              style={{
                width: cell,
                height: cell,
                backgroundColor: color,
              }}
            />
          ))}
          <span>{labels.more}</span>
        </div>
      </div>

      {tip &&
        typeof document !== "undefined" &&
        createPortal(
          <div
            data-heatmap-tip
            className={
              "gh-heatmap__tip" +
              (tip.placeAbove
                ? " gh-heatmap__tip--above"
                : " gh-heatmap__tip--below")
            }
            role="tooltip"
            style={{
              left: tip.left,
              top: tip.top,
            }}
          >
            <div className="gh-heatmap__tip-date">{tip.date}</div>
            <div className="gh-heatmap__tip-row">
              <span>{labels.requests}</span>
              <span>{tip.requests}</span>
            </div>
            <div className="gh-heatmap__tip-row">
              <span>{labels.tokens}</span>
              <span>{tip.tokens.toLocaleString()}</span>
            </div>
          </div>,
          document.body,
        )}
    </div>
  );
}
