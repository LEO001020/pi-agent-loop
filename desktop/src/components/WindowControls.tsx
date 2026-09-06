/**
 * Self-drawn window chrome for Windows (and other non-mac platforms when
 * decorations are disabled). macOS uses native Overlay traffic lights.
 */
import { useCallback, useEffect, useState } from "react";
import { IconClose, IconMaximize, IconMinimize } from "@/components/icons";
import { Tip } from "@/components/ui/tooltip";

type Props = {
  visible: boolean;
  labels: {
    minimize: string;
    maximize: string;
    restore: string;
    close: string;
  };
};

export function WindowControls({ visible, labels }: Props) {
  const [maximized, setMaximized] = useState(false);

  const refreshMaximized = useCallback(async () => {
    try {
      const { getCurrentWindow } = await import("@tauri-apps/api/window");
      setMaximized(await getCurrentWindow().isMaximized());
    } catch {
      /* browser / no window API */
    }
  }, []);

  useEffect(() => {
    if (!visible) return;
    void refreshMaximized();
    let unlisten: (() => void) | undefined;
    let cancelled = false;
    void (async () => {
      try {
        const { getCurrentWindow } = await import("@tauri-apps/api/window");
        const w = getCurrentWindow();
        unlisten = await w.onResized(() => {
          void refreshMaximized();
        });
        if (cancelled && unlisten) unlisten();
      } catch {
        /* ignore */
      }
    })();
    return () => {
      cancelled = true;
      unlisten?.();
    };
  }, [visible, refreshMaximized]);

  const winChrome = async (action: "minimize" | "toggleMaximize" | "close") => {
    try {
      const { getCurrentWindow } = await import("@tauri-apps/api/window");
      const w = getCurrentWindow();
      if (action === "minimize") await w.minimize();
      if (action === "toggleMaximize") {
        await w.toggleMaximize();
        await refreshMaximized();
      }
      if (action === "close") await w.close();
    } catch {
      /* ignore */
    }
  };

  if (!visible) return null;

  return (
    <div className="window-controls" data-tauri-drag-region={undefined}>
      <Tip label={labels.minimize}>
        <button
          type="button"
          className="window-controls__btn"
          aria-label={labels.minimize}
          onClick={(e) => {
            e.stopPropagation();
            void winChrome("minimize");
          }}
        >
          <IconMinimize size={14} />
        </button>
      </Tip>
      <Tip label={maximized ? labels.restore : labels.maximize}>
        <button
          type="button"
          className="window-controls__btn"
          aria-label={maximized ? labels.restore : labels.maximize}
          onClick={(e) => {
            e.stopPropagation();
            void winChrome("toggleMaximize");
          }}
        >
          <IconMaximize size={14} />
        </button>
      </Tip>
      <Tip label={labels.close}>
        <button
          type="button"
          className="window-controls__btn window-controls__btn--close"
          aria-label={labels.close}
          onClick={(e) => {
            e.stopPropagation();
            void winChrome("close");
          }}
        >
          <IconClose size={14} />
        </button>
      </Tip>
    </div>
  );
}

/** Double-click titlebar strip → maximize/restore (Win habit). */
export async function toggleMaximizeFromTitlebar(): Promise<void> {
  try {
    const { getCurrentWindow } = await import("@tauri-apps/api/window");
    await getCurrentWindow().toggleMaximize();
  } catch {
    /* ignore */
  }
}
