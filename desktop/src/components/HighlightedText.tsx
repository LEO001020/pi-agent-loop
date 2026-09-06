/** Case-insensitive query highlight for plain text (in-chat find). */

import { splitHighlightParts } from "@/lib/chatFind";

export function HighlightedText({
  text,
  query,
  activeOccurrence = null,
}: {
  text: string;
  query: string;
  /** When set, the matching occurrence in this text is marked current. */
  activeOccurrence?: number | null;
}) {
  const q = query.trim();
  if (!q) return <>{text}</>;
  const parts = splitHighlightParts(text, q);
  if (parts.length === 1 && !parts[0]?.match) return <>{text}</>;
  return (
    <>
      {parts.map((p, i) =>
        p.match ? (
          <mark
            key={i}
            className={
              "chat-find-mark" +
              (activeOccurrence != null && p.occurrence === activeOccurrence
                ? " chat-find-mark--current"
                : "")
            }
            data-find-mark={
              activeOccurrence != null && p.occurrence === activeOccurrence
                ? "current"
                : "hit"
            }
          >
            {p.text}
          </mark>
        ) : (
          <span key={i}>{p.text}</span>
        ),
      )}
    </>
  );
}
