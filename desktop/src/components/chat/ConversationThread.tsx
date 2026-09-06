/**
 * Chat thread — Vercel AI Elements / shadcn Message + Streamdown streaming.
 * StickToBottom for stream-follow; Reasoning auto open/close.
 */

import { useMemo } from "react";
import type { Locale } from "@/i18n";
import { createT } from "@/i18n";
import {
  formatTurnErrorBody,
  type ChatMessage,
  type SessionState,
} from "@/lib/session";
import type { Attachment } from "@/lib/attachments";
import {
  buildInlineMediaPathMap,
  filterAttachmentsNotInlined,
  isImagePath,
  isMediaPath,
} from "@/lib/attachments";
import { AttachmentCard } from "@/components/AttachmentCard";
import {
  Conversation,
  ConversationContent,
  ConversationEmptyState,
  ConversationScrollButton,
} from "@/components/ui/conversation";
import {
  Message,
  MessageActions,
  MessageContent,
  MessageToolbar,
} from "@/components/ui/message";
import { MessageResponse } from "@/components/ui/message-response";
import {
  Reasoning,
  ReasoningContent,
  ReasoningTrigger,
} from "@/components/ui/reasoning";
import { Spinner } from "@/components/ui/spinner";
import { Button } from "@/components/ui/button";
import { Tip } from "@/components/ui/tooltip";
import {
  IconCheck,
  IconCopy,
  IconExportMd,
  IconPlan,
} from "@/components/icons";
import { cn } from "@/lib/utils";
import { SkillChip } from "@/components/SkillChip";
import { hydrateDisplayContent, parseStoredContent } from "@/lib/draftDoc";

/** Render user message text with inline skill chips. */
function UserMessageBody({ content }: { content: string }) {
  const segs = parseStoredContent(hydrateDisplayContent(content));
  const hasSkill = segs.some((s) => s.type === "skill");
  if (!hasSkill) {
    return <>{content}</>;
  }
  return (
    <span className="user-msg-body">
      {segs.map((s, i) =>
        s.type === "skill" ? (
          <SkillChip key={`sk-${i}-${s.name}`} name={s.name} size="sm" />
        ) : (
          <span key={`t-${i}`}>{s.text}</span>
        ),
      )}
    </span>
  );
}

export interface ConversationThreadProps {
  locale: Locale;
  messages: ChatMessage[];
  sessionState: SessionState;
  /** Remount scroll surface when switching sessions. */
  sessionKey?: string;
  projectPath?: string | null;
  onOpenResource?: (target: import("@/components/ResourceViewer").ResourceOpenTarget) => void;
  plan?: {
    visible: boolean;
    waiting: boolean;
    title: string;
    body: string;
    entries: unknown[];
    rpcId?: number | null;
  };
  onApprovePlan?: () => void;
  onRequestPlanChanges?: () => void;
  onDismissPlan?: () => void;
  onAddAttachmentToComposer?: (att: Attachment) => void;
  attachLabels: {
    open: string;
    reveal: string;
    copyPath: string;
    copyImage: string;
    addToComposer: string;
    remove: string;
  };
}

function ToolMarker({
  message,
  locale,
}: {
  message: ChatMessage;
  locale: Locale;
}) {
  const tr = useMemo(() => createT(locale), [locale]);
  const running = message.streaming || message.toolStatus === "running";
  return (
    <div
      role={running ? "status" : undefined}
      className="flex items-center gap-2 py-1 pl-0.5 text-[13px] text-[var(--text-secondary)]"
    >
      {running ? (
        <Spinner size={14} />
      ) : (
        <IconCheck size={14} className="text-[var(--text-tertiary)]" />
      )}
      <span>
        {running
          ? message.content?.trim() ||
            message.toolStatus ||
            tr("chat.toolRunning")
          : message.content?.trim() ||
            message.toolStatus ||
            tr("chat.toolDone")}
      </span>
    </div>
  );
}

