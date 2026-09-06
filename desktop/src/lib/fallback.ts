/** Pure routing helpers for the opt-in provider fallback chain. */

export type FallbackChains = Record<string, string[]>;

/** Only failures that may clear on a retry are eligible for silent hand-off. */
export function isTransientFallbackError(
  code?: string | null,
  message = "",
): boolean {
  const normalized = `${code ?? ""}\n${message}`.toLowerCase();
  if (/auth|unauthor|entitlement|unpurchased|not purchased|billing|payment/.test(normalized)) {
    return false;
  }
  return (
    code === "QUOTA_EXCEEDED" ||
    code === "NETWORK_PROVIDER" ||
    /quota|rate.?limit|\b429\b|provider unavailable|service unavailable|timeout/.test(
      normalized,
    )
  );
}

/**
 * Return the next configured model after `current`, resolving role aliases
 * against the live catalog. Unknown entries are skipped rather than handed to
 * the host where they would create a second, less useful error.
 *
 * `alreadyAttempted` must list every model this turn has already spent a
 * request on. Two roles whose chains name each other (`fast: [a, b]`,
 * `deep: [b, a]`) otherwise hand the turn back and forth forever, and every
 * hop is a real billed call — so the exclusion lives here, where it is
 * testable, rather than in the caller that happens to remember.
 */
export function nextFallbackModel(
  current: string,
  modelRoles: Record<string, string>,
  chains: FallbackChains,
  availableModelIds: string[],
  alreadyAttempted: string[] = [],
): { modelId: string; role: string } | null {
  const role = Object.entries(modelRoles).find(([, id]) => id === current)?.[0];
  if (!role) return null;
  const spent = new Set([current, ...alreadyAttempted]);
  const chain = chains[role] ?? [];
  const index = chain.findIndex((id) => id === current);
  const start = index >= 0 ? index + 1 : 0;
  for (const candidate of chain.slice(start)) {
    if (availableModelIds.includes(candidate) && !spent.has(candidate)) {
      return { modelId: candidate, role };
    }
  }
  return null;
}
