/**
 * Local media preview via Plyr + Tauri media:// URL (Range streaming).
 * Creates the media element imperatively so Plyr does not fight React DOM.
 * On load failure: show error + open with system player.
 */

import { useEffect, useRef, useState } from "react";
import Plyr from "plyr";
import "plyr/dist/plyr.css";
import * as api from "@/lib/api";
import { Tip } from "@/components/ui/tooltip";

export interface FileMediaPlayerProps {
  /** media:// / asset:// / http(s) / data: URL */
  src: string;
  kind: "video" | "audio";
  mime?: string;
  title?: string;
  /** Absolute filesystem path for “Open externally”. */
  absolutePath?: string;
  className?: string;
  labels?: {
    loadError: string;
    openExternal: string;
    loading: string;
  };
}

const VIDEO_CONTROLS = [
  "play-large",
  "play",
  "progress",
  "current-time",
  "duration",
  "mute",
  "volume",
  "settings",
  "pip",
  "fullscreen",
];

const AUDIO_CONTROLS = [
  "play",
  "progress",
  "current-time",
  "duration",
  "mute",
  "volume",
  "settings",
];

function mediaErrorMessage(el: HTMLMediaElement): string {
  const err = el.error;
  if (!err) return "unknown";
  switch (err.code) {
    case MediaError.MEDIA_ERR_ABORTED:
      return "aborted";
    case MediaError.MEDIA_ERR_NETWORK:
      return "network";
    case MediaError.MEDIA_ERR_DECODE:
      return "decode";
    case MediaError.MEDIA_ERR_SRC_NOT_SUPPORTED:
      return "unsupported";
    default:
      return `code-${err.code}`;
  }
}

export function FileMediaPlayer({
  src,
  kind,
  title,
  absolutePath,
  className = "",
  labels,
}: FileMediaPlayerProps) {
  const hostRef = useRef<HTMLDivElement>(null);
  const playerRef = useRef<Plyr | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    const host = hostRef.current;
    if (!host || !src) return;

    setError(null);
    setReady(false);

    // Tear down previous
    playerRef.current?.destroy();
    playerRef.current = null;
    host.innerHTML = "";

    const el = document.createElement(kind === "video" ? "video" : "audio");
    el.className = "file-media__el";
    el.setAttribute("playsinline", "true");
    el.setAttribute("preload", "metadata");
    el.controls = true;
    // Set src directly on the element (no <source type=…>) so a wrong MIME
    // never blocks the browser from trying to play the stream.
    el.src = src;

    host.appendChild(el);

    const onError = () => {
      const detail = mediaErrorMessage(el);
      setError(detail);
      setReady(false);
      console.warn("[FileMediaPlayer] load error", detail, src);
    };
    const onMeta = () => {
      setReady(true);
      setError(null);
    };
    const onCanPlay = () => {
      setReady(true);
      setError(null);
    };

    el.addEventListener("error", onError);
    el.addEventListener("loadedmetadata", onMeta);
    el.addEventListener("canplay", onCanPlay);

    let player: Plyr | null = null;
    try {
      player = new Plyr(el, {
        controls: kind === "video" ? VIDEO_CONTROLS : AUDIO_CONTROLS,
        settings: ["speed"],
        ratio: kind === "video" ? "16:9" : undefined,
        keyboard: { focused: true, global: false },
        tooltips: { controls: true, seek: true },
        storage: { enabled: false },
      });
      playerRef.current = player;
    } catch (e) {
      console.error("[FileMediaPlayer] Plyr init failed", e);
      // Native controls still available on the element
    }

    // Kick load after listeners are attached
    try {
      el.load();
    } catch {
      /* ignore */
    }

    // Safety timeout: if metadata never arrives, surface error UI
    const timer = window.setTimeout(() => {
      if (!el.duration || Number.isNaN(el.duration)) {
        if (el.readyState < 1) {
          setError((prev) => prev ?? "timeout");
        }
      }
    }, 12_000);

    return () => {
      window.clearTimeout(timer);
      el.removeEventListener("error", onError);
      el.removeEventListener("loadedmetadata", onMeta);
      el.removeEventListener("canplay", onCanPlay);
      try {
        player?.destroy();
      } catch {
        /* ignore */
      }
      playerRef.current = null;
      host.innerHTML = "";
    };
  }, [src, kind]);

  const openExternal = async () => {
    if (!absolutePath || !api.isTauri()) return;
    try {
      await api.pathOpen(absolutePath);
    } catch (e) {
      console.error(e);
    }
  };

  const loadError = labels?.loadError ?? "Failed to load media";
  const openExternalLabel = labels?.openExternal ?? "Open with system player";

  const body = (
    <div
      className={
        `file-media file-media--${kind}` +
        (error ? " file-media--error" : "") +
        (ready ? " file-media--ready" : "") +
        (className ? ` ${className}` : "")
      }
    >
      <div ref={hostRef} className="file-media__host" />
      {error && (
        <div className="file-media__error" role="alert">
          <p>{loadError}</p>
          {absolutePath && (
            <button
              type="button"
              className="btn btn--primary file-media__open-ext"
              onClick={() => void openExternal()}
            >
              {openExternalLabel}
            </button>
          )}
        </div>
      )}
      {!error && absolutePath && kind === "video" && (
        <div className="file-media__toolbar">
          <button
            type="button"
            className="btn btn--ghost file-media__open-ext"
            onClick={() => void openExternal()}
          >
            {openExternalLabel}
          </button>
        </div>
      )}
    </div>
  );

  return title ? <Tip label={title}>{body}</Tip> : body;
}
