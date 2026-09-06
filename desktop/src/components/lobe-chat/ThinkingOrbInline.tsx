import { ThinkingOrb } from "thinking-orbs";
import { cn } from "@/lib/utils";
import {
  INLINE_ORB_STATE_MAP,
  type InlineOrbState,
} from "./thinkingOrbState";

export type { InlineOrbState } from "./thinkingOrbState";

export function ThinkingOrbInline({
  state = "thinking",
  paused = false,
  className,
  size = 20,
  decorative = true,
}: {
  state?: InlineOrbState;
  paused?: boolean;
  className?: string;
  size?: 20 | 64;
  /** Hide the canvas from assistive tech when adjacent text names the status. */
  decorative?: boolean;
}) {
  return (
    <ThinkingOrb
      state={INLINE_ORB_STATE_MAP[state]}
      size={size}
      theme="auto"
      paused={paused}
      aria-hidden={decorative || undefined}
      className={cn("thinking-orb-inline", className)}
    />
  );
}
