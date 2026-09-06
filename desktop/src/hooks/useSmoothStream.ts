/**
 * Smooth out bursty stream updates into a steady reveal.
 * When active, display lags the target slightly and catches up adaptively.
 * When inactive (stream done), returns the full target immediately.
 */

import { useEffect, useRef, useState } from "react";
import { stepDisplayed } from "@/lib/smoothStream";

export function useSmoothStream(target: string, active: boolean): string {
  // Start at current target so already-buffered text doesn't re-type on mount.
  // Only *new* growth is drip-revealed while active.
  const [displayed, setDisplayed] = useState(target);
  const targetRef = useRef(target);
  const activeRef = useRef(active);
  const displayedRef = useRef(displayed);

  targetRef.current = target;
  activeRef.current = active;

  // Stream finished or never streaming — show full text.
  useEffect(() => {
    if (!active) {
      displayedRef.current = target;
      setDisplayed(target);
    }
  }, [active, target]);

  // While streaming, rAF-drive adaptive reveal toward latest target.
  useEffect(() => {
    if (!active) return;

    let raf = 0;
    let last = 0;

    const tick = (now: number) => {
      if (!activeRef.current) return;

      // ~30–60 fps; skip ultra-fast double frames
      if (now - last < 14) {
        raf = requestAnimationFrame(tick);
        return;
      }
      last = now;

      const full = targetRef.current;
      const prev = displayedRef.current;
      if (prev === full) {
        // Caught up — keep listening for the next chunk.
        raf = requestAnimationFrame(tick);
        return;
      }

      const next = stepDisplayed(prev, full);
      if (next !== prev) {
        displayedRef.current = next;
        setDisplayed(next);
      }
      raf = requestAnimationFrame(tick);
    };

    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [active]);

  if (!active) return target;
  return displayed;
}
