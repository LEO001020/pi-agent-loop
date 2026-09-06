/**
 * Local HTML preview for the resource pane.
 *
 * Nested Tauri WebViews are possible but heavy (positioning, z-index, lifecycle).
 * WKWebView also blocks `file://` inside the main app iframe → blank page.
 *
 * Reliable approach for local reports (usually self-contained):
 * load HTML text via host/asset and render with `srcDoc` (scripts work, full-bleed).
 */

import { useEffect, useState } from "react";
import { isTauri } from "@/lib/api";

export interface HtmlBrowserProps {
  title?: string;
  /** Absolute filesystem path (for fetch fallback). */
  absolutePath?: string | null;
  /** Full HTML document from host read (preferred). */
  html?: string | null;
  className?: string;
}

async function fetchHtmlText(absolutePath: string): Promise<string> {
  if (!isTauri()) {
    throw new Error("Tauri required to load local HTML");
  }
  const { convertFileSrc } = await import("@tauri-apps/api/core");
  // asset protocol is allowed to read local files from the app webview
  const url = convertFileSrc(absolutePath);
  const res = await fetch(url);
  if (!res.ok) {
    throw new Error(`HTTP ${res.status}`);
  }
  return res.text();
}

export function HtmlBrowser({
  title = "HTML",
  absolutePath,
  html,
  className = "",
}: HtmlBrowserProps) {
  const [doc, setDoc] = useState<string>(html?.trim() ? html : "");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(!html?.trim() && !!absolutePath);

  useEffect(() => {
    if (html?.trim()) {
      setDoc(html);
      setError(null);
      setLoading(false);
      return;
    }
    if (!absolutePath) {
      setDoc("");
      setError("no HTML content");
      setLoading(false);
      return;
    }
    let cancelled = false;
    setLoading(true);
    setError(null);
    void fetchHtmlText(absolutePath)
      .then((text) => {
        if (cancelled) return;
        setDoc(text);
        setLoading(false);
      })
      .catch((e) => {
        if (cancelled) return;
        setError(String(e));
        setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [html, absolutePath]);

  if (loading) {
    return (
      <div className={"rp-preview-browser rp-preview-browser--msg " + className}>
        <div className="rp-preview__msg">Loading…</div>
      </div>
    );
  }

  if (error || !doc) {
    return (
      <div className={"rp-preview-browser rp-preview-browser--msg " + className}>
        <div className="rp-preview__msg" role="alert">
          {error || "Empty HTML"}
        </div>
      </div>
    );
  }

  return (
    <iframe
      className={
        "rp-preview__frame rp-preview__frame--browser " + className
      }
      title={title}
      // Full document; no sandbox so inline scripts (copy buttons) work
      srcDoc={doc}
      allow="clipboard-read; clipboard-write; fullscreen"
    />
  );
}
