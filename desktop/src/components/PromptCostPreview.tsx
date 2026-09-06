import { promptCostPreview } from "@/lib/costPreview";

type T = (key: string, vars?: Record<string, string | number>) => string;

export function PromptCostPreview({
  modelId,
  text,
  attachmentRefs,
  t,
}: {
  modelId: string;
  text: string;
  /** Absolute paths, as they are serialized into the prompt (`@/path`). */
  attachmentRefs: string[];
  t: T;
}) {
  const preview = promptCostPreview(modelId, text, attachmentRefs);
  if (!preview.promptTokens) return null;
  const tokens = preview.promptTokens.toLocaleString();
  const cost = preview.estimatedCost == null
    ? t("costPreview.unknown")
    : t("costPreview.usd", { value: preview.estimatedCost.toFixed(4) });
  return (
    <span className="prompt-cost-preview" title={t("costPreview.hint")}>
      {t("costPreview.value", { tokens, cost })}
    </span>
  );
}
