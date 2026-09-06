/**
 * Compact chat hover action — Codex tip + optional copy→check feedback.
 */

import { useCallback, useRef, useState, type ReactNode } from "react";
import { IconCheck, IconCopy } from "@/components/icons";
import { Tip } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";

export function MessageActionButton({
  label,
  ariaLabel,
  onClick,
  disabled,
  children,
  className,
}: {
  label: string;
  ariaLabel?: string;
  onClick?: () => void;
  disabled?: boolean;
  children: ReactNode;
  className?: string;
}) {
  return (
    <Tip label={label} disabled={disabled || !label}>
      <button
        type="button"
        className={cn("lobe-chat-action", className)}
        aria-label={ariaLabel ?? label}
        disabled={disabled}
        onClick={onClick}
      >
        {children}
      </button>
    </Tip>
  );
}

export function MessageCopyButton({
  text,
  copyLabel,
  copiedLabel = "OK",
}: {
  text: string;
  copyLabel: string;
  copiedLabel?: string;
}) {
  const [copied, setCopied] = useState(false);
  const timer = useRef<number | null>(null);

  const onCopy = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      if (timer.current != null) window.clearTimeout(timer.current);
      timer.current = window.setTimeout(() => setCopied(false), 1200);
    } catch {
      /* ignore */
    }
  }, [text]);

  return (
    <MessageActionButton
      label={copied ? copiedLabel : copyLabel}
      ariaLabel={copyLabel}
      onClick={() => void onCopy()}
      className={copied ? "is-copied" : undefined}
    >
      {copied ? <IconCheck size={15} /> : <IconCopy size={15} />}
    </MessageActionButton>
  );
}
