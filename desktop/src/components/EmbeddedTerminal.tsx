import { useEffect, useMemo, useRef, useState } from "react";
import { FitAddon } from "@xterm/addon-fit";
import { Terminal } from "@xterm/xterm";
import "@xterm/xterm/css/xterm.css";
import * as api from "@/lib/api";
import { createT, type Locale } from "@/i18n";

export function EmbeddedTerminal({
  projectPath,
  locale,
}: {
  projectPath: string | null;
  locale: Locale;
}) {
  const hostRef = useRef<HTMLDivElement | null>(null);
  const [error, setError] = useState<string | null>(null);
  const tr = useMemo(() => createT(locale), [locale]);

  useEffect(() => {
    const host = hostRef.current;
    if (!host || !api.isTauri()) {
      setError(tr("rp.terminal.unavailable"));
      return;
    }

    let disposed = false;
    let terminalId: string | null = null;
    let resizeTimer: number | null = null;
    const styles = getComputedStyle(document.documentElement);
    const terminal = new Terminal({
      cursorBlink: true,
      convertEol: true,
      fontFamily: styles.getPropertyValue("--font-mono").trim() || "monospace",
      fontSize: 12.5,
      lineHeight: 1.28,
      scrollback: 5000,
      theme: {
        background: styles.getPropertyValue("--bg-main").trim(),
        foreground: styles.getPropertyValue("--text-primary").trim(),
        cursor: styles.getPropertyValue("--text-primary").trim(),
        selectionBackground: styles.getPropertyValue("--accent-muted").trim(),
      },
    });
    const fit = new FitAddon();
    terminal.loadAddon(fit);
    terminal.open(host);
    fit.fit();

    let unlistenOutput = () => {};
    let unlistenExit = () => {};
    const resize = () => {
      if (disposed) return;
      fit.fit();
      if (terminalId) {
        void api.terminalResize(terminalId, terminal.cols, terminal.rows);
      }
    };
    const observer = new ResizeObserver(() => {
      if (resizeTimer !== null) window.clearTimeout(resizeTimer);
      resizeTimer = window.setTimeout(resize, 40);
    });
    observer.observe(host);

    void (async () => {
      try {
        unlistenOutput = await api.listen<api.TerminalOutputEvent>(
          "terminal://output",
          (payload) => {
            if (payload.terminalId !== terminalId) return;
            const raw = atob(payload.dataBase64);
            const bytes = Uint8Array.from(raw, (char) => char.charCodeAt(0));
            terminal.write(bytes);
          },
        );
        unlistenExit = await api.listen<api.TerminalExitEvent>(
          "terminal://exit",
          (payload) => {
            if (payload.terminalId === terminalId) {
              terminal.write(`\r\n${tr("rp.terminal.exited")}\r\n`);
            }
          },
        );
        terminalId = await api.terminalStart(
          projectPath,
          terminal.cols,
          terminal.rows,
        );
        if (disposed) {
          await api.terminalStop(terminalId);
          return;
        }
        terminal.focus();
      } catch {
        if (!disposed) setError(tr("rp.terminal.failed"));
      }
    })();

    const input = terminal.onData((data) => {
      if (terminalId) void api.terminalWrite(terminalId, data);
    });

    return () => {
      disposed = true;
      observer.disconnect();
      if (resizeTimer !== null) window.clearTimeout(resizeTimer);
      input.dispose();
      unlistenOutput();
      unlistenExit();
      terminal.dispose();
      if (terminalId) void api.terminalStop(terminalId);
    };
  }, [projectPath, tr]);

  return (
    <div className="rp-terminal">
      {error ? (
        <div className="rp__error" role="alert">
          {error}
        </div>
      ) : null}
      <div ref={hostRef} className="rp-terminal__host" />
    </div>
  );
}
