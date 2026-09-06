/**
 * Resolve a local filesystem path (or remote URL) to something an <img> can load.
 *
 * Prefer the custom `media://` protocol for absolute paths — Tauri's built-in
 * `asset://` scope often rejects real user paths (and Chinese segments), which
 * floods the console and reflows the chat on every scroll retry.
 *
 * Resolution is synchronous + cached so chat image cards never flash through a
 * zero-height state (pending → img) that collapses scrollHeight and yanks the
 * viewport to the top while the user is reading history.
 */

import { convertFileSrc } from "@tauri-apps/api/core";
import { isTauri } from "@/lib/api";

/** Cache path → viewable URL (or null on hard failure). */
const resolveCache = new Map<string, string | null>();

/** Already-viewable URL schemes. */
export function isViewableSrc(src: string): boolean {
  return (
    src.startsWith("http://") ||
    src.startsWith("https://") ||
    src.startsWith("data:") ||
    src.startsWith("blob:") ||
    src.startsWith("asset:") ||
    src.startsWith("media:") ||
    src.startsWith("https://asset.localhost") ||
    src.startsWith("http://asset.localhost") ||
    src.startsWith("https://media.localhost") ||
    src.startsWith("http://media.localhost") ||
    src.includes("://asset.localhost") ||
    src.includes("://media.localhost")
  );
}

function looksAbsoluteFsPath(raw: string): boolean {
  return raw.startsWith("/") || /^[A-Za-z]:[\\/]/.test(raw);
}

/**
 * Sync resolve (preferred for chat cards).
 * Returns null when the path cannot be turned into a viewable src.
 */
export function resolveImageSrcSync(pathOrUrl: string): string | null {
  const raw = pathOrUrl.trim();
  if (!raw) return null;
  if (isViewableSrc(raw)) return raw;

  if (resolveCache.has(raw)) {
    return resolveCache.get(raw) ?? null;
  }

  // Ellipsis-truncated paths need host smart-open first (not convertFileSrc).
  if (raw.startsWith("...") || raw.startsWith("…") || raw.includes("/.../")) {
    resolveCache.set(raw, null);
    return null;
  }

  if (!looksAbsoluteFsPath(raw)) {
    resolveCache.set(raw, null);
    return null;
  }

  if (!isTauri()) {
    // Browser-only dev: cannot read arbitrary local files.
    resolveCache.set(raw, null);
    return null;
  }

  try {
    // media protocol: registered in host, reads any absolute path without
    // assetProtocol scope denials that cause scroll-time error spam.
    const url = convertFileSrc(raw, "media");
    resolveCache.set(raw, url);
    return url;
  } catch {
    try {
      const url = convertFileSrc(raw);
      resolveCache.set(raw, url);
      return url;
    } catch {
      resolveCache.set(raw, null);
      return null;
    }
  }
}

/**
 * Convert absolute local path → convertFileSrc URL.
 * Pass-through for http(s)/data/blob.
 *
 * Uses `media` protocol (no asset-scope gate; Range-capable).
 * Async wrapper kept for call sites; resolves immediately via sync cache.
 */
export async function resolveImageSrc(
  pathOrUrl: string,
): Promise<string | null> {
  return resolveImageSrcSync(pathOrUrl);
}

/** Resolve many paths; preserves order, drops failures. */
export async function resolveImageSrcs(
  paths: string[],
): Promise<{ path: string; src: string }[]> {
  const out: { path: string; src: string }[] = [];
  for (const path of paths) {
    const src = resolveImageSrcSync(path);
    if (src) out.push({ path, src });
  }
  return out;
}

/** Test helper — clear the resolve cache. */
export function clearImageSrcCache(): void {
  resolveCache.clear();
}
