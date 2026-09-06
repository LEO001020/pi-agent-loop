/**
 * Global activity state for the workbench.
 *
 * The session manager remains the source of truth for execution. This module
 * only keeps the user's attention history: what needs a decision, what
 * failed, and what finished while another session was focused.
 */

export type ActivityStatus =
  | "queued"
  | "running"
  | "awaiting_permission"
  | "awaiting_input"
  | "awaiting_plan"
  | "stalled"
  | "failed"
  | "interrupted"
  | "completed";

export type ActivitySource =
  | "session"
  | "permission"
  | "input"
  | "plan"
  | "retry"
  | "error"
  | "stall"
  | "marker"
  | "batch";

export interface ActivityItem {
  id: string;
  sessionId: string;
  projectId: string | null;
  projectName: string | null;
  title: string;
  modelId: string | null;
  status: ActivityStatus;
  detail: string | null;
  source: ActivitySource;
  createdAt: string;
  updatedAt: string;
  unread: boolean;
  pinned: boolean;
  dismissed: boolean;
}

export type ActivityPatch = Pick<
  ActivityItem,
  "sessionId" | "status"
> &
  Partial<
    Pick<
      ActivityItem,
      | "projectId"
      | "projectName"
      | "title"
      | "modelId"
      | "detail"
      | "source"
      | "unread"
    >
  > & { id?: string; now?: string };

export const ACTIVITY_STORAGE_KEY = "pi-app.activity.v1";
const MAX_ACTIVITY_ITEMS = 80;

export const ACTIVE_ACTIVITY_STATUSES: readonly ActivityStatus[] = [
  "queued",
  "running",
  "awaiting_permission",
  "awaiting_input",
  "awaiting_plan",
  "stalled",
];

export const ATTENTION_ACTIVITY_STATUSES: readonly ActivityStatus[] = [
  "awaiting_permission",
  "awaiting_input",
  "awaiting_plan",
  "stalled",
  "failed",
  "interrupted",
];

export function activityId(sessionId: string): string {
  return `session:${sessionId}`;
}

export function isActivityActive(status: ActivityStatus): boolean {
  return ACTIVE_ACTIVITY_STATUSES.includes(status);
}

export function needsActivityAttention(status: ActivityStatus): boolean {
  return ATTENTION_ACTIVITY_STATUSES.includes(status);
}

function isActivityStatus(value: unknown): value is ActivityStatus {
  return (
    value === "queued" ||
    value === "running" ||
    value === "awaiting_permission" ||
    value === "awaiting_input" ||
    value === "awaiting_plan" ||
    value === "stalled" ||
    value === "failed" ||
    value === "interrupted" ||
    value === "completed"
  );
}

function isActivitySource(value: unknown): value is ActivitySource {
  return (
    value === "session" ||
    value === "permission" ||
    value === "input" ||
    value === "plan" ||
    value === "retry" ||
    value === "error" ||
    value === "stall" ||
    value === "marker" ||
    value === "batch"
  );
}

function safeText(value: unknown, fallback: string | null = null): string | null {
  if (typeof value !== "string") return fallback;
  const text = value.trim();
  return text ? text.slice(0, 600) : fallback;
}

function normalizeItem(value: unknown): ActivityItem | null {
  if (!value || typeof value !== "object") return null;
  const row = value as Partial<ActivityItem>;
  if (typeof row.sessionId !== "string" || !row.sessionId.trim()) return null;
  if (!isActivityStatus(row.status)) return null;
  const now = new Date().toISOString();
  return {
    id: safeText(row.id, activityId(row.sessionId)) || activityId(row.sessionId),
    sessionId: row.sessionId,
    projectId: typeof row.projectId === "string" ? row.projectId : null,
    projectName: safeText(row.projectName),
    title: safeText(row.title, row.sessionId) || row.sessionId,
    modelId: safeText(row.modelId),
    status: row.status,
    detail: safeText(row.detail),
    source: isActivitySource(row.source) ? row.source : "session",
    createdAt: typeof row.createdAt === "string" ? row.createdAt : now,
    updatedAt: typeof row.updatedAt === "string" ? row.updatedAt : now,
    unread: row.unread !== false,
    pinned: row.pinned === true,
    dismissed: row.dismissed === true,
  };
}

