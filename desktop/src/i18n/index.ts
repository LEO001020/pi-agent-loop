/**
 * App i18n helpers. All user-visible copy must go through `t()`.
 * See docs/llm-wiki/i18n.md for agent maintenance rules.
 */

import {
  isLocale,
  messages,
  type Locale,
  type MessageKey,
} from "./messages";

export type { Locale, MessageKey };
export { isLocale, messages };

export type Vars = Record<string, string | number | undefined | null>;

function interpolate(template: string, vars?: Vars): string {
  if (!vars) return template;
  return template.replace(/\{(\w+)\}/g, (_, key: string) => {
    const v = vars[key];
    return v == null ? "" : String(v);
  });
}

/** Translate a key for the given locale. Missing keys fall back to English then the key. */
export function t(locale: Locale, key: MessageKey, vars?: Vars): string {
  const table = messages[locale] ?? messages.en;
  const raw = table[key] ?? messages.en[key] ?? String(key);
  return interpolate(raw, vars);
}

export function createT(locale: Locale) {
  return (key: MessageKey, vars?: Vars) => t(locale, key, vars);
}

/** Resolve stored locale id; fall back to "en" for unrecognized values. */
export function resolveLocale(raw: string | undefined | null): Locale {
  if (raw === "zh") return "zh";
  return "en";
}
