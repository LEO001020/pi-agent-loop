/**
 * Message primitives — adapted from Vercel AI Elements / shadcn Message.
 * Streaming body lives in MessageResponse (Streamdown).
 */

import * as React from "react";
import { cn } from "@/lib/utils";

export function Message({
  className,
  from,
  ...props
}: React.HTMLAttributes<HTMLElement> & {
  from?: "user" | "assistant" | "system";
}) {
  return (
    <article
      data-slot="message"
      data-from={from}
      className={cn(
        "group/message flex w-full min-w-0 max-w-full flex-col gap-2",
        from === "user" && "is-user ml-auto items-end",
        from === "assistant" && "is-assistant items-stretch",
        className,
      )}
      {...props}
    />
  );
}

export function MessageContent({
  className,
  ...props
}: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      data-slot="message-content"
      className={cn(
        "flex min-w-0 max-w-full flex-col gap-2 overflow-hidden text-[14.5px] leading-[1.65]",
        "text-[var(--text-primary)]",
        // User bubble
        "group-data-[from=user]/message:ml-auto",
        "group-data-[from=user]/message:max-w-[min(100%,36rem)]",
        "group-data-[from=user]/message:rounded-[18px]",
        "group-data-[from=user]/message:bg-[var(--bg-user-bubble)]",
        "group-data-[from=user]/message:px-4",
        "group-data-[from=user]/message:py-2.5",
        "group-data-[from=user]/message:whitespace-pre-wrap",
        // Assistant: full-width prose, no bubble chrome
        "group-data-[from=assistant]/message:w-full",
        className,
      )}
      {...props}
    />
  );
}

export function MessageActions({
  className,
  ...props
}: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      data-slot="message-actions"
      className={cn(
        "flex items-center gap-0.5 opacity-0 transition-opacity",
        "group-hover/message:opacity-100 focus-within:opacity-100",
        className,
      )}
      {...props}
    />
  );
}

export function MessageToolbar({
  className,
  ...props
}: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      data-slot="message-toolbar"
      className={cn(
        "mt-1 flex w-full items-center gap-1",
        className,
      )}
      {...props}
    />
  );
}
