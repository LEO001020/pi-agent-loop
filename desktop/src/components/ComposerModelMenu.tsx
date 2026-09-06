/**
 * Composer chip menus (Codex-style):
 * - Model (+effort)
 * - Access: session mode + permission in one panel
 * Narrow composer widths compress triggers to icon (+ short label).
 */

import {
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type ReactNode,
} from "react";
import { createPortal } from "react-dom";
import {
  PI_FALLBACK_MODELS,
  effortDisplayLabel,
  effortsForModel,
  findModel,
  type ModelOption,
  type PermissionPolicyId,
} from "@/lib/agentCatalog";
import { Tip } from "@/components/ui/tooltip";
import {
  IconAlertTriangle,
  IconBolt,
  IconCheck,
  IconChevronDown,
  IconChevronRight,
  IconHandStop,
  IconShield,
  IconShieldCheck,
} from "@/components/icons";
import { useFloatingMenu, type FloatingPos } from "@/lib/floatingMenu";

type Nested = "model" | "effort" | "compare" | null;

function usePortalMenu(estHeight = 220, _width = 300, nestedKey?: string) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const popRef = useRef<HTMLDivElement>(null);
  const popId = useId();

  const { pos, style: popStyle } = useFloatingMenu({
    open,
    triggerRef,
    panelRef: popRef,
    roots: [rootRef],
    onClose: () => setOpen(false),
    placement: "auto",
    fitContent: true,
    minWidth: 200,
    estHeight,
    gap: 8,
    deps: [nestedKey],
  });

  return {
    open,
    setOpen,
    pos,
    popStyle: popStyle as CSSProperties | undefined,
    rootRef,
    triggerRef,
    popRef,
    popId,
  };
}

function MenuShell({
  open,
  setOpen,
  rootRef,
  triggerRef,
  popRef,
  popId,
  pos,
  popStyle,
  triggerIcon,
  triggerText,
  triggerShort,
  ariaLabel,
  title,
  danger,
  children,
  onOpenChange,
  className = "",
}: {
  open: boolean;
  setOpen: (v: boolean | ((p: boolean) => boolean)) => void;
  rootRef: React.RefObject<HTMLDivElement | null>;
  triggerRef: React.RefObject<HTMLButtonElement | null>;
  popRef: React.RefObject<HTMLDivElement | null>;
  popId: string;
  pos: FloatingPos | null;
  popStyle: CSSProperties | undefined;
  triggerIcon?: ReactNode;
  /** Full label (wide layout) */
  triggerText: string;
  /** Short label (medium; icon-only when very narrow via CSS) */
  triggerShort?: string;
  ariaLabel: string;
  title?: string;
  danger?: boolean;
  children: ReactNode;
  onOpenChange?: (open: boolean) => void;
  className?: string;
}) {
  const panel =
    open && pos && typeof document !== "undefined"
      ? createPortal(
          <div
            ref={popRef}
            className="cmm__pop cmm__pop--portal"
            id={popId}
            role="dialog"
            aria-label={ariaLabel}
            style={popStyle}
          >
            {children}
          </div>,
          document.body,
        )
      : null;

  const tipLabel = title ?? ariaLabel;
  const trigger = (
    <button
      ref={triggerRef}
      type="button"
      className="cmm__trigger"
      aria-haspopup="dialog"
      aria-expanded={open}
      aria-controls={popId}
      aria-label={ariaLabel}
      onClick={() => {
        setOpen((v) => {
          const next = !v;
          onOpenChange?.(next);
          return next;
        });
      }}
    >
      {triggerIcon ? (
        <span className="cmm__icon" aria-hidden>
          {triggerIcon}
        </span>
      ) : null}
      <span className="cmm__trigger-text cmm__trigger-text--full">
        {triggerText}
      </span>
      {triggerShort != null && (
        <span className="cmm__trigger-text cmm__trigger-text--short">
          {triggerShort}
        </span>
      )}
      <span className="cmm__chev" aria-hidden>
        <IconChevronDown size={12} />
      </span>
    </button>
  );

  return (
    <div
      ref={rootRef}
      className={`cmm ${open ? "is-open" : ""} ${danger ? "cmm--danger" : ""} ${className}`.trim()}
    >
      {tipLabel ? (
        <Tip label={tipLabel} disabled={open}>
          {trigger}
        </Tip>
      ) : (
        trigger
      )}
      {panel}
    </div>
  );
}

