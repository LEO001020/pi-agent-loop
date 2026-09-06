/**
 * Built-in browser for the resource pane.
 *
 * Plain <iframe> is blocked by X-Frame-Options / CSP on many sites (GitHub, etc.)
 * → blank preview. In Tauri we attach a child native Webview over this host
 * element so the page loads as a top-level document.
 *
 * Non-Tauri (dev UI only): falls back to iframe + open-external affordance.
 */

import { useEffect, useRef, useState } from "react";
import { isTauri } from "@/lib/api";
import { createT, type Locale } from "@/i18n";
import {
  IconArrowLeft,
  IconArrowRight,
  IconExternalLink,
  IconRefresh,
} from "@/components/icons";

const WEBVIEW_LABEL = "resource-browser";

export interface EmbeddedBrowserProps {
  url: string;
  title?: string;
  locale?: Locale;
  /** When false, native webview is hidden (inactive tab / collapsed pane). */
  active?: boolean;
  className?: string;
  /** Navigate the current tab to a new URL (typed in the address bar). */
  onNavigate?: (url: string) => void;
  /** Localized strings for the navigation bar. */
  navLabels?: {
    back?: string;
    forward?: string;
    reload?: string;
    openExternal?: string;
    address?: string;
    soon?: string;
  };
}

function sanitizeLabel(s: string): string {
  return s.replace(/[^a-zA-Z0-9\-_:/]/g, "-").slice(0, 64) || "resource-browser";
}

async function openExternalUrl(url: string) {
  try {
    if (isTauri()) {
      const api = await import("@/lib/api");
      await api.openExternalUrl(url);
      return;
    }
  } catch {
    /* fall through */
  }
  window.open(url, "_blank", "noopener,noreferrer");
}

