import type { UsageDay } from "@/lib/api";

export type UsageTimelineView = "daily" | "weekly" | "cumulative";

const YEAR_DAYS = 365;

function parseLocalYmd(value: string): Date {
  const [year, month, day] = value.split("-").map(Number);
  return new Date(year!, month! - 1, day!, 12);
}

function formatLocalYmd(value: Date): string {
  const year = value.getFullYear();
  const month = String(value.getMonth() + 1).padStart(2, "0");
  const day = String(value.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function normalizedDay(day: UsageDay | undefined, date: string): UsageDay {
  return {
    date,
    activities: day?.activities ?? 0,
    estimatedTokens: day?.tokens ?? day?.estimatedTokens ?? 0,
  };
}

export function buildUsageTimeline(
  source: UsageDay[],
  view: UsageTimelineView,
  today = new Date(),
): UsageDay[] {
  const end = new Date(
    today.getFullYear(),
    today.getMonth(),
    today.getDate(),
    12,
  );
  const start = new Date(end);
  start.setDate(start.getDate() - (YEAR_DAYS - 1));

  const sourceByDate = new Map(source.map((day) => [day.date, day]));
  const daily: UsageDay[] = [];
  for (let cursor = new Date(start); cursor <= end; cursor.setDate(cursor.getDate() + 1)) {
    const date = formatLocalYmd(cursor);
    daily.push(normalizedDay(sourceByDate.get(date), date));
  }

  if (view === "daily") return daily;

  if (view === "cumulative") {
    let activities = 0;
    let estimatedTokens = 0;
    return daily.map((day) => {
      activities += day.activities;
      estimatedTokens += day.estimatedTokens ?? 0;
      return { ...day, activities, estimatedTokens };
    });
  }

  const weeklyTotals = new Map<
    string,
    Pick<UsageDay, "activities" | "estimatedTokens">
  >();
  for (const day of daily) {
    const date = parseLocalYmd(day.date);
    const weekStart = new Date(date);
    weekStart.setDate(weekStart.getDate() - weekStart.getDay());
    const key = formatLocalYmd(weekStart);
    const total = weeklyTotals.get(key) ?? {
      activities: 0,
      estimatedTokens: 0,
    };
    total.activities += day.activities;
    total.estimatedTokens =
      (total.estimatedTokens ?? 0) + (day.estimatedTokens ?? 0);
    weeklyTotals.set(key, total);
  }

  return daily.map((day) => {
    const date = parseLocalYmd(day.date);
    date.setDate(date.getDate() - date.getDay());
    const total = weeklyTotals.get(formatLocalYmd(date));
    return {
      date: day.date,
      activities: total?.activities ?? 0,
      estimatedTokens: total?.estimatedTokens ?? 0,
    };
  });
}