/* ---------- Model + effort ---------- */

export interface ComposerModelMenuProps {
  modelId: string;
  effort: string;
  /** Live selectable models only (from Host catalog). */
  models?: ModelOption[];
  labels: {
    model: string;
    effort: string;
    effortHigh: string;
    effortMedium: string;
  effortLow: string;
    compare: string;
    compareHint: string;
    compareRun: string;
    compareWorktrees: string;
    customProvider: string;
    /** Shown on a model whose last turn was refused for balance. */
    blocked: string;
    healthLatency: string;
    healthFailure: string;
  };
  onModel: (id: string) => void;
  onEffort: (id: string) => void;
  onCompare?: (ids: string[]) => void;
  onCompareWorktrees?: (ids: string[]) => void;
  /** Recent measured health, keyed by exact model id. */
  modelHealth?: Record<
    string,
    { averageLatencyMs: number | null; failureRate: number | null }
  >;
}

function resolveEffortLabel(
  effortId: string,
  effortList: ReturnType<typeof effortsForModel>,
  labels: ComposerModelMenuProps["labels"],
): string {
  const entry = effortList.find((e) => e.id === effortId);
  return effortDisplayLabel(entry ?? effortId, {
    high: labels.effortHigh,
    medium: labels.effortMedium,
    low: labels.effortLow,
  });
}

