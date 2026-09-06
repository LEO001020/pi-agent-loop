/**
 * Shared image UI: click → lightbox; right-click menu aligned with AttachmentCard
 * (view, reveal, copy image, copy path when a local path is known).
 *
 * Frame keeps a non-zero reserved size (default 4:3, then natural ratio) so chat
 * scrollHeight never collapses to 0 mid-decode — that thrash + overflow-anchor:none
 * was the jump-to-top bug. Container aspect follows the image once known.
 */

import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type CSSProperties,
  type ReactNode,
} from "react";
import * as api from "@/lib/api";
import { copyImageFromSrc } from "@/lib/copyImage";
import { resolveImageSrcSync, isViewableSrc } from "@/lib/imageSrc";
import { useImageViewerOptional } from "@/components/ImageViewer";
import { IconCopy, IconExternalLink, IconFolder } from "@/components/icons";
import { ContextMenu, type ContextMenuItem } from "@/components/ContextMenu";
import { createT, type Locale } from "@/i18n";

export interface ImageUiLabels {
  viewImage: string;
  copyImage: string;
  /** Reveal in Finder — same copy as attach.reveal */
  reveal: string;
  /** Copy path — same copy as attach.copyPath */
  copyPath: string;
  open?: string;
}

/**
 * - `card` — chat inline cards (max 280×280, ratio-aware).
 * - `pane` — resource sidebar: full pane width, natural ratio, no chat caps.
 */
export type ImageUiLayout = "card" | "pane";

interface ImageUiProps {
  src: string;
  alt?: string;
  className?: string;
  style?: CSSProperties;
  /**
   * Absolute filesystem path when known (local previews / attachments).
   * Enables Reveal + Copy path. Remote/data URLs omit these items.
   */
  path?: string;
  /** Sibling sources for gallery prev/next */
  gallery?: string[];
  labels: ImageUiLabels;
  /** Optional extra menu items at the end */
  extraMenu?: ReactNode;
  draggable?: boolean;
  /**
   * Sizing mode. Defaults to `card` for chat; resource pane must pass `pane`.
   */
  layout?: ImageUiLayout;
}

/** Chat card outer cap (px). */
const CARD_MAX_W = 280;
const CARD_MAX_H = 280;
/** Placeholder ratio before natural size is known. */
const DEFAULT_AR = 4 / 3;

/** Remember natural ratios so remounts don't re-reserve the wrong box. */
const aspectCache = new Map<string, number>();

/** True when path looks like a local absolute path we can reveal/copy. */
function isLocalFsPath(path: string | undefined): path is string {
  if (!path) return false;
  if (path.startsWith("http://") || path.startsWith("https://")) return false;
  if (path.startsWith("data:") || path.startsWith("blob:")) return false;
  if (path.startsWith("asset:") || path.includes("asset.localhost")) return false;
  if (path.startsWith("media:") || path.includes("media.localhost")) return false;
  // Unix absolute or Windows drive
  return path.startsWith("/") || /^[A-Za-z]:[\\/]/.test(path);
}

function initialResolvedSrc(src: string): string | null {
  if (isViewableSrc(src)) return src;
  return resolveImageSrcSync(src);
}

function cacheKey(src: string, path?: string): string {
  return path || src;
}

function readCachedAr(src: string, path?: string): number | null {
  const k = cacheKey(src, path);
  return aspectCache.get(k) ?? aspectCache.get(src) ?? null;
}

/** Fit natural ratio into max box; returns width px + aspect ratio. */
function fitCardBox(ar: number): { widthPx: number; ar: number } {
  const ratio = ar > 0 && Number.isFinite(ar) ? ar : DEFAULT_AR;
  // Prefer full card width; shrink width if height would exceed cap.
  let widthPx = CARD_MAX_W;
  let heightPx = widthPx / ratio;
  if (heightPx > CARD_MAX_H) {
    heightPx = CARD_MAX_H;
    widthPx = heightPx * ratio;
  }
  return { widthPx, ar: ratio };
}