export function ConversationThread({
  locale,
  messages,
  sessionState,
  sessionKey,
  projectPath,
  onOpenResource,
  plan,
  onApprovePlan,
  onRequestPlanChanges,
  onDismissPlan,
  onAddAttachmentToComposer,
  attachLabels,
}: ConversationThreadProps) {
  const tr = useMemo(() => createT(locale), [locale]);

  const showWorking =
    sessionState === "streaming" &&
    !messages.some((m) => m.role === "assistant" && m.streaming);

  const empty = messages.length === 0 && !showWorking && !plan?.visible;

  return (
    <Conversation key={sessionKey ?? "chat"}>
      <ConversationContent>
        {empty ? (
          <ConversationEmptyState
            title={tr("main.startTitle")}
            description={tr("main.startHint")}
          />
        ) : null}

        {messages.map((m) => {
          if (m.role === "tool") {
            return <ToolMarker key={m.id} message={m} locale={locale} />;
          }

          if (m.role === "user") {
            return (
              <Message key={m.id} from="user">
                {m.content.trim() ? (
                  <MessageContent>
                    <UserMessageBody content={m.content} />
                  </MessageContent>
                ) : null}
                {m.attachments && m.attachments.length > 0 ? (
                  <div className="flex max-w-[min(100%,36rem)] flex-wrap justify-end gap-2">
                    {m.attachments.map((a) => (
                      <AttachmentCard
                        key={a.path}
                        attachment={a}
                        variant="chip"
                        labels={attachLabels}
                        galleryPaths={m.attachments
                          ?.filter((x) => !x.isDir && isImagePath(x.path))
                          .map((x) => x.path)}
                        onAddToComposer={onAddAttachmentToComposer}
                      />
                    ))}
                  </div>
                ) : null}
              </Message>
            );
          }

          // Turn failure — friendly copy only (no raw RPC/MCP dumps)
          if (m.isError) {
            const friendly = formatTurnErrorBody(
              { content: m.content, code: undefined, message: undefined },
              "en",
            );
            return (
              <div
                key={m.id}
                className="chat-turn-error"
                role="alert"
                data-testid="chat-turn-error"
              >
                <div className="chat-turn-error__label">
                  {tr("chat.turnFailed")}
                </div>
                <div className="chat-turn-error__body">{friendly}</div>
              </div>
            );
          }

          const hasThought = !!(m.thought && m.thought.trim());
          const thoughtStreaming =
            !!m.streaming && !m.content.trim() && hasThought;
          const showThinkingPlaceholder =
            !!m.streaming && !m.content.trim() && !hasThought;

          return (
            <div key={m.id} className="flex w-full flex-col gap-2">
              {(thoughtStreaming || hasThought) && (
                <Reasoning
                  isStreaming={thoughtStreaming}
                  defaultOpen={thoughtStreaming}
                >
                  <ReasoningTrigger
                    streamingLabel={tr("chat.thinking")}
                    doneLabel={(d) =>
                      d != null
                        ? tr("chat.thoughtFor", { n: String(d) })
                        : tr("chat.thoughtDone")
                    }
                  />
                  {hasThought ? (
                    <ReasoningContent>{m.thought}</ReasoningContent>
                  ) : null}
                </Reasoning>
              )}

              {showThinkingPlaceholder ? (
                <div
                  role="status"
                  className="flex items-center gap-2 py-1 pl-0.5 text-[13px] text-[var(--text-secondary)]"
                >
                  <span className="inline-flex size-3.5 shrink-0 animate-spin rounded-full border-2 border-[var(--text-tertiary)] border-t-transparent" />
                  <span>{tr("chat.thinking")}</span>
                </div>
              ) : null}

              {(() => {
                const imagePathMap = buildInlineMediaPathMap(m.attachments);
                const bottomAtts = filterAttachmentsNotInlined(
                  m.content,
                  m.attachments,
                );
                const showBody =
                  !!m.content.trim() || !!(bottomAtts && bottomAtts.length);
                if (!showBody) return null;
                return (
                <Message from="assistant">
                  {m.content.trim() ? (
                    <MessageContent>
                      <MessageResponse
                        isAnimating={!!m.streaming}
                        locale={locale}
                        imagePathMap={
                          Object.keys(imagePathMap).length
                            ? imagePathMap
                            : undefined
                        }
                        projectPath={projectPath}
                        onOpenResource={onOpenResource}
                      >
                        {m.content}
                      </MessageResponse>
                    </MessageContent>
                  ) : null}
                  {bottomAtts && bottomAtts.length > 0 ? (
                    <div className="flex flex-wrap gap-2 pt-1">
                      {bottomAtts.map((a) => (
                        <AttachmentCard
                          key={a.path}
                          attachment={a}
                          variant={
                            !a.isDir && isMediaPath(a.path) ? "card" : "chip"
                          }
                          labels={attachLabels}
                          galleryPaths={bottomAtts
                            .filter((x) => !x.isDir && isImagePath(x.path))
                            .map((x) => x.path)}
                          onAddToComposer={onAddAttachmentToComposer}
                        />
                      ))}
                    </div>
                  ) : null}
                  {!m.streaming && m.content.trim() ? (
                    <MessageToolbar>
                      <MessageActions className="opacity-100">
                        <Tip label={tr("message.copy")}>
                          <Button
                            type="button"
                            variant="ghost"
                            size="icon"
                            aria-label={tr("message.copy")}
                            onClick={() =>
                              void navigator.clipboard.writeText(m.content)
                            }
                          >
                            <IconCopy size={15} />
                          </Button>
                        </Tip>
                        <Tip label={tr("message.exportMd")}>
                          <Button
                            type="button"
                            variant="ghost"
                            size="icon"
                            aria-label={tr("message.exportMd")}
                            onClick={() => {
                              const blob = new Blob([m.content], {
                                type: "text/markdown;charset=utf-8",
                              });
                              const url = URL.createObjectURL(blob);
                              const a = document.createElement("a");
                              a.href = url;
                              a.download = `pi-${m.id.slice(0, 8)}.md`;
                              a.click();
                              URL.revokeObjectURL(url);
                            }}
                          >
                            <IconExportMd size={15} />
                          </Button>
                        </Tip>
                      </MessageActions>
                    </MessageToolbar>
                  ) : null}
                </Message>
                );
              })()}
            </div>
          );
        })}

        {showWorking ? (
          <div
            role="status"
            className="flex items-center gap-2 py-1 pl-0.5 text-[13px] text-[var(--text-secondary)]"
          >
            <span className="inline-flex size-3.5 shrink-0 animate-spin rounded-full border-2 border-[var(--text-tertiary)] border-t-transparent" />
            <span>{tr("chat.thinking")}</span>
          </div>
        ) : null}

        {plan?.visible ? (
          <div
            className={cn(
              "rounded-xl border border-[var(--border-subtle)]",
              "bg-[var(--bg-card)] p-4 shadow-sm",
            )}
          >
            <div className="mb-2 flex items-center gap-2 text-[13px] text-[var(--text-secondary)]">
              <IconPlan size={14} />
              <span className="font-medium text-[var(--text-primary)]">
                {plan.waiting ? tr("plan.waiting") : tr("plan.ready")}
              </span>
            </div>
            <h3 className="mb-2 text-[15px] font-semibold text-[var(--text-primary)]">
              {plan.title}
            </h3>
            <div className="mb-1 text-[12px] font-medium text-[var(--text-tertiary)]">
              {tr("plan.context")}
            </div>
            <pre className="mb-3 max-h-48 overflow-auto whitespace-pre-wrap rounded-lg bg-[var(--bg-code)] p-3 font-mono text-[12px] text-[var(--text-secondary)]">
              {plan.body?.trim()
                ? plan.body
                : Array.isArray(plan.entries) && plan.entries.length
                  ? plan.entries
                      .map((e, i) => {
                        if (e && typeof e === "object") {
                          const o = e as Record<string, unknown>;
                          return `${i + 1}. ${String(o.content ?? o.title ?? "")}`;
                        }
                        return `${i + 1}. ${String(e)}`;
                      })
                      .join("\n")
                  : tr("plan.empty")}
            </pre>
            <div className="flex flex-wrap gap-2">
              <Button
                type="button"
                disabled={plan.waiting && plan.rpcId == null}
                onClick={onApprovePlan}
              >
                {tr("plan.approve")}
              </Button>
              <Button
                type="button"
                variant="ghost"
                disabled={plan.waiting && plan.rpcId == null}
                onClick={onRequestPlanChanges}
              >
                {tr("plan.changes")}
              </Button>
              <Button type="button" variant="ghost" onClick={onDismissPlan}>
                {tr("plan.dismiss")}
              </Button>
            </div>
          </div>
        ) : null}
      </ConversationContent>
      <ConversationScrollButton label={tr("chat.scrollBottom")} />
    </Conversation>
  );
}