function sortValue(item: ActivityItem): number {
  const pinned = item.pinned ? 1_000_000_000_000 : 0;
  const attention = needsActivityAttention(item.status) ? 100_000_000_000 : 0;
  const active = isActivityActive(item.status) ? 10_000_000_000 : 0;
  const updated = Date.parse(item.updatedAt) || 0;
  return pinned + attention + active + updated;
}

export function sortActivity(items: ActivityItem[]): ActivityItem[] {
  return [...items].sort((a, b) => sortValue(b) - sortValue(a));
}

/**
 * Upsert one session's latest attention state.
 * Repeated polling with identical data is intentionally a no-op, so the
 * center does not reorder or dirty local storage every 1.5 seconds.
 */
export function upsertActivity(
  items: ActivityItem[],
  patch: ActivityPatch,
  fallbackNow = new Date().toISOString(),
): ActivityItem[] {
  const now = patch.now || fallbackNow;
  const id = patch.id || activityId(patch.sessionId);
  const index = items.findIndex((item) => item.id === id);
  const previous = index >= 0 ? items[index]! : null;
  const statusChanged = previous !== null && previous.status !== patch.status;
  const changed =
    !previous ||
    statusChanged ||
    (patch.title !== undefined && patch.title !== previous.title) ||
    (patch.modelId !== undefined && patch.modelId !== previous.modelId) ||
    (patch.detail !== undefined && patch.detail !== previous.detail) ||
    (patch.projectId !== undefined && patch.projectId !== previous.projectId) ||
    (patch.projectName !== undefined && patch.projectName !== previous.projectName);

  if (!changed && previous) return items;

  const next: ActivityItem = {
    id,
    sessionId: patch.sessionId,
    projectId: patch.projectId !== undefined ? patch.projectId : previous?.projectId ?? null,
    projectName:
      patch.projectName !== undefined
        ? patch.projectName
        : previous?.projectName ?? null,
    title: patch.title !== undefined ? patch.title : previous?.title || patch.sessionId,
    modelId: patch.modelId !== undefined ? patch.modelId : previous?.modelId ?? null,
    status: patch.status,
    detail: patch.detail !== undefined ? patch.detail : previous?.detail ?? null,
    source: patch.source || previous?.source || "session",
    createdAt: previous?.createdAt || now,
    updatedAt: now,
    unread:
      patch.unread !== undefined
        ? patch.unread
        : previous
          ? statusChanged || previous.unread
          : true,
    pinned: previous?.pinned ?? false,
    dismissed: statusChanged ? false : previous?.dismissed ?? false,
  };

  const nextItems = index >= 0
    ? items.map((item, i) => (i === index ? next : item))
    : [...items, next];
  return sortActivity(nextItems).slice(0, MAX_ACTIVITY_ITEMS);
}

export function markActivityRead(
  items: ActivityItem[],
  id: string,
): ActivityItem[] {
  return items.map((item) =>
    item.id === id ? { ...item, unread: false } : item,
  );
}

export function toggleActivityPin(
  items: ActivityItem[],
  id: string,
): ActivityItem[] {
  return sortActivity(
    items.map((item) =>
      item.id === id ? { ...item, pinned: !item.pinned } : item,
    ),
  );
}

export function dismissActivity(
  items: ActivityItem[],
  id: string,
): ActivityItem[] {
  return items.filter((item) => item.id !== id || item.pinned);
}

export function loadActivity(storage: Pick<Storage, "getItem"> = localStorage): ActivityItem[] {
  try {
    const raw = storage.getItem(ACTIVITY_STORAGE_KEY);
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return sortActivity(parsed.map(normalizeItem).filter((item): item is ActivityItem => !!item));
  } catch {
    return [];
  }
}

export function saveActivity(
  storage: Pick<Storage, "setItem"> = localStorage,
  items: ActivityItem[],
): void {
  try {
    storage.setItem(ACTIVITY_STORAGE_KEY, JSON.stringify(items.slice(0, MAX_ACTIVITY_ITEMS)));
  } catch {
    // A storage quota or private-mode failure must not affect session execution.
  }
}

