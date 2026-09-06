import { useEffect, useState } from "react";
import * as api from "@/lib/api";

export type ModelHealth = {
  averageLatencyMs: number | null;
  failureRate: number | null;
};

export type ModelHealthMap = Record<string, ModelHealth>;

export function indexModelHealth(rows: api.UsageProviderHealth[]): ModelHealthMap {
  const next: ModelHealthMap = {};
  for (const row of rows) {
    if (row.modelId) {
      next[row.modelId] = {
        averageLatencyMs: row.averageLatencyMs,
        failureRate: row.failureRate,
      };
    }
  }
  return next;
}

/** Refresh local rolling provider health without coupling App.tsx to polling. */
export function useModelHealth(enabled: boolean): ModelHealthMap {
  const [health, setHealth] = useState<ModelHealthMap>({});

  useEffect(() => {
    if (!enabled) return;
    let cancelled = false;
    const refresh = () => {
      void api
        .usageProviderHealth()
        .then((rows) => {
          if (!cancelled) setHealth(indexModelHealth(rows));
        })
        .catch(() => {});
    };
    refresh();
    const timer = window.setInterval(refresh, 30_000);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [enabled]);

  return health;
}