export function EmbeddedBrowser({
  url,
  title,
  locale = "en",
  active = true,
  className = "",
  onNavigate,
  navLabels,
}: EmbeddedBrowserProps) {
  const hostRef = useRef<HTMLDivElement>(null);
  // Dynamic import type — keep loose to avoid hard coupling on Tauri version.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const webviewRef = useRef<any>(null);
  const currentUrlRef = useRef<string>("");
  const [error, setError] = useState<string | null>(null);
  const [ready, setReady] = useState(false);
  /** Address-bar draft; mirrors `url` but lets the user type a new target. */
  const [draftUrl, setDraftUrl] = useState(url);
  useEffect(() => setDraftUrl(url), [url]);
  const tr = createT(locale);

  const commitNav = () => {
    const t = draftUrl.trim();
    if (!t) return;
    const next = /^[a-zA-Z][a-zA-Z0-9+.-]*:\/\//.test(t)
      ? t
      : `https://${t.replace(/^\/+/, "")}`;
    setDraftUrl(next);
    onNavigate?.(next);
  };

  // Layout → native webview bounds
  const syncBounds = async () => {
    const el = hostRef.current;
    const wv = webviewRef.current;
    if (!el || !wv || !isTauri()) return;
    const rect = el.getBoundingClientRect();
    if (rect.width < 2 || rect.height < 2) {
      try {
        await wv.hide();
      } catch {
        /* ignore */
      }
      return;
    }
    try {
      const { LogicalPosition, LogicalSize } = await import("@tauri-apps/api/dpi");
      await wv.setPosition(new LogicalPosition(rect.left, rect.top));
      await wv.setSize(new LogicalSize(rect.width, rect.height));
      if (active) await wv.show();
      else await wv.hide();
    } catch (e) {
      console.error("[EmbeddedBrowser] syncBounds", e);
    }
  };

  // Create / recreate native webview when URL changes (Tauri only)
  useEffect(() => {
    if (!isTauri() || !active) return;
    const target = url.trim();
    if (!target) return;

    let cancelled = false;
    let resizeObs: ResizeObserver | null = null;
    let roFrame = 0;

    const boot = async () => {
      setError(null);
      setReady(false);
      try {
        const { Webview } = await import("@tauri-apps/api/webview");
        const { getCurrentWindow } = await import("@tauri-apps/api/window");
        const { LogicalPosition, LogicalSize } = await import("@tauri-apps/api/dpi");
        const win = getCurrentWindow();

        // Tear down previous instance (URL change or remount)
        const existing = await Webview.getByLabel(WEBVIEW_LABEL);
        if (existing) {
          try {
            await existing.close();
          } catch {
            /* ignore */
          }
        }
        webviewRef.current = null;
        currentUrlRef.current = "";

        if (cancelled) return;

        const el = hostRef.current;
        const rect = el?.getBoundingClientRect();
        const x = rect?.left ?? 0;
        const y = rect?.top ?? 0;
        const w = Math.max(rect?.width ?? 320, 40);
        const h = Math.max(rect?.height ?? 240, 40);

        const webview = new Webview(win, sanitizeLabel(WEBVIEW_LABEL), {
          url: target,
          x,
          y,
          width: w,
          height: h,
          focus: true,
          // Accept any remote page; child is a real top-level document
          acceptFirstMouse: true,
        });

        await new Promise<void>((resolve, reject) => {
          const t = window.setTimeout(
            () => reject(new Error("webview create timeout")),
            8000,
          );
          void webview.once("tauri://created", () => {
            window.clearTimeout(t);
            resolve();
          });
          void webview.once("tauri://error", (e) => {
            window.clearTimeout(t);
            reject(e.payload ?? e);
          });
        });

        if (cancelled) {
          try {
            await webview.close();
          } catch {
            /* ignore */
          }
          return;
        }

        webviewRef.current = webview;
        currentUrlRef.current = target;
        await webview.setPosition(new LogicalPosition(x, y));
        await webview.setSize(new LogicalSize(w, h));
        await webview.show();
        setReady(true);

        // Keep bounds aligned with the host pane; hide when host not visible
        // (aside collapsed, zero-size, covered).
        if (hostRef.current && typeof ResizeObserver !== "undefined") {
          resizeObs = new ResizeObserver(() => {
            cancelAnimationFrame(roFrame);
            roFrame = requestAnimationFrame(() => {
              void syncBounds();
            });
          });
          resizeObs.observe(hostRef.current);
        }
        if (hostRef.current && typeof IntersectionObserver !== "undefined") {
          const io = new IntersectionObserver(
            (entries) => {
              const vis = entries.some((e) => e.isIntersecting && e.intersectionRatio > 0.05);
              const wv = webviewRef.current;
              if (!wv) return;
              if (!vis || !active) void wv.hide().catch(() => undefined);
              else void syncBounds();
            },
            { threshold: [0, 0.05, 0.5, 1] },
          );
          io.observe(hostRef.current);
          // stash on resizeObs cleanup via disconnect of both
          (resizeObs as unknown as { _io?: IntersectionObserver })._io = io;
        }
        window.addEventListener("resize", syncBounds);
      } catch (e) {
        if (!cancelled) {
          console.error("[EmbeddedBrowser] create failed", e);
          setError(String(e));
          setReady(false);
        }
      }
    };

    void boot();

    return () => {
      cancelled = true;
      cancelAnimationFrame(roFrame);
      resizeObs?.disconnect();
      const io = (resizeObs as unknown as { _io?: IntersectionObserver } | null)?._io;
      io?.disconnect();
      window.removeEventListener("resize", syncBounds);
      const wv = webviewRef.current;
      webviewRef.current = null;
      currentUrlRef.current = "";
      if (wv) {
        void wv.close().catch(() => undefined);
      } else if (isTauri()) {
        void import("@tauri-apps/api/webview")
          .then(({ Webview }) => Webview.getByLabel(WEBVIEW_LABEL))
          .then((w) => w?.close())
          .catch(() => undefined);
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [url, active]);

  // Hide/show when active toggles without URL change
  useEffect(() => {
    const wv = webviewRef.current;
    if (!wv || !isTauri()) return;
    if (active) {
      void syncBounds().then(() => wv.show()).catch(() => undefined);
    } else {
      void wv.hide().catch(() => undefined);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active]);

  const openExternal = () => {
    void openExternalUrl(url);
  };

  const moveHistory = async (direction: "back" | "forward") => {
    const webview = webviewRef.current;
    if (!webview || !isTauri()) return;
    const method = direction === "back" ? webview.goBack : webview.goForward;
    if (typeof method !== "function") return;
    try {
      await method.call(webview);
    } catch {
      // A page without history is a normal browser state, not a pane error.
    }
  };

  /** Shared navigation bar (Codex-style): back / forward / reload / URL / open. */
  const navBar = (withReload: boolean, withHistory: boolean) => (
    <div className="embedded-browser__bar embedded-browser__bar--nav">
      {withHistory ? (
        <>
          <button
            type="button"
            className="chrome-btn embedded-browser__navbtn"
            disabled={!ready}
            onClick={() => void moveHistory("back")}
            title={navLabels?.back ?? "Back"}
            aria-label={navLabels?.back ?? "Back"}
          >
            <IconArrowLeft size={14} />
          </button>
          <button
            type="button"
            className="chrome-btn embedded-browser__navbtn"
            disabled={!ready}
            onClick={() => void moveHistory("forward")}
            title={navLabels?.forward ?? "Forward"}
            aria-label={navLabels?.forward ?? "Forward"}
          >
            <IconArrowRight size={14} />
          </button>
        </>
      ) : null}
      {withReload ? (
        <button
          type="button"
          className="chrome-btn embedded-browser__navbtn"
          onClick={reload}
          title={navLabels?.reload ?? tr("resources.browserReload")}
          aria-label={navLabels?.reload ?? tr("resources.browserReload")}
        >
          <IconRefresh size={14} />
        </button>
      ) : null}
      <form
        className="embedded-browser__addr"
        onSubmit={(e) => {
          e.preventDefault();
          commitNav();
        }}
      >
        <input
          className="embedded-browser__addr-input"
          type="text"
          inputMode="url"
          autoComplete="off"
          spellCheck={false}
          value={draftUrl}
          onChange={(e) => setDraftUrl(e.target.value)}
          onBlur={() => setDraftUrl(url)}
          aria-label={navLabels?.address ?? "Address"}
        />
      </form>
      <button
        type="button"
        className="chrome-btn embedded-browser__navbtn"
        onClick={openExternal}
        title={navLabels?.openExternal ?? tr("resources.openExternal")}
        aria-label={navLabels?.openExternal ?? tr("resources.openExternal")}
      >
        <IconExternalLink size={14} />
      </button>
    </div>
  );

  const reload = () => {
    // Force recreate by remounting effect: clear then set same url via key is parent job.
    // Local: close + recreate
    if (!isTauri()) return;
    const u = url;
    void (async () => {
      try {
        const { Webview } = await import("@tauri-apps/api/webview");
        const w = await Webview.getByLabel(WEBVIEW_LABEL);
        if (w) await w.close();
      } catch {
        /* ignore */
      }
      webviewRef.current = null;
      currentUrlRef.current = "";
      // Trigger effect by bumping a dummy state through recreating with same url —
      // parent should change key; as fallback re-run boot by toggling ready
      setReady(false);
      setError(null);
      // Manual recreate
      const el = hostRef.current;
      if (!el) return;
      try {
        const { Webview } = await import("@tauri-apps/api/webview");
        const { getCurrentWindow } = await import("@tauri-apps/api/window");
        const { LogicalPosition, LogicalSize } = await import("@tauri-apps/api/dpi");
        const rect = el.getBoundingClientRect();
        const webview = new Webview(getCurrentWindow(), WEBVIEW_LABEL, {
          url: u,
          x: rect.left,
          y: rect.top,
          width: Math.max(rect.width, 40),
          height: Math.max(rect.height, 40),
          focus: true,
        });
        await new Promise<void>((resolve, reject) => {
          void webview.once("tauri://created", () => resolve());
          void webview.once("tauri://error", (e) => reject(e));
        });
        webviewRef.current = webview;
        await webview.setPosition(new LogicalPosition(rect.left, rect.top));
        await webview.setSize(
          new LogicalSize(Math.max(rect.width, 40), Math.max(rect.height, 40)),
        );
        await webview.show();
        setReady(true);
      } catch (e) {
        setError(String(e));
      }
    })();
  };

  // Non-Tauri: iframe (many sites blank — surface open external)
  if (!isTauri()) {
    return (
      <div className={"embedded-browser " + className}>
        {navBar(false, false)}
        <iframe
          className="rp-preview__frame rp-preview__frame--browser"
          title={title || url}
          src={url}
          referrerPolicy="no-referrer"
          allow="fullscreen"
        />
        <div className="embedded-browser__hint">
          {tr("resources.browserIframeHint")}
        </div>
      </div>
    );
  }

  return (
    <div className={"embedded-browser embedded-browser--native " + className}>
      {navBar(true, true)}
      {/* Host rectangle — native webview is painted on top of this area */}
      <div
        ref={hostRef}
        className="embedded-browser__host"
        data-ready={ready ? "1" : "0"}
        aria-label={title || url}
      >
        {error ? (
          <div className="rp-preview__msg" role="alert">
            <p>{tr("resources.browserFailed")}</p>
            <p className="embedded-browser__err">{error}</p>
            <button type="button" className="btn btn--primary" onClick={openExternal}>
              {tr("resources.openExternal")}
            </button>
          </div>
        ) : !ready ? (
          <div className="rp-preview__msg">{tr("resources.loading")}</div>
        ) : (
          <div className="embedded-browser__host-fill" aria-hidden />
        )}
      </div>
    </div>
  );
}
