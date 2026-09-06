/**
 * Inline video card for chat: session-relative / local paths.
 * Plays via Tauri media:// (Range); right-click: open / reveal / copy path.
 */

import { useEffect, useState, type CSSProperties, type ReactNode } from "react";
import * as api from "@/lib/api";
import { pathToPreviewUrl } from "@/lib/filePreviewSrc";
import { IconCopy, IconExternalLink, IconFolder } from "@/components/icons";
import { Tip } from "@/components/ui/tooltip";
import { ContextMenu, type ContextMenuItem } from "@/components/ContextMenu";
import { createT, type Locale } from "@/i18n";
import { pathBasename } from "@/lib/attachments";

export interface VideoUiLabels {
  open: string;
  reveal: string;
  copyPath: string;
  loadError?: string;
}

interface VideoUiProps {
  /** Absolute filesystem path (preferred) or already-viewable URL. */
  src: string;
  /** Absolute path for open/reveal/copy (when known). */
  path?: string;
  title?: string;
  className?: string;
  style?: CSSProperties;
  labels: VideoUiLabels;
  extraMenu?: ReactNode;
}

function isLocalFsPath(path: string | undefined): path is string {
  if (!path) return false;
  if (path.startsWith("http://") || path.startsWith("https://")) return false;
  if (path.startsWith("data:") || path.startsWith("blob:")) return false;
  if (path.startsWith("asset:") || path.includes("asset.localhost")) return false;
  if (path.startsWith("media:") || path.includes("media.localhost")) return false;
  return path.startsWith("/") || /^[A-Za-z]:[\\/]/.test(path);
}

function isViewableVideoSrc(src: string): boolean {
  return (
    src.startsWith("http://") ||
    src.startsWith("https://") ||
    src.startsWith("data:") ||
    src.startsWith("blob:") ||
    src.startsWith("asset:") ||
    src.startsWith("media:") ||
    src.includes("asset.localhost") ||
    src.includes("media.localhost")
  );
}

export function VideoUi({
  src,
  path,
  title = "",
  className,
  style,
  labels,
  extraMenu,
}: VideoUiProps) {
  const localPath = isLocalFsPath(path)
    ? path
    : isLocalFsPath(src)
      ? src
      : undefined;
  const [resolvedSrc, setResolvedSrc] = useState<string | null>(() =>
    isViewableVideoSrc(src) ? src : null,
  );
  const [menu, setMenu] = useState<{ x: number; y: number } | null>(null);
  const [error, setError] = useState(false);

  useEffect(() => {
    let cancelled = false;
    if (isViewableVideoSrc(src)) {
      setResolvedSrc(src);
      return;
    }
    void pathToPreviewUrl(src, "video").then((url) => {
      if (!cancelled) setResolvedSrc(url);
    });
    return () => {
      cancelled = true;
    };
  }, [src]);

  const openExternal = async () => {
    if (!localPath || !api.isTauri()) return;
    try {
      await api.pathOpen(localPath);
    } catch (e) {
      console.error(e);
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

  const copyPath = async () => {
    if (!localPath) return;
    try {
      await navigator.clipboard.writeText(localPath);
    } catch {
      /* ignore */
    }
  };

  const displayTitle = title || (localPath ? pathBasename(localPath) : "");

  const menuItems: ContextMenuItem[] = [];
  if (localPath) {
    menuItems.push(
      {
        id: "open",
        label: labels.open,
        icon: <IconExternalLink size={16} />,
        onClick: () => {
          void openExternal();
        },
      },
      {
        id: "reveal",
        label: labels.reveal,
        icon: <IconFolder size={16} />,
        onClick: () => {
          void revealPath();
        },
      },
      {
        id: "copy-path",
        label: labels.copyPath,
        icon: <IconCopy size={16} />,
        onClick: () => {
          void copyPath();
        },
      },
    );
  }

  if (!resolvedSrc) {
    return (
      <div
        className={"md-body__video-card md-body__video-card--loading " + (className || "")}
        style={style}
      >
        <span className="md-body__video-card__name">{displayTitle || "…"}</span>
      </div>
    );
  }

  return (
    <>
      <div
        className={"md-body__video-card " + (className || "")}
        style={style}
        onContextMenu={(e) => {
          e.preventDefault();
          e.stopPropagation();
          setMenu({ x: e.clientX, y: e.clientY });
        }}
      >
        {error ? (
          <div className="md-body__video-card__error">
            <span>{labels.loadError || "Failed to load video"}</span>
            {localPath && (
              <button
                type="button"
                className="md-body__video-card__btn"
                onClick={() => void openExternal()}
              >
                {labels.open}
              </button>
            )}
          </div>
        ) : (
          <Tip label={displayTitle} disabled={!displayTitle}>
            <video
              className="md-body__video-card__el"
              src={resolvedSrc}
              controls
              playsInline
              preload="metadata"
              onError={() => setError(true)}
            />
          </Tip>
        )}
        {displayTitle ? (
          <Tip label={localPath || displayTitle}>
            <div className="md-body__video-card__caption">
              {displayTitle}
            </div>
          </Tip>
        ) : null}
      </div>
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

export function videoUiLabels(locale: Locale): VideoUiLabels {
  const tr = createT(locale);
  return {
    open: tr("attach.open"),
    reveal: tr("attach.reveal"),
    copyPath: tr("attach.copyPath"),
    loadError: tr("video.loadError"),
  };
}
