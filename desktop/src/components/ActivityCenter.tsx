import {
  IconAlertTriangle,
  IconCheck,
  IconClock,
  IconClose,
  IconList,
  IconPin,
  IconPinOff,
  IconRefresh,
  IconStop,
} from "@/components/icons";
import { useState } from "react";
import {
  needsActivityAttention,
  type ActivityItem,
  type ActivityStatus,
} from "@/lib/activity";

type T = (key: string, vars?: Record<string, string | number>) => string;
type ActivityFilter = "all" | "attention" | "active" | "completed";

function statusKey(status: ActivityStatus): string {
  return `activity.status.${status}`;
}

function statusClass(status: ActivityStatus): string {
  if (status === "completed") return "done";
  if (status === "failed" || status === "stalled" || status === "interrupted") return "danger";
  if (status === "awaiting_permission" || status === "awaiting_input" || status === "awaiting_plan") return "attention";
  return "active";
}

function isStoppable(status: ActivityStatus): boolean {
  return status === "queued" || status === "running" || status === "awaiting_permission" || status === "awaiting_input" || status === "awaiting_plan" || status === "stalled";
}

export function ActivityCenter({
  items,
  open,
  onToggle,
  onOpenSession,
  onStopSession,
  onRetry,
  onMarkRead,
  onTogglePin,
  onDismiss,
  t,
}: {
  items: ActivityItem[];
  open: boolean;
  onToggle: () => void;
  onOpenSession: (item: ActivityItem) => void;
  onStopSession: (item: ActivityItem) => void;
  onRetry: (item: ActivityItem) => void;
  onMarkRead: (id: string) => void;
  onTogglePin: (id: string) => void;
  onDismiss: (id: string) => void;
  t: T;
}) {
  const unread = items.filter((item) => item.unread).length;
  return (
    <div className="activity-center">
      <button
        type="button"
        className={"chrome-btn activity-center__trigger" + (open ? " is-on" : "")}
        aria-label={t(open ? "activity.close" : "activity.open")}
        aria-expanded={open}
        aria-haspopup="dialog"
        onClick={onToggle}
      >
        <IconList size={16} />
        {unread > 0 ? (
          <span className="activity-center__count" aria-label={t("activity.unread", { n: unread })}>
            {Math.min(99, unread)}
          </span>
        ) : null}
      </button>
      {open ? (
        <ActivityPanel
          items={items}
          onOpenSession={onOpenSession}
          onStopSession={onStopSession}
          onRetry={onRetry}
          onMarkRead={onMarkRead}
          onTogglePin={onTogglePin}
          onDismiss={onDismiss}
          t={t}
        />
      ) : null}
    </div>
  );
}

function ActivityPanel({
  items,
  onOpenSession,
  onStopSession,
  onRetry,
  onMarkRead,
  onTogglePin,
  onDismiss,
  t,
}: {
  items: ActivityItem[];
  onOpenSession: (item: ActivityItem) => void;
  onStopSession: (item: ActivityItem) => void;
  onRetry: (item: ActivityItem) => void;
  onMarkRead: (id: string) => void;
  onTogglePin: (id: string) => void;
  onDismiss: (id: string) => void;
  t: T;
}) {
  const [filter, setFilter] = useState<ActivityFilter>("all");
  const visible = items.filter((item) => {
    if (filter === "attention") return needsActivityAttention(item.status);
    if (filter === "active") return item.status === "queued" || item.status === "running";
    if (filter === "completed") return item.status === "completed";
    return true;
  });

  return (
    <section className="activity-center__panel" role="dialog" aria-label={t("activity.title")}>
      <header className="activity-center__head">
        <div>
          <h2>{t("activity.title")}</h2>
          <p>{t("activity.subtitle")}</p>
        </div>
        <span className="activity-center__summary">{t("activity.total", { n: items.length })}</span>
      </header>
      <div className="activity-center__filters" role="tablist" aria-label={t("activity.filters")}>
        {(["all", "attention", "active", "completed"] as ActivityFilter[]).map((value) => (
          <button
            key={value}
            type="button"
            role="tab"
            aria-selected={filter === value}
            className={filter === value ? "is-active" : ""}
            onClick={() => setFilter(value)}
          >
            {t(`activity.filter.${value}`)}
          </button>
        ))}
      </div>
      <div className="activity-center__list">
        {visible.length === 0 ? (
          <div className="activity-center__empty">
            <IconCheck size={18} />
            <span>{t(filter === "all" ? "activity.empty" : "activity.emptyFilter")}</span>
          </div>
        ) : (
          visible.map((item) => (
            <article
              key={item.id}
              className={`activity-row activity-row--${statusClass(item.status)}${item.unread ? " is-unread" : ""}${item.pinned ? " is-pinned" : ""}`}
            >
              <button
                type="button"
                className="activity-row__main"
                onClick={() => {
                  onMarkRead(item.id);
                  onOpenSession(item);
                }}
              >
                <span className="activity-row__status" aria-hidden>
                  {item.status === "completed" ? <IconCheck size={14} /> : item.status === "failed" || item.status === "stalled" || item.status === "interrupted" ? <IconAlertTriangle size={14} /> : item.status === "awaiting_permission" || item.status === "awaiting_input" || item.status === "awaiting_plan" ? <IconClock size={14} /> : <span className="activity-row__dot" />}
                </span>
                <span className="activity-row__copy">
                  <strong>{item.title}</strong>
                  <span className="activity-row__meta">
                    {item.projectName || t("activity.noProject")}
                    {item.modelId ? ` · ${item.modelId}` : ""}
                  </span>
                  <span className="activity-row__detail">
                    {item.detail || t(statusKey(item.status))}
                  </span>
                </span>
                <span className={`activity-row__state activity-row__state--${statusClass(item.status)}`}>
                  {t(statusKey(item.status))}
                </span>
              </button>
              <div className="activity-row__actions">
                {isStoppable(item.status) ? (
                  <button type="button" aria-label={t("activity.stop")} title={t("activity.stop")} onClick={() => onStopSession(item)}>
                    <IconStop size={13} />
                  </button>
                ) : null}
                {item.status === "interrupted" || item.status === "failed" ? (
                  <button type="button" aria-label={t("activity.retry")} title={t("activity.retry")} onClick={() => onRetry(item)}>
                    <IconRefresh size={13} />
                  </button>
                ) : null}
                <button type="button" aria-label={t(item.pinned ? "activity.unpin" : "activity.pin")} title={t(item.pinned ? "activity.unpin" : "activity.pin")} onClick={() => onTogglePin(item.id)}>
                  {item.pinned ? <IconPinOff size={13} /> : <IconPin size={13} />}
                </button>
                {!item.pinned ? (
                  <button type="button" aria-label={t("activity.dismiss")} title={t("activity.dismiss")} onClick={() => onDismiss(item.id)}>
                    <IconClose size={13} />
                  </button>
                ) : null}
              </div>
            </article>
          ))
        )}
      </div>
    </section>
  );
}
