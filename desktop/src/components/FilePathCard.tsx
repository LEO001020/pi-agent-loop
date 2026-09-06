/**
 * Compact file / URL card for chat paths.
 * Default: name only (no path on the card — avoids resolve flash).
 * Path lives in details modal + right-click copy.
 * Click → open in right resource pane.
 */

import { useCallback, useEffect, useState } from "react";
import { createPortal } from "react-dom";
import * as api from "@/lib/api";
import { pathBasename, pathExt } from "@/lib/attachments";
import {
  isAbsoluteFsPath,
  isHttpUrl,
  normalizePathToken,
} from "@/lib/pathRefs";
import {
  IconClose,
  IconCopy,
  IconExternalLink,
  IconFileText,
  IconFolder,
  IconInfo,
} from "@/components/icons";
import { ContextMenu, type ContextMenuItem } from "@/components/ContextMenu";

export type FilePathCardKind = "file" | "url" | "dir";

export interface FilePathCardLabels {
  open: string;
  reveal: string;
  copyPath: string;
  openInPanel?: string;
  openExternal?: string;
  details?: string;
  detailsTitle?: string;
  detailsName?: string;
  detailsType?: string;
  detailsPath?: string;
  detailsResolved?: string;
  detailsStatus?: string;
  detailsMissing?: string;
  detailsOk?: string;
  detailsClose?: string;
  typeFile?: string;
  typeUrl?: string;
  typeDir?: string;
}

export interface FilePathCardProps {
  /** Absolute path, relative display path, or URL. */
  path: string;
  /**
   * Optional absolute path hint. Only used as a search token if it is absolute;
   * host still verifies existence (fake monorepo joins are discarded).
   */
  absolutePath?: string;
  kind?: FilePathCardKind;
  /** Project root for monorepo suffix search. */
  projectPath?: string | null;
  subtitle?: string;
  labels: FilePathCardLabels;
  onOpenInPanel?: (target: {
    type: "file" | "url";
    path?: string;
    url?: string;
    title?: string;
  }) => void;
}

function kindLabel(path: string, kind: FilePathCardKind): string {
  if (kind === "url") return "URL";
  if (kind === "dir") return "DIR";
  const ext = pathExt(path).toUpperCase() || "FILE";
  return ext;
}

function relativeToken(path: string): string | null {
  // Strip agent ellipsis (`.../a/b.jpg` → `a/b.jpg`) before open/search
  const t = normalizePathToken(path);
  if (!t || isHttpUrl(t) || isAbsoluteFsPath(t)) return null;
  if (!(t.includes("/") || t.includes("\\"))) return null;
  return t;
}