export function ComposerModelMenu({
  modelId,
  effort,
  models = PI_FALLBACK_MODELS,
  labels,
  onModel,
  onEffort,
  onCompare,
  onCompareWorktrees,
  modelHealth = {},
}: ComposerModelMenuProps) {
  const [nested, setNested] = useState<Nested>(null);
  const menu = usePortalMenu(240, 280, nested ?? "root");
  const modelList = models.length > 0 ? models : PI_FALLBACK_MODELS;
  const activeModel = findModel(modelId, modelList);
  const effortList = effortsForModel(activeModel);
  const [compareIds, setCompareIds] = useState<string[]>([]);

  useEffect(() => {
    if (!menu.open) setNested(null);
  }, [menu.open]);

  useEffect(() => {
    if (!menu.open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && nested) {
        e.stopPropagation();
        setNested(null);
      }
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [menu.open, nested]);

  const modelLabel = activeModel?.label ?? modelId;
  const eLabel = resolveEffortLabel(effort, effortList, labels);
  const triggerText = `${modelLabel} · ${eLabel}`;
  const title = `${labels.model}: ${modelLabel} · ${labels.effort}: ${eLabel}`;

  return (
    <MenuShell
      {...menu}
      className="cmm--model"
      triggerIcon={<IconBolt size={14} />}
      triggerText={triggerText}
      triggerShort={eLabel}
      ariaLabel={labels.model}
      title={title}
      onOpenChange={(o) => {
        if (!o) setNested(null);
      }}
    >
      {nested === null ? (
        <>
      <button
            type="button"
            className="cmm__row"
            onClick={() => setNested("model")}
          >
            <span>{labels.model}</span>
            <span className="cmm__row-val">
              {modelLabel}
              <IconChevronRight size={14} />
            </span>
          </button>
          <button
            type="button"
            className="cmm__row"
            onClick={() => setNested("effort")}
          >
            <span>{labels.effort}</span>
            <span className="cmm__row-val">
              {eLabel}
              <IconChevronRight size={14} />
            </span>
          </button>
          {onCompare && modelList.length > 1 ? (
            <button
              type="button"
              className="cmm__row"
              onClick={() => {
                setCompareIds([modelId].filter(Boolean));
                setNested("compare");
              }}
            >
              <span>{labels.compare}</span>
              <span className="cmm__row-val">{modelList.length > 4 ? "2–4" : modelList.length}</span>
            </button>
          ) : null}
        </>
      ) : (
        <div className="cmm__nested">
          <button
            type="button"
            className="cmm__back"
            onClick={() => setNested(null)}
          >
            {nested === "model"
              ? labels.model
              : nested === "effort"
                ? labels.effort
                : labels.compare}
          </button>
          {nested === "model" &&
            (modelList.length === 0 ? (
              <div className="cmm__opt cmm__opt--muted" role="status">
                <span className="cmm__opt-main">
                  <span className="cmm__opt-title">{modelId || "—"}</span>
                </span>
              </div>
            ) : (
              modelList.map((m) => (
                (() => {
                  const health = modelHealth[m.id];
                  const healthLabel = health
                    ? [
                        health.averageLatencyMs != null
                          ? labels.healthLatency.replace(
                              "{n}",
                              String(Math.round(health.averageLatencyMs)),
                            )
                          : null,
                        health.failureRate != null
                          ? labels.healthFailure.replace(
                              "{n}",
                              String(Math.round(health.failureRate * 100)),
                            )
                          : null,
                      ]
                        .filter(Boolean)
                        .join(" · ")
                    : "";
                  return (
                    <button
                      key={m.id}
                      type="button"
                      className={
                        "cmm__opt" +
                        (m.id === modelId ? " is-active" : "") +
                        (m.blocked ? " is-blocked" : "")
                      }
                      // Marked, never disabled: this reads the *last* turn, and
                      // the user may have just topped the account up. Refusing
                      // the click would make a stale inference unoverridable.
                      onClick={() => {
                        onModel(m.id);
                        setNested(null);
                      }}
                    >
                      <span className="cmm__opt-main">
                        <span className="cmm__opt-title">{m.label}</span>
                        {m.blocked ? (
                          <span className="cmm__opt-desc cmm__opt-desc--blocked">
                            {labels.blocked}
                          </span>
                        ) : m.source === "custom" ? (
                          <span className="cmm__opt-desc">{labels.customProvider}</span>
                        ) : healthLabel ? (
                          <span className="cmm__opt-desc">{healthLabel}</span>
                        ) : null}
                      </span>
                      {m.id === modelId && (
                        <span className="cmm__opt-check" aria-hidden>
                          <IconCheck size={16} />
                        </span>
                      )}
                    </button>
                  );
                })()
              ))
            ))}
          {nested === "effort" && effortList.map((e) => (
            <button
              key={e.id}
              type="button"
              className={"cmm__opt" + (e.id === effort ? " is-active" : "")}
              onClick={() => {
                onEffort(e.id);
                setNested(null);
              }}
            >
              <span className="cmm__opt-main">
                <span className="cmm__opt-title">
                  {resolveEffortLabel(e.id, effortList, labels)}
                </span>
              </span>
              {e.id === effort && (
                <span className="cmm__opt-check" aria-hidden>
                  <IconCheck size={16} />
                </span>
              )}
            </button>
          ))}
          {nested === "compare" && onCompare ? (
            <div className="cmm__compare">
              <p className="cmm__hint">{labels.compareHint}</p>
              {modelList.map((model) => {
                const checked = compareIds.includes(model.id);
                const disabled = !checked && compareIds.length >= 4;
                return (
                  <label className="cmm__check" key={model.id}>
                    <input
                      type="checkbox"
                      checked={checked}
                      disabled={disabled}
                      onChange={() =>
                        setCompareIds((current) =>
                          checked
                            ? current.filter((id) => id !== model.id)
                            : [...current, model.id],
                        )
                      }
                    />
                    <span>{model.label || model.id}</span>
                  </label>
                );
              })}
              <button
                type="button"
                className="cmm__run"
                disabled={compareIds.length < 2}
                onClick={() => {
                  onCompare(compareIds);
                  menu.setOpen(false);
                }}
              >
                {labels.compareRun}
              </button>
              {onCompareWorktrees ? (
                <button
                  type="button"
                  className="cmm__run cmm__run--secondary"
                  disabled={compareIds.length < 2}
                  onClick={() => {
                    onCompareWorktrees(compareIds);
                    menu.setOpen(false);
                  }}
                >
                  {labels.compareWorktrees}
                </button>
              ) : null}
            </div>
          ) : null}
        </div>
      )}
    </MenuShell>
  );
}

/* ---------- Approvals (permission policy) ---------- */

export interface ComposerApprovalsMenuProps {
  policy: string;
  labels: {
    title: string;
    learnMore: string;
    aria: string;
    ask: string;
    askDesc: string;
    acceptEdits: string;
    acceptEditsDesc: string;
    session: string;
    sessionDesc: string;
    dontAsk: string;
    dontAskDesc: string;
    full: string;
    fullDesc: string;
    shortAsk: string;
    shortAccept: string;
    shortSession: string;
    shortDontAsk: string;
    shortFull: string;
  };
  onPolicy: (id: PermissionPolicyId) => void;
  /** Open the relevant settings / docs surface (the “Learn more” link). */
  onLearnMore?: () => void;
}

type ApprovalRow = {
  id: PermissionPolicyId;
  icon: ReactNode;
  title: string;
  desc: string;
  short: string;
  danger?: boolean;
};

function buildRows(
  labels: ComposerApprovalsMenuProps["labels"],
): ApprovalRow[] {
  return [
    {
      id: "ask",
      icon: <IconHandStop size={18} />,
      title: labels.ask,
      desc: labels.askDesc,
      short: labels.shortAsk,
    },
    {
      id: "accept_edits",
      icon: <IconShieldCheck size={18} />,
      title: labels.acceptEdits,
      desc: labels.acceptEditsDesc,
      short: labels.shortAccept,
    },
    {
      id: "allow_for_session",
      icon: <IconShield size={18} />,
      title: labels.session,
      desc: labels.sessionDesc,
      short: labels.shortSession,
    },
    {
      id: "dont_ask",
      icon: <IconHandStop size={18} />,
      title: labels.dontAsk,
      desc: labels.dontAskDesc,
      short: labels.shortDontAsk,
      danger: true,
    },
    {
      id: "always_approve",
      icon: <IconAlertTriangle size={18} />,
      title: labels.full,
      desc: labels.fullDesc,
      short: labels.shortFull,
      danger: true,
    },
  ];
}

export function ComposerApprovalsMenu({
  policy,
  labels,
  onPolicy,
  onLearnMore,
}: ComposerApprovalsMenuProps) {
  const menu = usePortalMenu(400, 320);
  const rows = useMemo(() => buildRows(labels), [labels]);
  const active = rows.find((r) => r.id === policy) ?? rows[0]!;
  const isDanger = active.id === "always_approve";

  return (
    <MenuShell
      {...menu}
      className={`cmm--access${isDanger ? " cmm--danger" : ""}`}
      triggerIcon={active.icon}
      triggerText={active.short}
      ariaLabel={labels.aria}
    >
      <div className="cmm__header cmm__header--row">
        <div className="cmm__header-title">{labels.title}</div>
        {onLearnMore ? (
          <button
            type="button"
            className="approvals__learn"
            onClick={() => {
              onLearnMore();
              menu.setOpen(false);
            }}
          >
            {labels.learnMore}
          </button>
        ) : null}
      </div>

      <div className="cmm__nested">
        {rows.map((r) => {
          const on = r.id === policy;
          return (
            <button
              key={r.id}
              type="button"
              className={
                "cmm__opt cmm__opt--rich" +
                (on ? " is-active" : "") +
                (r.danger ? " is-danger" : "")
              }
              onClick={() => {
                onPolicy(r.id);
                menu.setOpen(false);
              }}
            >
              <span className="cmm__opt-icon" aria-hidden>
                {r.icon}
              </span>
              <span className="cmm__opt-main">
                <span className="cmm__opt-title">{r.title}</span>
                <span className="cmm__opt-desc">{r.desc}</span>
              </span>
              {on ? (
                <span className="cmm__opt-check" aria-hidden>
                  <IconCheck size={16} />
                </span>
              ) : null}
            </button>
          );
        })}
      </div>
    </MenuShell>
  );
}
