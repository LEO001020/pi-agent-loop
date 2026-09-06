/**
 * Reasoning / thinking block — AI Elements pattern:
 * auto-open while streaming, auto-collapse after finish.
 */

import {
  createContext,
  memo,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ComponentProps,
  type ReactNode,
} from "react";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import { IconCheck, IconChevronDown } from "@/components/icons";
import { cn } from "@/lib/utils";
import {
  loadThinkingExpandPref,
  saveThinkingExpandPref,
  thinkingDefaultOpenWhenDone,
} from "@/lib/thinkingPref";

interface ReasoningContextValue {
  isStreaming: boolean;
  isOpen: boolean;
  setIsOpen: (open: boolean) => void;
  duration: number | undefined;
}

const ReasoningContext = createContext<ReasoningContextValue | null>(null);

function useReasoning() {
  const ctx = useContext(ReasoningContext);
  if (!ctx) throw new Error("Reasoning* must be used within <Reasoning>");
  return ctx;
}

const AUTO_CLOSE_DELAY = 900;

export type ReasoningProps = ComponentProps<typeof Collapsible> & {
  isStreaming?: boolean;
  open?: boolean;
  defaultOpen?: boolean;
  onOpenChange?: (open: boolean) => void;
};

export const Reasoning = memo(function Reasoning({
  className,
  isStreaming = false,
  open: openProp,
  defaultOpen,
  onOpenChange,
  children,
  ...props
}: ReasoningProps) {
  const resolvedDefault = defaultOpen ?? isStreaming;
  const isExplicitlyClosed = defaultOpen === false;
  const [uncontrolledOpen, setUncontrolledOpen] = useState(resolvedDefault);
  const isControlled = openProp !== undefined;
  const isOpen = isControlled ? !!openProp : uncontrolledOpen;

  const setIsOpen = useCallback(
    (next: boolean) => {
      if (!isControlled) setUncontrolledOpen(next);
      onOpenChange?.(next);
    },
    [isControlled, onOpenChange],
  );

  const [duration, setDuration] = useState<number | undefined>(undefined);
  const hasEverStreamedRef = useRef(isStreaming);
  const [hasAutoClosed, setHasAutoClosed] = useState(false);
  const startTimeRef = useRef<number | null>(null);

  useEffect(() => {
    if (isStreaming) {
      hasEverStreamedRef.current = true;
      if (startTimeRef.current === null) startTimeRef.current = Date.now();
    } else if (startTimeRef.current !== null) {
      setDuration(Math.max(1, Math.ceil((Date.now() - startTimeRef.current) / 1000)));
      startTimeRef.current = null;
    }
  }, [isStreaming]);

  useEffect(() => {
    if (isStreaming && !isOpen && !isExplicitlyClosed) setIsOpen(true);
  }, [isStreaming, isOpen, setIsOpen, isExplicitlyClosed]);

  useEffect(() => {
    if (
      hasEverStreamedRef.current &&
      !isStreaming &&
      isOpen &&
      !hasAutoClosed
    ) {
      // Honor user preference: keep-open skips auto-collapse after stream ends.
      if (thinkingDefaultOpenWhenDone(loadThinkingExpandPref())) {
        setHasAutoClosed(true);
        return;
      }
      const t = window.setTimeout(() => {
        setIsOpen(false);
        setHasAutoClosed(true);
      }, AUTO_CLOSE_DELAY);
      return () => window.clearTimeout(t);
    }
  }, [isStreaming, isOpen, setIsOpen, hasAutoClosed]);

  const value = useMemo(
    () => ({ duration, isOpen, isStreaming, setIsOpen }),
    [duration, isOpen, isStreaming, setIsOpen],
  );

  const handleOpenChange = useCallback(
    (next: boolean) => {
      setIsOpen(next);
      // Persist expand preference when user toggles a finished block
      if (!isStreaming && hasEverStreamedRef.current) {
        saveThinkingExpandPref(next ? "keep-open" : "auto-collapse");
      }
    },
    [setIsOpen, isStreaming],
  );

  return (
    <ReasoningContext.Provider value={value}>
      <Collapsible
        className={cn("not-prose w-full", className)}
        open={isOpen}
        onOpenChange={handleOpenChange}
        {...props}
      >
        {children}
      </Collapsible>
    </ReasoningContext.Provider>
  );
});

export type ReasoningTriggerProps = ComponentProps<typeof CollapsibleTrigger> & {
  streamingLabel?: ReactNode;
  doneLabel?: (duration?: number) => ReactNode;
};

export const ReasoningTrigger = memo(function ReasoningTrigger({
  className,
  children,
  streamingLabel,
  doneLabel,
  ...props
}: ReasoningTriggerProps) {
  const { isStreaming, isOpen, duration } = useReasoning();

  const label =
    children ??
    (isStreaming || duration === 0 ? (
      <span>{streamingLabel ?? "Thinking…"}</span>
    ) : (
      <span>
        {doneLabel
          ? doneLabel(duration)
          : duration != null
            ? `Thought for ${duration}s`
            : "Thought"}
      </span>
    ));

  return (
    <CollapsibleTrigger
      className={cn(
        "flex w-full items-center gap-2 rounded-md px-1 py-1.5 text-left",
        "text-[13px] text-[var(--text-secondary)]",
        "hover:bg-[var(--bg-hover)] hover:text-[var(--text-primary)]",
        "transition-colors",
        className,
      )}
      {...props}
    >
      {isStreaming ? (
        <span className="inline-flex size-3.5 shrink-0 animate-spin rounded-full border-2 border-[var(--text-tertiary)] border-t-transparent" />
      ) : (
        <IconCheck size={14} className="shrink-0 text-[var(--text-tertiary)]" />
      )}
      <span className="min-w-0 flex-1">{label}</span>
      <IconChevronDown
        size={14}
        className={cn(
          "ml-auto shrink-0 text-[var(--text-tertiary)] transition-transform",
          isOpen && "rotate-180",
        )}
      />
    </CollapsibleTrigger>
  );
});

export type ReasoningContentProps = ComponentProps<typeof CollapsibleContent> & {
  children: ReactNode;
};

export const ReasoningContent = memo(function ReasoningContent({
  className,
  children,
  ...props
}: ReasoningContentProps) {
  return (
    <CollapsibleContent
      className={cn(
        "overflow-hidden text-[13px] leading-relaxed text-[var(--text-secondary)]",
        "data-[state=closed]:animate-out data-[state=open]:animate-in",
        className,
      )}
      {...props}
    >
      <div className="mt-1 mb-2 max-h-[min(40vh,22rem)] overflow-y-auto whitespace-pre-wrap rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-elevated)] px-3.5 py-3">
        {children}
      </div>
    </CollapsibleContent>
  );
});
