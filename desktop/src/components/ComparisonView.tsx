import { useEffect, useMemo, useRef, useState } from "react";
import type { ChatMessage } from "@/lib/session";
import * as api from "@/lib/api";

export type ComparisonEntry = {
  title: string;
  modelId: string | null;
  sessionId: string | null;
  status?: string;
  worktreePath?: string | null;
};

type T = (key: string, vars?: Record<string, string | number>) => string;
type DiffLine = { text: string; kind: "same" | "add" | "remove" | "fold" };

function isCode(text: string): boolean {
  return /```|\b(const|let|function|def|class|import|export)\b/.test(text);
}

function diffLines(
  base: string,
  current: string,
  collapse: boolean,
  t: T,
): DiffLine[] {
  const a = base.split("\n");
  const b = current.split("\n");
  const out: DiffLine[] = [];
  const max = Math.max(a.length, b.length);
  for (let i = 0; i < max; i += 1) {
    const left = a[i];
    const right = b[i];
    if (left === right) out.push({ text: right ?? left ?? "", kind: "same" });
    else {
      if (left !== undefined) out.push({ text: left, kind: "remove" });
      if (right !== undefined) out.push({ text: right, kind: "add" });
    }
  }
  if (!collapse) return out;
  const folded: DiffLine[] = [];
  let sameCount = 0;
  for (const line of out) {
    if (line.kind === "same") {
      sameCount += 1;
      continue;
    }
    if (sameCount > 3) {
      folded.push({
        text: t("comparison.identicalLines", { n: sameCount }),
        kind: "fold",
      });
    }
    else for (let i = 0; i < sameCount; i += 1) folded.push({ text: "", kind: "same" });
    sameCount = 0;
    folded.push(line);
  }
  if (sameCount > 3) {
    folded.push({
      text: t("comparison.identicalLines", { n: sameCount }),
      kind: "fold",
    });
  }
  else for (let i = 0; i < sameCount; i += 1) folded.push({ text: "", kind: "same" });
  return folded;
}

function formatCost(value: number | null, t: T): string {
  return value == null
    ? t("common.unknown")
    : t("comparison.cost", { value: value.toFixed(4) });
}

export function ComparisonView({
  entries,
  getMessages,
  loadMessages,
  t,
  onClose,
  onAdopt,
  projectPath,
}: {
  entries: ComparisonEntry[];
  getMessages: (sessionId: string) => ChatMessage[];
  loadMessages?: (sessionId: string) => Promise<ChatMessage[]>;
  t: T;
  onClose: () => void;
  onAdopt: (entry: ComparisonEntry, answer: ChatMessage) => void;
  projectPath?: string | null;
}) {
  const [selected, setSelected] = useState<string | null>(null);
  const [diffMode, setDiffMode] = useState(false);
  const [collapseIdentical, setCollapseIdentical] = useState(true);
  const [usage, setUsage] = useState<Record<string, api.SessionUsageSummary>>({});
  const [worktreeDiffs, setWorktreeDiffs] = useState<Record<string, api.GitWorktreeDiffResult>>({});
  const [loadedMessages, setLoadedMessages] = useState<Record<string, ChatMessage[]>>({});
  const scrollRefs = useRef<Array<HTMLDivElement | null>>([]);
  const syncing = useRef(false);
  const messagesFor = (sessionId: string) =>
    Object.prototype.hasOwnProperty.call(loadedMessages, sessionId)
      ? loadedMessages[sessionId] ?? []
      : getMessages(sessionId);
  const columns = useMemo(
    () => entries.filter((entry) => entry.sessionId).map((entry) => ({
      entry,
      answer: [...messagesFor(entry.sessionId!)].reverse().find(
        (message) => message.role === "assistant" && !message.isError,
      ),
    })),
    [entries, getMessages, loadedMessages],
  );
  const baseline = columns.find((column) => column.answer)?.answer?.content || "";

  useEffect(() => {
    if (!loadMessages) return;
    let cancelled = false;
    const ids = entries
      .map((entry) => entry.sessionId)
      .filter((id): id is string => !!id)
      .filter((id) => !Object.prototype.hasOwnProperty.call(loadedMessages, id));
    void Promise.all(ids.map(async (id) => [id, await loadMessages(id)] as const))
      .then((rows) => {
        if (cancelled || rows.length === 0) return;
        setLoadedMessages((current) => {
          const next = { ...current };
          for (const [id, messages] of rows) next[id] = messages;
          return next;
        });
      })
      .catch(() => {
        // A journal that disappears while comparing should not hide the other column.
      });
    return () => { cancelled = true; };
  }, [entries, loadMessages, loadedMessages]);

  useEffect(() => {
    let cancelled = false;
    void Promise.all(columns.map(async ({ entry }) => {
      if (!entry.sessionId) return null;
      return [entry.sessionId, await api.usageSessionSummary(entry.sessionId).catch(() => null)] as const;
    })).then((rows) => {
      if (cancelled) return;
      setUsage((prev) => {
        const next = { ...prev };
        for (const row of rows) if (row?.[1]) next[row[0]] = row[1];
        return next;
      });
    });
    return () => { cancelled = true; };
  }, [columns]);

  useEffect(() => {
    if (!projectPath) return;
    let cancelled = false;
    const refresh = () => {
      void Promise.all(
        columns
          .filter(({ entry }) => entry.worktreePath)
          .map(async ({ entry }) => {
            const path = entry.worktreePath!;
            return [path, await api.gitWorktreeDiff(projectPath, path).catch(() => null)] as const;
          }),
      ).then((rows) => {
        if (cancelled) return;
        setWorktreeDiffs((current) => {
          const next = { ...current };
          for (const [path, diff] of rows) if (diff) next[path] = diff;
          return next;
        });
      });
    };
    refresh();
    const timer = window.setInterval(refresh, 2500);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [columns, projectPath]);

  const synchronizeScroll = (source: HTMLDivElement) => {
    if (syncing.current) return;
    syncing.current = true;
    for (const target of scrollRefs.current) {
      if (target && target !== source) target.scrollTop = source.scrollTop;
    }
    requestAnimationFrame(() => { syncing.current = false; });
  };

  return (
    <section className="comparison-view" aria-label={t("comparison.title")}>
      <header className="comparison-view__head">
        <div>
          <h2>{t("comparison.title")}</h2>
          <p>{t("comparison.hint")}</p>
        </div>
        <div className="comparison-view__controls">
          <button type="button" className={diffMode ? "is-active" : undefined} onClick={() => setDiffMode((value) => !value)}>
            {t("comparison.diff")}
          </button>
          <button type="button" className={collapseIdentical ? "is-active" : undefined} onClick={() => setCollapseIdentical((value) => !value)}>
            {t("comparison.collapse")}
          </button>
          <button type="button" className="btn btn--ghost" onClick={onClose}>{t("common.close")}</button>
        </div>
      </header>
      <div className="comparison-view__columns">
        {columns.map(({ entry, answer }, index) => {
          const sid = entry.sessionId!;
          const summary = usage[sid];
          const worktreeDiff = entry.worktreePath
            ? worktreeDiffs[entry.worktreePath]
            : null;
          const lines = diffMode && answer && isCode(answer.content)
            ? diffLines(baseline, answer.content, collapseIdentical, t)
            : null;
          return (
            <article className={"comparison-view__column" + (selected === sid ? " is-selected" : "")} key={sid}>
              <header>
                <strong>{entry.modelId || t("batch.defaultModel")}</strong>
                {entry.status ? (
                  <span>{t(`comparison.status.${entry.status}`)}</span>
                ) : null}
                {summary ? <small>{t("comparison.usage", {
                  tokens: summary.totalTokens.toLocaleString(),
                  cost: formatCost(summary.costTotal, t),
                })}</small> : null}
              </header>
              <div
                className="comparison-view__answer"
                ref={(node) => { scrollRefs.current[index] = node; }}
                onScroll={(event) => synchronizeScroll(event.currentTarget)}
              >
                {worktreeDiff?.diff ? (
                  <pre className="comparison-view__diff comparison-view__worktree-diff">
                    {worktreeDiff.diff}
                  </pre>
                ) : answer ? (
                  lines ? (
                    <pre className="comparison-view__diff">{lines.map((line, lineIndex) => (
                      <span className={`comparison-view__diff-line is-${line.kind}`} key={`${line.kind}-${lineIndex}`}>
                        {line.kind === "add" ? "+ " : line.kind === "remove" ? "- " : "  "}{line.text}{"\n"}
                      </span>
                    ))}</pre>
                  ) : <div>{answer.content}</div>
                ) : t("comparison.waiting")}
              </div>
              <footer>
                {answer ? (
                  <button type="button" className="btn btn--primary" onClick={() => {
                    setSelected(sid);
                    onAdopt(entry, answer);
                  }}>{t("comparison.adopt")}</button>
                ) : null}
              </footer>
            </article>
          );
        })}
      </div>
    </section>
  );
}