function resolveLayout(
  layout: ImageUiLayout | undefined,
  className: string | undefined,
): ImageUiLayout {
  if (layout === "pane" || layout === "card") return layout;
  // Resource pane legacy class names
  if (
    className &&
    (/\brp-preview__img\b/.test(className) ||
      /\brv-preview__img\b/.test(className))
  ) {
    return "pane";
  }
  return "card";
}

function frameClassName(
  className: string | undefined,
  state: "pending" | "ready" | "broken",
  layout: ImageUiLayout,
): string {
  const base = (className || "").replace(/\bmd-body__img\b/g, "").trim();
  const layoutClass =
    layout === "pane"
      ? "md-body__img-frame--pane"
      : "md-body__img-frame--card";
  const parts = [
    "md-body__img-frame",
    layoutClass,
    state === "pending" ? "is-pending" : "",
    state === "broken" ? "is-broken" : "",
    state === "ready" ? "is-ready" : "",
    base,
  ];
  return parts.filter(Boolean).join(" ");
}

export function ImageUi({
  src,
  alt = "",
  className,
  style,
  path,
  gallery,
  labels,
  extraMenu,
  draggable = false,
  layout: layoutProp,
}: ImageUiProps) {
  const layout = resolveLayout(layoutProp, className);
  const viewer = useImageViewerOptional();
  const imgRef = useRef<HTMLImageElement | null>(null);
  const [menu, setMenu] = useState<{ x: number; y: number } | null>(null);
  const [resolvedSrc, setResolvedSrc] = useState<string | null>(() =>
    initialResolvedSrc(src),
  );
  /** Once load fails, keep a stable broken state — never re-fetch on re-render. */
  const [loadFailed, setLoadFailed] = useState(false);
  /**
   * Natural width/height ratio. Seeded from cache so remounts keep the right
   * box; defaults to 4:3 until the bitmap reports size.
   */
  const [aspectRatio, setAspectRatio] = useState<number>(
    () => readCachedAr(src, path) ?? DEFAULT_AR,
  );
  const [ratioKnown, setRatioKnown] = useState(
    () => readCachedAr(src, path) != null,
  );

  const localPath = isLocalFsPath(path)
    ? path
    : isLocalFsPath(src)
      ? src
      : undefined;

  const applyNaturalSize = useCallback(
    (nw: number, nh: number) => {
      if (!(nw > 0 && nh > 0)) return;
      const ar = nw / nh;
      aspectCache.set(cacheKey(src, path), ar);
      aspectCache.set(src, ar);
      if (localPath) aspectCache.set(localPath, ar);
      setAspectRatio(ar);
      setRatioKnown(true);
    },
    [src, path, localPath],
  );

  useEffect(() => {
    const next = initialResolvedSrc(src);
    setResolvedSrc(next);
    setLoadFailed(false);
    const cached = readCachedAr(src, path);
    if (cached != null) {
      setAspectRatio(cached);
      setRatioKnown(true);
    } else {
      setAspectRatio(DEFAULT_AR);
      setRatioKnown(false);
    }
  }, [src, path]);

  // Recover size if decode finished before onLoad bound (disk cache).
  useEffect(() => {
    const el = imgRef.current;
    if (!el || !resolvedSrc || loadFailed) return;
    if (el.complete && el.naturalWidth > 0 && el.naturalHeight > 0) {
      applyNaturalSize(el.naturalWidth, el.naturalHeight);
    }
  }, [resolvedSrc, loadFailed, applyNaturalSize]);

  const openViewer = () => {
    if (!resolvedSrc) return;
    const slides =
      gallery && gallery.length > 0
        ? gallery
        : localPath
          ? [localPath]
          : [resolvedSrc];
    const want = localPath ?? resolvedSrc;
    const idx = Math.max(
      0,
      slides.findIndex(
        (s) => s === want || s === resolvedSrc || s === localPath || s === src,
      ),
    );
    viewer.open(
      slides.map((s) => ({
        src: s,
        alt,
        title: alt || (isLocalFsPath(s) ? s.split(/[/\\]/).pop() : undefined),
      })),
      idx >= 0 ? idx : 0,
    );
  };

  const copyImage = async () => {
    if (!resolvedSrc) return;
    await copyImageFromSrc(resolvedSrc);
  };

  const copyPath = async () => {
    if (!localPath) return;
    try {
      await navigator.clipboard.writeText(localPath);
    } catch {
      /* ignore */
    }
  };

  const revealPath = async () => {
    if (!localPath || !api.isTauri()) return;
    try {
      await api.pathReveal(localPath);
    } catch (e) {
      console.error(e);
    }
  };

  const menuItems: ContextMenuItem[] = [
    {
      id: "view",
      label: labels.viewImage,
      icon: <IconExternalLink size={16} />,
      onClick: () => openViewer(),
      disabled: !resolvedSrc || loadFailed,
    },
  ];
  if (localPath) {
    menuItems.push({
      id: "reveal",
      label: labels.reveal,
      icon: <IconFolder size={16} />,
      onClick: () => {
        void revealPath();
      },
    });
  }
  menuItems.push({
    id: "copy-image",
    label: labels.copyImage,
    icon: <IconCopy size={16} />,
    onClick: () => {
      void copyImage();
    },
    disabled: !resolvedSrc || loadFailed,
  });
  if (localPath) {
    menuItems.push({
      id: "copy-path",
      label: labels.copyPath,
      icon: <IconCopy size={16} />,
      onClick: () => {
        void copyPath();
      },
    });
  }

  const state: "pending" | "ready" | "broken" = loadFailed
    ? "broken"
    : resolvedSrc && ratioKnown
      ? "ready"
      : "pending";

  const ar =
    aspectRatio > 0 && Number.isFinite(aspectRatio)
      ? aspectRatio
      : DEFAULT_AR;

  // Chat cards: cap at 280×280. Resource pane: fill width, natural ratio.
  const frameStyle: CSSProperties =
    layout === "pane"
      ? {
          ...style,
          width: "100%",
          maxWidth: "100%",
          height: "auto",
          maxHeight: "none",
          aspectRatio: `${ar}`,
          ["--img-ar" as string]: String(ar),
        }
      : (() => {
          const box = fitCardBox(ar);
          return {
            ...style,
            width: box.widthPx,
            maxWidth: "100%",
            aspectRatio: `${box.ar}`,
            ["--img-ar" as string]: String(box.ar),
          };
        })();

  return (
    <>
      <span
        className={frameClassName(className, state, layout)}
        style={frameStyle}
        role={loadFailed ? "img" : undefined}
        aria-label={loadFailed ? alt || "image" : undefined}
        title={loadFailed ? localPath || src : undefined}
        onContextMenu={(e) => {
          e.preventDefault();
          e.stopPropagation();
          setMenu({ x: e.clientX, y: e.clientY });
        }}
      >
        {loadFailed ? (
          <span className="md-body__img-frame__fallback">
            {alt || "image"}
          </span>
        ) : resolvedSrc ? (
          <img
            ref={imgRef}
            className="md-body__img-frame__el"
            src={resolvedSrc}
            alt={alt}
            draggable={draggable}
            // Eager: lazy + nested chat scroller unloads/reloads and collapses
            // height mid-scroll (especially WKWebView / Tauri).
            loading="eager"
            decoding="async"
            onLoad={(e) => {
              const el = e.currentTarget;
              applyNaturalSize(el.naturalWidth, el.naturalHeight);
            }}
            onError={() => {
              setLoadFailed(true);
            }}
            onClick={(e) => {
              e.preventDefault();
              e.stopPropagation();
              openViewer();
            }}
          />
        ) : (
          <span className="md-body__img-frame__fallback" aria-hidden>
            {alt || ""}
          </span>
        )}
      </span>
      <ContextMenu
        open={!!menu}
        x={menu?.x ?? 0}
        y={menu?.y ?? 0}
        onClose={() => setMenu(null)}
        items={menuItems}
        extra={extraMenu}
      />
    </>
  );
}

/** Build image UI labels from locale (aligned with attach.* keys). */
export function imageUiLabels(locale: Locale): ImageUiLabels {
  const tr = createT(locale);
  return {
    viewImage: tr("image.view"),
    copyImage: tr("image.copy"),
    reveal: tr("attach.reveal"),
    copyPath: tr("attach.copyPath"),
  };
}