export function FilePathCard({
  path,
  absolutePath,
  kind = "file",
  projectPath,
  subtitle: _subtitle,
  labels,
  onOpenInPanel,
}: FilePathCardProps) {
  void _subtitle; // callers may pass; card no longer shows path/subtitle
  const [menu, setMenu] = useState<{ x: number; y: number } | null>(null);
  const [detailsOpen, setDetailsOpen] = useState(false);
  /** Only set after host confirms a real on-disk path. */
  const [resolvedAbs, setResolvedAbs] = useState<string | null>(null);
  const [missing, setMissing] = useState(false);
  const [busy, setBusy] = useState(false);
  const isUrl = kind === "url" || isHttpUrl(path);
  /** Card title only: basename, or host for URLs — never the full path. */
  const name = (() => {
    if (!isUrl) return pathBasename(path);
    try {
      const u = new URL(path);
      return u.hostname || path;
    } catch {
      return path;
    }
  })();

  /**
   * Resolve a real on-disk absolute path.
   * Prefer relative tokens for monorepo search; never trust unverified joins.
   */
  const resolveAbsolute = useCallback(async (): Promise<string | null> => {
    if (isUrl) return null;
    if (resolvedAbs) return resolvedAbs;

    if (!api.isTauri()) {
      if (isAbsoluteFsPath(path)) return path;
      if (absolutePath && isAbsoluteFsPath(absolutePath)) return absolutePath;
      return null;
    }

    // Prefer absolute paths first (most reliable), then relative tokens.
    // A relative path like `docs/wiki/...` is resolved by the host against the project
    // and project parent (sibling folders such as a shared knowledge base).
    const tokens: string[] = [];
    if (isAbsoluteFsPath(path)) tokens.push(path);
    if (absolutePath && isAbsoluteFsPath(absolutePath)) {
      tokens.push(absolutePath);
    }
    const rel = relativeToken(path);
    if (rel) tokens.push(rel);
    // Also pass the raw path if it still looks path-like (host may join parent)
    if (path.trim() && !tokens.includes(path.trim())) {
      tokens.push(path.trim());
    }
    if (!tokens.length) tokens.push(pathBasename(path));

    const seen = new Set<string>();
    for (const token of tokens) {
      if (!token || seen.has(token)) continue;
      seen.add(token);
      try {
        const r = await api.fsOpenPath(token, projectPath ?? null);
        if (r.absolutePath) {
          setResolvedAbs(r.absolutePath);
          setMissing(false);
          return r.absolutePath;
        }
      } catch {
        /* try next token */
      }
      // Absolute-only fallback when smart open fails (legacy host / edge cases)
      if (isAbsoluteFsPath(token)) {
        try {
          const r = await api.fsReadAbsolute(token);
          if (r.absolutePath) {
            setResolvedAbs(r.absolutePath);
            setMissing(false);
            return r.absolutePath;
          }
        } catch {
          /* try next */
        }
      }
    }
    setMissing(true);
    return null;
  }, [absolutePath, isUrl, path, projectPath, resolvedAbs]);

  useEffect(() => {
    if (isUrl) return;
    if (resolvedAbs) return;
    if (!api.isTauri()) return;
    let cancelled = false;
    void resolveAbsolute().then((abs) => {
      if (cancelled) return;
      if (abs) setResolvedAbs(abs);
    });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [path, projectPath, absolutePath, kind]);

  useEffect(() => {
    if (!detailsOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setDetailsOpen(false);
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [detailsOpen]);

  const openInPanel = async () => {
    if (isUrl) {
      onOpenInPanel?.({ type: "url", url: path, title: name });
      return;
    }
    // Resolve before open so the panel never flashes the raw relative path.
    // Avoid busy/opacity flash on the card itself.
    if (busy) return;
    setBusy(true);
    try {
      const abs = resolvedAbs || (await resolveAbsolute());
      if (!abs) {
        // Still open with original token; host smart-open may recover.
        onOpenInPanel?.({
          type: "file",
          path: relativeToken(path) || path,
          title: name,
        });
        return;
      }
      onOpenInPanel?.({ type: "file", path: abs, title: name });
    } finally {
      setBusy(false);
    }
  };

  const openExternal = async () => {
    if (isUrl) {
      window.open(path, "_blank", "noopener,noreferrer");
      return;
    }
    if (!api.isTauri()) return;
    if (busy) return;
    setBusy(true);
    try {
      const abs = resolvedAbs || (await resolveAbsolute());
      if (!abs) {
        console.error("[FilePathCard] openExternal: file not found", path);
        return;
      }
      await api.pathOpen(abs);
    } catch (e) {
      console.error("[FilePathCard] openExternal failed", e);
    } finally {
      setBusy(false);
    }
  };

  const reveal = async () => {
    if (isUrl) return;
    if (!api.isTauri()) return;
    if (busy) return;
    setBusy(true);
    try {
      const abs = resolvedAbs || (await resolveAbsolute());
      if (!abs) {
        console.error("[FilePathCard] reveal: file not found", path);
        return;
      }
      await api.pathReveal(abs);
    } catch (e) {
      console.error("[FilePathCard] reveal failed", e);
    } finally {
      setBusy(false);
    }
  };

  const copy = async () => {
    try {
      const abs = resolvedAbs || (await resolveAbsolute());
      await navigator.clipboard.writeText(abs || path);
    } catch {
      /* ignore */
    }
  };

  const typeLabel = isUrl
    ? labels.typeUrl || "URL"
    : kind === "dir"
      ? labels.typeDir || "Folder"
      : labels.typeFile || "File";

  // Prefer resolved abs in details; fall back to original token.
  const detailsPath = resolvedAbs || path;

  const menuItems: ContextMenuItem[] = [
    {
      id: "open-panel",
      label: labels.openInPanel || labels.open,
      icon: <IconFileText size={16} />,
      onClick: () => {
        void openInPanel();
      },
    },
    {
      id: "open-external",
      label: labels.openExternal || labels.open,
      icon: <IconExternalLink size={16} />,
      onClick: () => {
        void openExternal();
      },
    },
  ];
  if (!isUrl) {
    menuItems.push({
      id: "reveal",
      label: labels.reveal,
      icon: <IconFolder size={16} />,
      onClick: () => {
        void reveal();
      },
    });
  }
  menuItems.push(
    {
      id: "copy-path",
      label: labels.copyPath,
      icon: <IconCopy size={16} />,
      onClick: () => {
        void copy();
      },
    },
    {
      id: "details",
      label: labels.details || "Details",
      icon: <IconInfo size={16} />,
      onClick: () => setDetailsOpen(true),
    },
  );

  return (
    <>
      <div
        className={
          "file-path-card" +
          (isUrl ? " file-path-card--url" : "") +
          (kind === "dir" ? " file-path-card--dir" : "") +
          (missing && !resolvedAbs ? " file-path-card--missing" : "")
        }
        title={name}
        onContextMenu={(e) => {
          e.preventDefault();
          e.stopPropagation();
          setMenu({ x: e.clientX, y: e.clientY });
        }}
      >
        <button
          type="button"
          className="file-path-card__main"
          onClick={() => void openInPanel()}
          disabled={busy}
        >
          <span className="file-path-card__icon" aria-hidden>
            {kind === "dir" ? (
              <IconFolder size={16} />
            ) : isUrl ? (
              <IconExternalLink size={16} />
            ) : (
              <IconFileText size={16} />
            )}
          </span>
          <span className="file-path-card__meta">
            <span className="file-path-card__name">{name}</span>
          </span>
        </button>
      </div>

      <ContextMenu
        open={!!menu}
        x={menu?.x ?? 0}
        y={menu?.y ?? 0}
        onClose={() => setMenu(null)}
        items={menuItems}
      />

      {detailsOpen &&
        typeof document !== "undefined" &&
        createPortal(
          <div
            className="overlay file-path-details-overlay"
            role="presentation"
            onMouseDown={(e) => {
              if (e.target === e.currentTarget) setDetailsOpen(false);
            }}
          >
            <div
              className="modal file-path-details"
              role="dialog"
              aria-modal="true"
              aria-labelledby="file-path-details-title"
              onMouseDown={(e) => e.stopPropagation()}
            >
              <header className="modal-head file-path-details__head">
                <h2 id="file-path-details-title" className="modal-title">
                  {labels.detailsTitle || labels.details || "Details"}
                </h2>
                <button
                  type="button"
                  className="icon-btn modal-close"
                  aria-label={labels.detailsClose || "Close"}
                  onClick={() => setDetailsOpen(false)}
                >
                  <IconClose size={16} />
                </button>
              </header>
              <div className="file-path-details__body">
                <div className="file-path-details__row">
                  <span className="file-path-details__label">
                    {labels.detailsName || "Name"}
                  </span>
                  <span className="file-path-details__value" title={name}>
                    {name}
                  </span>
                </div>
                <div className="file-path-details__row">
                  <span className="file-path-details__label">
                    {labels.detailsType || "Type"}
                  </span>
                  <span className="file-path-details__value">
                    {typeLabel}
                    {!isUrl && kind !== "dir"
                      ? ` · ${kindLabel(path, kind)}`
                      : ""}
                  </span>
                </div>
                <div className="file-path-details__row">
                  <span className="file-path-details__label">
                    {labels.detailsPath || "Path"}
                  </span>
                  <code className="file-path-details__value file-path-details__mono">
                    {detailsPath}
                  </code>
                </div>
                {!isUrl && resolvedAbs && path !== resolvedAbs ? (
                  <div className="file-path-details__row">
                    <span className="file-path-details__label">
                      {labels.detailsResolved || "Original"}
                    </span>
                    <code className="file-path-details__value file-path-details__mono">
                      {path}
                    </code>
                  </div>
                ) : null}
                {!isUrl ? (
                  <div className="file-path-details__row">
                    <span className="file-path-details__label">
                      {labels.detailsStatus || "Status"}
                    </span>
                    <span
                      className={
                        "file-path-details__value" +
                        (missing && !resolvedAbs
                          ? " file-path-details__value--warn"
                          : "")
                      }
                    >
                      {missing && !resolvedAbs
                        ? labels.detailsMissing || "Not found"
                        : labels.detailsOk || "OK"}
                    </span>
                  </div>
                ) : null}
              </div>
              <div className="modal-actions file-path-details__actions">
                <button
                  type="button"
                  className="btn btn--ghost"
                  onClick={() => {
                    void copy();
                  }}
                >
                  {labels.copyPath}
                </button>
                <button
                  type="button"
                  className="btn btn--primary"
                  onClick={() => setDetailsOpen(false)}
                >
                  {labels.detailsClose || "Close"}
                </button>
              </div>
            </div>
          </div>,
          document.body,
        )}
    </>
  );
}
