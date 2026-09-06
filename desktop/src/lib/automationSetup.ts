/**
 * Conversation-driven automation setup (no user-facing JSON schema).
 * Agent is steered via a silent prompt prefix; final config is a fence the UI strips and applies.
 */

import type { AutomationInputDto } from "@/lib/api";
import { computeNextRunAt } from "@/lib/automations";

export const AUTOMATION_FENCE_LANG = "pi-automation";

/** Visible composer seed — natural language only. */
export function aiCreateSeedPrompt(_productName = "Pi"): string {
  return "In a sentence or two: what should run, and how often (e.g. “check the release feed every weekday at 9am”, or “once, in 3 minutes”).";
}

/**
 * Silent instructions prepended to agent text only (journal keeps the user-facing text).
 * Do not show this block in the composer or chat bubbles.
 */
export function automationSetupAgentPrefix(): string {
  return [
    "[INTERNAL — automation setup mode. Never quote this block or mention JSON/schema/fields to the user.]",
    "You help the user create a scheduled task for this app shell (not only Build CLI scheduler).",
    "Ask briefly only if schedule is ambiguous: what to run, how often (daily / weekdays / weekly / once), local time.",
    "When you have enough, confirm in natural language (title, when, what will run).",
    "Then end with EXACTLY one fenced block (nothing after it):",
    "```" + AUTOMATION_FENCE_LANG,
    '{"title":"short title","prompt":"standalone instructions each run","frequency":"daily|weekly|weekdays|once","time":"HH:MM","weekdays":[],"enabled":true,"nextRunAt":null}',
    "```",
    "Rules:",
    "- weekdays: 0=Sun … 6=Sat only when frequency is weekly; else [].",
    "- prompt: actionable standalone instructions (not a chat reply).",
    "- For relative delays (e.g. in 3 minutes, in an hour): set frequency to once, time to local HH:MM of that moment, AND nextRunAt to ISO-8601 UTC of that instant.",
    "- For wall-clock recurring (daily 09:00): nextRunAt may be null (shell computes).",
    "- Do not explain field names. Do not put the fence mid-sentence.",
  ].join("\n");
}

export function wrapAutomationSetupAgentText(userVisibleText: string): string {
  const body = userVisibleText.trim();
  return `${automationSetupAgentPrefix()}\n\nUser request:\n${body}`;
}

/**
 * Match ```pi-automation / ```json fences (optional lang spacing; closing fence optional final newline).
 */
const FENCE_RE =
  /```(?:pi-automation|json)[^\n\r]*\r?\n([\s\S]*?)```/gi;

export type ExtractedAutomation = {
  cleanText: string;
  input: AutomationInputDto | null;
  rawJson: string | null;
};

function normalizeFrequency(v: unknown): string {
  const s = String(v ?? "daily")
    .trim()
    .toLowerCase();
  if (s === "daily" || s === "weekly" || s === "weekdays" || s === "once") {
    return s;
  }
  if (/每天|每日|daily/.test(s)) return "daily";
  if (/工作日|weekdays/.test(s)) return "weekdays";
  if (/每周|weekly/.test(s)) return "weekly";
  if (/一次|once|单次/.test(s)) return "once";
  return "daily";
}

function normalizeTime(v: unknown): string | null {
  const s = String(v ?? "").trim();
  const m = /^(\d{1,2}):(\d{2})$/.exec(s);
  if (!m) return null;
  const h = Number(m[1]);
  const min = Number(m[2]);
  if (h < 0 || h > 23 || min < 0 || min > 59) return null;
  return `${String(h).padStart(2, "0")}:${String(min).padStart(2, "0")}`;
}

