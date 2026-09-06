import { useEffect, useRef, useState } from "react";
import * as api from "@/lib/api";
import type { SessionContentHit } from "@/lib/sessionSearch";

export type ContentSearchDeps = {
  showSearch: boolean;
  searchQuery: string;
  debounceMs?: number;
};

export type ContentSearchState = {
  contentSearchHits: SessionContentHit[];
  contentSearchLoading: boolean;
};

/** Debounced journal search with stale-result protection for the search modal. */
export function useContentSearch({
  showSearch,
  searchQuery,
  debounceMs = 280,
}: ContentSearchDeps): ContentSearchState {
  const [contentSearchHits, setContentSearchHits] = useState<SessionContentHit[]>([]);
  const [contentSearchLoading, setContentSearchLoading] = useState(false);
  const contentSearchSeq = useRef(0);

  useEffect(() => {
    if (!showSearch) {
      setContentSearchHits([]);
      setContentSearchLoading(false);
      return;
    }
    const query = searchQuery.trim();
    if (query.startsWith(">") || !query) {
      setContentSearchHits([]);
      setContentSearchLoading(false);
      return;
    }

    setContentSearchLoading(true);
    const sequence = ++contentSearchSeq.current;
    const timer = window.setTimeout(() => {
      void (async () => {
        try {
          const hits = await api.sessionsSearch(query, 20);
          if (contentSearchSeq.current !== sequence) return;
          setContentSearchHits(
            hits.map((hit) => ({
              id: hit.id,
              title: hit.title,
              projectId: hit.projectId,
              snippet: hit.snippet,
              matchCount: hit.matchCount,
              updatedAt: hit.updatedAt,
              archived: hit.archived,
            })),
          );
        } catch {
          if (contentSearchSeq.current !== sequence) return;
          setContentSearchHits([]);
        } finally {
          if (contentSearchSeq.current === sequence) {
            setContentSearchLoading(false);
          }
        }
      })();
    }, debounceMs);
    return () => window.clearTimeout(timer);
  }, [debounceMs, searchQuery, showSearch]);

  return { contentSearchHits, contentSearchLoading };
}
