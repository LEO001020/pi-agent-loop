/**
 * Pure helpers for Settings → Permissions rule editor.
 *
 * Pi CLI compact form in config.toml:
 *   [permission]
 *   deny = ["Bash(rm -rf *)"]
 *   allow = ["Bash(git *)"]
 *   ask = ["Edit"]
 *
 * Evaluation: deny > ask > allow (see Pi user guide).
 */

export type PermissionRuleAction = "allow" | "deny" | "ask";

export type PermissionRulesLike = {
  allow: string[];
  deny: string[];
  ask: string[];
};

/** Severity order used in UI lists (deny wins first). */
export const PERMISSION_RULE_ACTIONS: PermissionRuleAction[] = [
  "deny",
  "ask",
  "allow",
];

export function normalizeRuleAction(
  raw: string | null | undefined,
): PermissionRuleAction | null {
  const t = (raw ?? "").trim().toLowerCase();
  if (t === "allow" || t === "deny" || t === "ask") return t;
  return null;
}

/** Trim; empty → null. */
export function normalizeRuleText(
  raw: string | null | undefined,
): string | null {
  const s = (raw ?? "").trim();
  return s ? s : null;
}

/** Dedupe preserving order (first wins). */
export function dedupeRules(rules: string[] | null | undefined): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const r of rules ?? []) {
    const n = normalizeRuleText(r);
    if (!n || seen.has(n)) continue;
    seen.add(n);
    out.push(n);
  }
  return out;
}

export function normalizeRules(
  rules: Partial<PermissionRulesLike> | null | undefined,
): PermissionRulesLike {
  return {
    allow: dedupeRules(rules?.allow),
    deny: dedupeRules(rules?.deny),
    ask: dedupeRules(rules?.ask),
  };
}

export function bucketFor(
  rules: PermissionRulesLike,
  action: PermissionRuleAction,
): string[] {
  return rules[action] ?? [];
}

/** Add a rule to one bucket (no-op if duplicate). */
export function addRule(
  rules: PermissionRulesLike,
  action: string,
  rule: string,
): PermissionRulesLike | null {
  const a = normalizeRuleAction(action);
  const r = normalizeRuleText(rule);
  if (!a || !r) return null;
  const next = normalizeRules(rules);
  if (!next[a].includes(r)) next[a] = [...next[a], r];
  return next;
}

/** Remove an exact rule from one bucket. */
export function removeRule(
  rules: PermissionRulesLike,
  action: string,
  rule: string,
): PermissionRulesLike | null {
  const a = normalizeRuleAction(action);
  const r = normalizeRuleText(rule);
  if (!a || !r) return null;
  const next = normalizeRules(rules);
  next[a] = next[a].filter((x) => x !== r);
  return next;
}

/** Flat list for rendering: [{ action, rule }] in severity order. */
export function flattenRules(
  rules: PermissionRulesLike,
): Array<{ action: PermissionRuleAction; rule: string }> {
  const n = normalizeRules(rules);
  const out: Array<{ action: PermissionRuleAction; rule: string }> = [];
  for (const action of PERMISSION_RULE_ACTIONS) {
    for (const rule of n[action]) {
      out.push({ action, rule });
    }
  }
  return out;
}

export function ruleRowKey(action: string, rule: string): string {
  return `${action}:${rule}`;
}

/** Example placeholders for the add-rule field. */
export function rulePlaceholder(action: PermissionRuleAction): string {
  switch (action) {
    case "deny":
      return "Bash(rm -rf *)";
    case "ask":
      return "Edit";
    case "allow":
    default:
      return "Bash(git *)";
  }
}

/** Total rule count across buckets. */
export function rulesCount(rules: PermissionRulesLike | null | undefined): number {
  if (!rules) return 0;
  return (
    (rules.allow?.length ?? 0) +
    (rules.deny?.length ?? 0) +
    (rules.ask?.length ?? 0)
  );
}