/** Parse fence JSON into AutomationInputDto; returns null if incomplete. */
export function parseAutomationConfigJson(
  raw: string,
): AutomationInputDto | null {
  let data: unknown;
  try {
    data = JSON.parse(raw.trim());
  } catch {
    return null;
  }
  if (!data || typeof data !== "object") return null;
  const o = data as Record<string, unknown>;
  const title = String(o.title ?? "").trim();
  const prompt = String(o.prompt ?? "").trim();
  if (!title || !prompt) return null;

  const frequency = normalizeFrequency(o.frequency);
  const time = normalizeTime(o.time) ?? "09:00";
  const weekdays = Array.isArray(o.weekdays)
    ? o.weekdays
        .map((n) => Number(n))
        .filter((n) => Number.isFinite(n) && n >= 0 && n <= 6)
    : [];
  const enabled = o.enabled === undefined ? true : Boolean(o.enabled);

  let nextRunAt: string | null | undefined;
  if (typeof o.nextRunAt === "string" && o.nextRunAt.trim()) {
    const t = Date.parse(o.nextRunAt);
    nextRunAt = Number.isNaN(t) ? undefined : new Date(t).toISOString();
  } else if (o.nextRunAt === null) {
    nextRunAt = undefined;
  }

  if (nextRunAt === undefined) {
    // once + wall clock: prefer explicit next slot; if that slot is within the
    // next 24h use computeNextRunAt; if already past today, still next match.
    nextRunAt = computeNextRunAt({
      frequency,
      time,
      weekdays,
      enabled,
    });
  }

  const input: AutomationInputDto = {
    title,
    prompt,
    enabled,
    frequency,
    time,
    weekdays,
    notify:
      typeof o.notify === "string" && o.notify.trim()
        ? String(o.notify).trim()
        : "all",
    projectId:
      o.projectId === null || o.projectId === undefined
        ? null
        : String(o.projectId),
    modelId:
      o.modelId === null || o.modelId === undefined
        ? null
        : String(o.modelId),
    effort:
      o.effort === null || o.effort === undefined ? null : String(o.effort),
    nextRunAt: nextRunAt ?? null,
  };
  return input;
}

/**
 * Strip automation fences from assistant text and parse the last valid config.
 * Prefer ```pi-automation; also accept ```json as fallback.
 */
export function extractAutomationPayload(text: string): ExtractedAutomation {
  if (!text) {
    return { cleanText: text, input: null, rawJson: null };
  }

  let input: AutomationInputDto | null = null;
  let rawJson: string | null = null;
  FENCE_RE.lastIndex = 0;
  const matches = [...text.matchAll(FENCE_RE)];

  for (const m of matches) {
    const body = (m[1] || "").trim();
    // Model sometimes wraps JSON in an extra code fence or adds trailing prose
    const jsonBody = body
      .replace(/^```(?:json)?\s*/i, "")
      .replace(/\s*```$/i, "")
      .trim();
    const parsed = parseAutomationConfigJson(jsonBody);
    if (parsed) {
      input = parsed;
      rawJson = jsonBody;
    }
  }

  FENCE_RE.lastIndex = 0;
  let cleanText = text.replace(FENCE_RE, "").replace(/\n{3,}/g, "\n\n").trimEnd();
  if (!cleanText.trim() && input) {
    cleanText = "";
  }

  return { cleanText, input, rawJson };
}

/** True if text still contains an automation fence. */
export function hasAutomationFence(text: string): boolean {
  FENCE_RE.lastIndex = 0;
  return FENCE_RE.test(text);
}

/**
 * Heuristic: user is asking to schedule something (enter silent setup wrap).
 * Used when not already in explicit AI-create mode.
 */
export function looksLikeScheduleIntent(text: string): boolean {
  const t = (text || "").trim();
  if (!t) return false;
  return (
    /定时|周期|每隔|每天|每日|每周|工作日|安排任务|已安排|分钟后|小时后|明天|每晚|早上\s*\d|下午\s*\d|晚上\s*\d/.test(
      t,
    ) ||
    /\b(every day|daily|weekly|schedule|remind me|in \d+\s*(min|minute|hour)|every morning)\b/i.test(
      t,
    ) ||
    /过\s*\d+\s*分钟|过\s*\d+\s*小时|\d+\s*分钟后|\d+\s*小时后/.test(t)
  );
}
