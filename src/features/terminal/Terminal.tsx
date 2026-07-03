import { useEffect, useRef } from "react";
import { Terminal as XTerm } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import { WebLinksAddon } from "@xterm/addon-web-links";
import { Unicode11Addon } from "@xterm/addon-unicode11";
import { WebglAddon } from "@xterm/addon-webgl";
import { ClipboardAddon } from "@xterm/addon-clipboard";
import "@xterm/xterm/css/xterm.css";

import { ipc } from "@/lib/ipc";
import { errorMessage } from "@/lib/toast";
import { useTheme } from "@/theme/useTheme";
import { registerTerminal, unregisterTerminal } from "./registry";
import { terminalTheme } from "./theme";
import { useSessionStore } from "./sessionStore";

function decodeBase64(b64: string): Uint8Array {
  const binary = atob(b64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

/**
 * Attach the GPU renderer. xterm transparently falls back to its DOM renderer
 * if WebGL is unavailable or the context is later lost (e.g. GPU reset), so we
 * dispose the addon on loss rather than trying to recreate it.
 */
function attachWebgl(term: XTerm) {
  try {
    const webgl = new WebglAddon();
    webgl.onContextLoss(() => webgl.dispose());
    term.loadAddon(webgl);
  } catch {
    /* no WebGL — DOM renderer remains active */
  }
}

/**
 * A single SSH-backed terminal. Owns one xterm instance for the lifetime of the
 * session, streams output from `ssh://data`, and forwards keystrokes/resizes.
 * Bumping `attempt` (via the session store's `reconnect`) tears this down and
 * remounts a fresh connection.
 */
export function TerminalView({
  sessionId,
  hostId,
  attempt,
}: {
  sessionId: string;
  hostId: string;
  attempt: number;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const termRef = useRef<XTerm | null>(null);
  const { resolved } = useTheme();
  const setStatus = useSessionStore((s) => s.setStatus);

  // Keep colors in sync with the app theme without recreating the terminal.
  useEffect(() => {
    if (termRef.current)
      termRef.current.options.theme = terminalTheme(resolved);
  }, [resolved]);

  useEffect(() => {
    const term = new XTerm({
      fontFamily:
        '"JetBrains Mono", "SFMono-Regular", ui-monospace, Menlo, monospace',
      fontSize: 13,
      lineHeight: 1.25,
      letterSpacing: 0,
      cursorBlink: true,
      cursorStyle: "bar",
      cursorInactiveStyle: "outline",
      allowProposedApi: true,
      // Alt acts as Meta so shell word-motions (alt+←/→/backspace) work on mac.
      macOptionIsMeta: true,
      // Keep faint colors legible against the themed background.
      minimumContrastRatio: 1.1,
      theme: terminalTheme(resolved),
      scrollback: 10_000,
    });
    const fit = new FitAddon();
    term.loadAddon(fit);
    term.loadAddon(new WebLinksAddon());
    term.loadAddon(new ClipboardAddon());
    const unicode = new Unicode11Addon();
    term.loadAddon(unicode);
    term.unicode.activeVersion = "11";

    term.open(containerRef.current!);
    attachWebgl(term); // must run after open(), once the canvas exists.
    fit.fit();
    termRef.current = term;
    registerTerminal(sessionId, term);

    let disposed = false;
    const unlisteners: Array<() => void> = [];

    // Forward keystrokes to the remote shell.
    const dataSub = term.onData((data) => {
      void ipc.ssh.send(sessionId, data).catch(() => {});
    });

    // Register event listeners *before* connecting so we never miss the
    // backend's "connected"/"error" status or early output (the listen() call
    // is async and Tauri does not buffer events for late subscribers).
    void (async () => {
      const [unData, unStatus] = await Promise.all([
        ipc.ssh.onData((e) => {
          if (e.id === sessionId && !disposed) term.write(decodeBase64(e.data));
        }),
        ipc.ssh.onStatus((e) => {
          if (e.id === sessionId && !disposed) {
            setStatus(sessionId, e.status, e.message);
          }
        }),
      ]);

      if (disposed) {
        unData();
        unStatus();
        return;
      }
      unlisteners.push(unData, unStatus);

      setStatus(sessionId, "connecting");
      try {
        await ipc.ssh.connect({
          sessionId,
          hostId,
          cols: term.cols,
          rows: term.rows,
        });
      } catch (err) {
        if (!disposed) setStatus(sessionId, "error", errorMessage(err));
      }
    })();

    // Refit on container resize and inform the remote PTY.
    const observer = new ResizeObserver(() => {
      try {
        fit.fit();
        void ipc.ssh.resize(sessionId, term.cols, term.rows).catch(() => {});
      } catch {
        /* element not visible */
      }
    });
    observer.observe(containerRef.current!);

    return () => {
      disposed = true;
      observer.disconnect();
      dataSub.dispose();
      unlisteners.forEach((un) => un());
      unregisterTerminal(sessionId);
      term.dispose();
      termRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sessionId, hostId, attempt]);

  return <div ref={containerRef} className="h-full w-full" />;
}
