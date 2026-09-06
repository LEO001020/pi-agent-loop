import type { RunningSessionSnapshot } from "@/lib/api";

type T = (key: string, vars?: Record<string, string | number>) => string;

export function RunningTasksDock({
  rows,
  cap,
  queued = 0,
  onOpen,
  onStop,
  onRaiseCap,
  t,
}: {
  rows: RunningSessionSnapshot[];
  cap: number;
  queued?: number;
  onOpen: (sessionId: string) => void;
  onStop: (sessionId: string) => void;
  onRaiseCap?: () => void;
  t: T;
}) {
  if (!rows.length) return null;
  return (
    <aside className="running-dock" aria-label={t("runningDock.title")}>
      <header className="running-dock__head">
        <strong>{t("runningDock.title")}</strong>
        <span>{t("runningDock.capacity", { active: rows.length, cap })}{queued ? ` · ${t("runningDock.queued", { n: queued })}` : ""}</span>
        {onRaiseCap && cap < 8 ? <button type="button" onClick={onRaiseCap}>{t("runningDock.raiseCap")}</button> : null}
      </header>
      <ul>
        {rows.map((row) => (
          <li key={row.sessionId}>
            <button type="button" onClick={() => onOpen(row.sessionId)}>
              <span className="running-dock__dot" aria-hidden />
              <span className="running-dock__copy">
                <strong>{row.modelId || t("batch.defaultModel")}</strong>
                <small>{row.title}</small>
              </span>
              <span className="running-dock__stats">
                {Math.floor(row.elapsedSecs / 60)}:{String(row.elapsedSecs % 60).padStart(2, "0")}
                <small>{row.usage.totalTokens.toLocaleString()} t</small>
              </span>
            </button>
            <button
              type="button"
              className="running-dock__stop"
              aria-label={t("runningDock.stop")}
              onClick={() => onStop(row.sessionId)}
            >
              ■
            </button>
          </li>
        ))}
      </ul>
    </aside>
  );
}
