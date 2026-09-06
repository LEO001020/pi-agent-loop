/**
 * Lobe Thinking — Accordion + shinyText (1:1 of lobe-chat Thinking).
 * Auto-open while streaming; when done, respect user expand preference
 * (default: collapse so the answer stays the focus).
 */

import { useEffect, useRef, useState, type ReactNode } from "react";
import { IconChevronDown } from "@/components/icons";
import { cn } from "@/lib/utils";
import { MarkdownChat } from "./MarkdownChat";
import { ThinkingOrbInline } from "./ThinkingOrbInline";
import type { Locale } from "@/i18n";
import {
  loadThinkingExpandPref,
  saveThinkingExpandPref,
  thinkingDefaultOpenWhenDone,
  type ThinkingExpandPref,
} from "@/lib/thinkingPref";

export function Thinking({
  content,
  thinking,
  durationMs,
  streamingLabel,
  doneLabel,
  thoughtForLabel,
  locale = "en",
  expandPref,
  onExpandPrefChange,
}: {
  content?: string | ReactNode;
  thinking?: boolean;
  /** Duration in ms (Lobe stores ms). */
  durationMs?: number;
  streamingLabel: string;
  doneLabel: string;
  /** e.g. "Thought for {n}s" — n is seconds with 1 decimal */
  thoughtForLabel: (seconds: string) => string;
  locale?: Locale;
  /** Override stored preference (tests / parent). */
  expandPref?: ThinkingExpandPref;
  onExpandPrefChange?: (pref: ThinkingExpandPref) => void;
}) {
  const pref = expandPref ?? loadThinkingExpandPref();
  const [open, setOpen] = useState(() =>
    thinking ? true : thinkingDefaultOpenWhenDone(pref),
  );
  const startRef = useRef<number | null>(null);
  const [localDuration, setLocalDuration] = useState<number | undefined>(durationMs);
  const userToggled = useRef(false);

  useEffect(() => {
    if (thinking) {
      setOpen(true);
      userToggled.current = false;
      if (startRef.current == null) startRef.current = Date.now();
    } else if (startRef.current != null) {
      setLocalDuration(Date.now() - startRef.current);
      startRef.current = null;
      // Collapse when done unless user prefers keep-open or just toggled open.
      if (!userToggled.current) {
        setOpen(thinkingDefaultOpenWhenDone(pref));
      }
    }
  }, [thinking, pref]);

  useEffect(() => {
    if (durationMs != null) setLocalDuration(durationMs);
  }, [durationMs]);

  // Avoid "Thought for 0.0s" for sub-100ms phases.
  const durationText =
    localDuration != null && localDuration >= 100
      ? thoughtForLabel((localDuration / 1000).toFixed(1))
      : doneLabel;

  const hasBody =
    (typeof content === "string" && content.trim().length > 0) ||
    (content != null && typeof content !== "string");

  const toggle = () => {
    setOpen((v) => {
      const next = !v;
      userToggled.current = true;
      // Remember: open after finish → keep-open; close → auto-collapse
      if (!thinking) {
        const p: ThinkingExpandPref = next ? "keep-open" : "auto-collapse";
        saveThinkingExpandPref(p);
        onExpandPrefChange?.(p);
      }
      return next;
    });
  };

  return (
    <div className="lobe-chat-thinking">
      <button
        type="button"
        className="lobe-chat-thinking__trigger"
        aria-expanded={open}
        onClick={toggle}
      >
        <ThinkingOrbInline
          state={thinking ? "thinking" : "done"}
          paused={!thinking}
          className="lobe-chat-thinking__orb"
        />
        {thinking ? (
          <span style={{ color: "var(--lobe-color-text-secondary)" }}>
            {streamingLabel}
          </span>
        ) : (
          <span style={{ color: "var(--lobe-color-text-secondary)" }}>
            {durationText}
          </span>
        )}
        {hasBody ? (
          <IconChevronDown
            size={14}
            className={cn(
              "text-[var(--lobe-color-text-tertiary)] transition-transform",
              open && "rotate-180",
            )}
          />
        ) : null}
      </button>
      {open && hasBody ? (
        <div className="lobe-chat-thinking__body">
          {typeof content === "string" ? (
            <MarkdownChat locale={locale} muted>
              {content}
            </MarkdownChat>
          ) : (
            content
          )}
        </div>
      ) : null}
    </div>
  );
}
