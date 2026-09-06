import { useMemo } from "react";
import type { Locale } from "@/i18n";
import { createT } from "@/i18n";
import { GlassModal } from "@/components/GlassModal";

export function StatusModal({
  open,
  locale,
  sessionId,
  agentSessionId,
  modelId,
  effort,
  mode,
  policy,
  projectPath,
  messageCount,
  onClose,
}: {
  open: boolean;
  locale: Locale;
  sessionId?: string | null;
  agentSessionId?: string | null;
  modelId?: string | null;
  effort?: string | null;
  mode?: string | null;
  policy?: string | null;
  projectPath?: string | null;
  messageCount?: number;
  onClose: () => void;
}) {
  const tr = useMemo(() => createT(locale), [locale]);

  const rows: { label: string; value: string }[] = [
    { label: tr("statusModal.sessionId"), value: sessionId || "—" },
    { label: tr("statusModal.agentSessionId"), value: agentSessionId || "—" },
    { label: tr("statusModal.model"), value: modelId || "—" },
    { label: tr("statusModal.effort"), value: effort || "—" },
    { label: tr("statusModal.mode"), value: mode || "—" },
    { label: tr("statusModal.policy"), value: policy || "—" },
    { label: tr("statusModal.project"), value: projectPath || "—" },
    {
      label: tr("statusModal.messages"),
      value: String(messageCount ?? 0),
    },
  ];

  return (
    <GlassModal
      open={open}
      onClose={onClose}
      title={tr("statusModal.title")}
      titleId="status-modal-title"
      closeLabel={tr("common.close")}
      size="md"
      className="status-modal"
      footer={
        <button type="button" className="btn btn--solid" onClick={onClose}>
          {tr("common.close")}
        </button>
      }
    >
      <dl className="status-modal__dl">
        {rows.map((r) => (
          <div key={r.label} className="status-modal__row">
            <dt>{r.label}</dt>
            <dd title={r.value}>{r.value}</dd>
          </div>
        ))}
      </dl>
    </GlassModal>
  );
}
