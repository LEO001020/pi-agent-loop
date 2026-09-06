import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import type { ChatMessage } from "@/lib/session";

interface MinimapEntry {
  id: string;
  /** Short truncated lead — shown bold as the tooltip title. */
  title: string;
  /** Longer flat preview — shown (clamped) as the tooltip body. */
  preview: string;
  weight: number;
}

function flatten(content: string): string {
  return content.replace(/\s+/g, " ").trim();
}

function buildEntries(messages: ChatMessage[]): MinimapEntry[] {
  const entries: MinimapEntry[] = [];
  for (const m of messages) {
    // Index the user's own turns only — the assistant's replies stay out.
    if (m.role !== "user") continue;
    if (m.marker === "context_compact") continue;
    if (m.marker === "turn_cancelled") continue;
    if (m.isError) continue;
    const text = m.content?.trim();
    if (!text) continue;
    const flat = flatten(text);
    const lead = flat.slice(0, 14);
    entries.push({
      id: m.id,
      title: flat.length > 14 ? lead + "…" : lead,
      preview: flat,
      weight: Math.min(text.length / 240, 1),
    });
  }
  return entries;
}

export function ChatMinimap({
  messages,
  scrollRef,
}: {
  messages: ChatMessage[];
  scrollRef: React.RefObject<HTMLDivElement | null>;
}) {
  const entries = useMemo(() => buildEntries(messages), [messages]);
  const [hoveredId, setHoveredId] = useState<string | null>(null);
  const [activeId, setActiveId] = useState<string | null>(null);
  const barRefs = useRef<Map<string, HTMLButtonElement>>(new Map());
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const root = scrollRef.current;
    if (!root || entries.length === 0) return;

    const update = () => {
      const rootRect = root.getBoundingClientRect();
      const centerY = (rootRect.top + rootRect.bottom) / 2;
      let bestId: string | null = null;
      let bestDist = Infinity;
      for (const entry of entries) {
        const el = root.querySelector(
          `[data-message-id="${CSS.escape(entry.id)}"]`,
        );
        if (!el) continue;
        const rect = el.getBoundingClientRect();
        const inView = rect.bottom > rootRect.top && rect.top < rootRect.bottom;
        if (!inView) continue;
        const elCenter = (rect.top + rect.bottom) / 2;
        const dist = Math.abs(elCenter - centerY);
        if (dist < bestDist) {
          bestDist = dist;
          bestId = entry.id;
        }
      }
      setActiveId(bestId);
    };

    update();
    root.addEventListener("scroll", update, { passive: true });
    const ro = new ResizeObserver(update);
    ro.observe(root);
    return () => {
      root.removeEventListener("scroll", update);
      ro.disconnect();
    };
  }, [scrollRef, entries]);

  const handleClick = useCallback(
    (id: string) => {
      const root = scrollRef.current;
      if (!root) return;
      const el = root.querySelector(
        `[data-message-id="${CSS.escape(id)}"]`,
      ) as HTMLElement | null;
      if (el) {
        el.scrollIntoView({ block: "center", behavior: "smooth" });
      }
    },
    [scrollRef],
  );

  if (entries.length < 2) return null;

  return (
    <div className="chat-minimap" ref={containerRef} aria-hidden>
      <div className="chat-minimap__track">
        {entries.map((entry) => {
          const isActive = activeId === entry.id;
          const isHovered = hoveredId === entry.id;
          const widthPct = 22 + entry.weight * 46;
          return (
            <button
              key={entry.id}
              type="button"
              ref={(el) => {
                if (el) barRefs.current.set(entry.id, el);
                else barRefs.current.delete(entry.id);
              }}
              className={
                "chat-minimap__bar" +
                (isActive ? " chat-minimap__bar--active" : "") +
                (isHovered ? " chat-minimap__bar--hovered" : "")
              }
              style={{ width: isActive ? "100%" : `${widthPct}%` }}
              onMouseEnter={() => setHoveredId(entry.id)}
              onMouseLeave={() => setHoveredId(null)}
              onClick={() => handleClick(entry.id)}
              tabIndex={-1}
            />
          );
        })}
      </div>
      {hoveredId ? (
        <MinimapTooltip
          entry={entries.find((e) => e.id === hoveredId)!}
          anchorRef={barRefs.current.get(hoveredId) ?? null}
          containerRef={containerRef}
        />
      ) : null}
    </div>
  );
}

function MinimapTooltip({
  entry,
  anchorRef,
  containerRef,
}: {
  entry: MinimapEntry;
  anchorRef: HTMLButtonElement | null;
  containerRef: React.RefObject<HTMLDivElement | null>;
}) {
  const [pos, setPos] = useState<{ top: number } | null>(null);

  useEffect(() => {
    if (!anchorRef || !containerRef.current) return;
    const anchorRect = anchorRef.getBoundingClientRect();
    const containerRect = containerRef.current.getBoundingClientRect();
    setPos({ top: anchorRect.top - containerRect.top });
  }, [anchorRef, containerRef]);

  if (!pos) return null;

  return (
    <div className="chat-minimap__tooltip" style={{ top: pos.top }}>
      <div className="chat-minimap__tooltip-title">{entry.title}</div>
      <div className="chat-minimap__tooltip-text">{entry.preview}</div>
    </div>
  );
}
