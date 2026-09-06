import type { OrbState } from "thinking-orbs";
import type { ChatMessage } from "@/lib/session";

export type InlineOrbState = "thinking" | "working" | "searching" | "done";

export const INLINE_ORB_STATE_MAP: Readonly<Record<InlineOrbState, OrbState>> = {
  thinking: "composing",
  working: "working",
  searching: "searching",
  // The package has no completed preset. A paused shaping frame reads as a
  // settled result without incorrectly describing completed work as "solving".
  done: "shaping",
};

const SEARCH_ACTIVITY =
  /\b(search|browser|browse|web|fetch|crawl|scrape|lookup|url|http|curl|wget)\b/i;

export function inlineOrbStateForTool(
  message: Pick<
    ChatMessage,
    "toolKind" | "toolDetail" | "toolPath" | "content"
  >,
): InlineOrbState {
  const activity = [
    message.toolKind,
    message.toolDetail,
    message.toolPath,
    message.content,
  ]
    .filter(Boolean)
    .join(" ");

  return SEARCH_ACTIVITY.test(activity) ? "searching" : "working";
}
