/** Honest, deliberately conservative prompt preview. Provider billing remains
 * authoritative; this only helps decide whether a large staged prompt is worth
 * sending on the selected model. */

export interface PromptCostPreview {
  promptTokens: number;
  estimatedCost: number | null;
  pricePerMillion: number | null;
}

/**
 * Input price per million tokens, keyed by a substring of the model id.
 *
 * Order here is irrelevant — the *longest* matching needle wins, not the first.
 * That matters: `gpt-4o-mini` contains both `gpt-4` and `mini`, and billing it
 * at the `gpt-4` rate overstates it by more than thirty times. Same rule the
 * task-batch model resolver already uses for the same reason.
 */
const INPUT_PRICE_PER_MILLION: Array<[string, number]> = [
  ["opus", 15],
  ["gpt-5-mini", 0.25],
  ["gpt-5", 2.5],
  ["gpt-4o-mini", 0.15],
  ["gpt-4", 5],
  ["sonnet", 3],
  ["haiku", 0.8],
  ["mini", 0.15],
  ["flash", 0.3],
  ["deepseek", 0.27],
];

/**
 * Characters an attachment adds to the prompt.
 *
 * Attachments are sent as `@/absolute/path` references, one per line — the file
 * contents are not inlined, the agent reads them later with a tool call. So the
 * prompt cost of attaching a 5 MB PDF really is just its path, and pretending
 * otherwise would make the preview alarming and wrong. The cost of *reading* it
 * lands on a later turn, where the real usage figures already measure it.
 */
function attachmentChars(reference: string): number {
  return reference.length + 2; // '@' + the newline joining it to the body
}

export function promptCostPreview(
  modelId: string,
  text: string,
  attachmentRefs: string[] = [],
): PromptCostPreview {
  const chars =
    text.length + attachmentRefs.reduce((sum, ref) => sum + attachmentChars(ref), 0);
  const promptTokens = chars > 0 ? Math.ceil(chars / 4) : 0;

  const lower = modelId.toLowerCase();
  // Most specific match wins, so a narrower id never gets a broader id's price.
  const pricePerMillion =
    INPUT_PRICE_PER_MILLION.filter(([needle]) => lower.includes(needle)).sort(
      (a, b) => b[0].length - a[0].length,
    )[0]?.[1] ?? null;

  return {
    promptTokens,
    pricePerMillion,
    estimatedCost:
      pricePerMillion == null ? null : (promptTokens / 1_000_000) * pricePerMillion,
  };
}
