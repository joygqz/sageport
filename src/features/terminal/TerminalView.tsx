import { useEffect, useRef } from "react";
import { Terminal as XTerm } from "@xterm/xterm";
import { ClipboardAddon } from "@xterm/addon-clipboard";
import { FitAddon } from "@xterm/addon-fit";
import { SearchAddon } from "@xterm/addon-search";
import { Unicode11Addon } from "@xterm/addon-unicode11";
import { WebLinksAddon } from "@xterm/addon-web-links";
import { WebglAddon } from "@xterm/addon-webgl";
import "@xterm/xterm/css/xterm.css";

import { useI18n } from "@/i18n";
import { ipc } from "@/lib/ipc";
import { errorCode, errorMessage } from "@/lib/toast";
import { useTheme } from "@/themes/useTheme";
import { useTabsStore } from "@/workbench/tabs";
import { terminalFontSize } from "@/workbench/zoom";
import { registerTerminal, unregisterTerminal } from "./registry";
import { xtermTheme } from "./xterm-theme";

function decodeBase64(b64: string): Uint8Array {
  const binary = atob(b64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

const CONNECT_WATCHDOG_MS = 45_000;

/**
 * Attach the GPU renderer. xterm transparently falls back to its DOM
 * renderer if WebGL is unavailable or the context is later lost (e.g. GPU
 * reset), so the addon is disposed on loss rather than recreated.
 */
function attachWebgl(term: XTerm) {
  try {
    const webgl = new WebglAddon();
    webgl.onContextLoss(() => webgl.dispose());
    term.loadAddon(webgl);
  } catch {
    /* no WebGL, DOM renderer remains active */
  }
}

/**
 * A single SSH-backed terminal. Owns one xterm instance for the lifetime of
 * the session, streams output from `ssh://data`, and forwards keystrokes and
 * resizes. Bumping `attempt` (via the tab store's `reconnectTerminal`) tears
 * this down and remounts a fresh connection.
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
  const { theme } = useTheme();
  const { t } = useI18n();
  const setStatus = useTabsStore((s) => s.setTerminalStatus);

  // Both the initial connect (rejected synchronously, e.g. a misconfigured
  // host) and the background session thread (reported via "error" status
  // events, e.g. a rejected password) can fail with the same error codes —
  // map both through one place so they read the same way.
  const describeConnectError = (code?: string | null, message?: string) => {
    if (code === "invalid") return t("terminal.credentialsMissing");
    if (code === "auth") return t("terminal.authFailed");
    return message;
  };

  // Keep colors in sync with the app theme without recreating the terminal.
  useEffect(() => {
    if (termRef.current) termRef.current.options.theme = xtermTheme(theme);
  }, [theme]);

  useEffect(() => {
    const term = new XTerm({
      fontFamily:
        '"JetBrains Mono Variable", "SFMono-Regular", ui-monospace, Menlo, monospace',
      fontSize: terminalFontSize(),
      lineHeight: 1.25,
      allowProposedApi: true,
      // Alt acts as Meta so shell word motions (alt+arrows) work on macOS.
      macOptionIsMeta: true,
      // Keep faint colors legible against the themed background.
      minimumContrastRatio: 1.1,
      theme: xtermTheme(theme),
      scrollback: 10_000,
    });
    const fit = new FitAddon();
    const search = new SearchAddon();
    term.loadAddon(fit);
    term.loadAddon(search);
    term.loadAddon(new WebLinksAddon());
    term.loadAddon(new ClipboardAddon());
    const unicode = new Unicode11Addon();
    term.loadAddon(unicode);
    term.unicode.activeVersion = "11";

    term.open(containerRef.current!);
    attachWebgl(term); // must run after open(), once the canvas exists
    fit.fit();
    termRef.current = term;
    registerTerminal(sessionId, { term, fit, search });

    let disposed = false;
    let inputReady = false;
    let pendingInput = "";
    let sendingInput = false;
    let connectSettled = false;
    let connectTimedOut = false;
    let connectWatchdog: ReturnType<typeof setTimeout> | undefined;
    const unlisteners: Array<() => void> = [];

    const clearConnectWatchdog = () => {
      clearTimeout(connectWatchdog);
      connectWatchdog = undefined;
    };

    const settleConnect = () => {
      connectSettled = true;
      clearConnectWatchdog();
    };

    const flushInput = () => {
      if (
        !inputReady ||
        sendingInput ||
        disposed ||
        connectTimedOut ||
        pendingInput.length === 0
      ) {
        return;
      }
      const data = pendingInput;
      pendingInput = "";
      sendingInput = true;
      void ipc.ssh
        .send(sessionId, data)
        .catch(() => {})
        .finally(() => {
          sendingInput = false;
          flushInput();
        });
    };

    // Forward keystrokes to the remote shell.
    const dataSub = term.onData((data) => {
      pendingInput += data;
      flushInput();
    });

    // Register event listeners *before* connecting so the backend's
    // "connected"/"error" status and early output are never missed (listen()
    // is async and Tauri does not buffer events for late subscribers).
    void (async () => {
      const [unData, unStatus] = await Promise.all([
        ipc.ssh.onData((e) => {
          if (
            e.id === sessionId &&
            e.attempt === attempt &&
            !disposed &&
            !connectTimedOut
          ) {
            term.write(decodeBase64(e.data));
          }
        }),
        ipc.ssh.onStatus((e) => {
          if (
            e.id === sessionId &&
            e.attempt === attempt &&
            !disposed &&
            !connectTimedOut
          ) {
            if (e.status !== "connecting") settleConnect();
            setStatus(
              sessionId,
              e.status,
              e.status === "error"
                ? describeConnectError(e.code, e.message)
                : e.message,
            );
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
      connectWatchdog = setTimeout(() => {
        if (disposed || connectSettled) return;
        connectTimedOut = true;
        pendingInput = "";
        setStatus(sessionId, "error", t("terminal.connectTimedOut"));
        void ipc.ssh.disconnect(sessionId).catch(() => {});
      }, CONNECT_WATCHDOG_MS);
      try {
        await ipc.ssh.connect({
          sessionId,
          attempt,
          hostId,
          cols: term.cols,
          rows: term.rows,
        });
        inputReady = true;
        flushInput();
      } catch (err) {
        settleConnect();
        pendingInput = "";
        if (!disposed && !connectTimedOut) {
          setStatus(
            sessionId,
            "error",
            describeConnectError(errorCode(err), errorMessage(err)),
          );
        }
      }
    })();

    // Refit on container resize and inform the remote PTY. Coalesced to one
    // measurement per frame, then split by axis the way VSCode does: row
    // changes are cheap and applied immediately, but column changes reflow
    // the whole scrollback and force the remote app to repaint, so they are
    // debounced until the drag/resize settles.
    let fitQueued = false;
    let pendingCols = 0;
    let colsTimer: ReturnType<typeof setTimeout> | undefined;

    const applyResize = (cols: number, rows: number) => {
      if (cols === term.cols && rows === term.rows) return;
      term.resize(cols, rows);
      void ipc.ssh.resize(sessionId, term.cols, term.rows).catch(() => {});
    };

    const observer = new ResizeObserver(() => {
      if (fitQueued) return;
      fitQueued = true;
      // Defer to a macrotask, not requestAnimationFrame: observer and rAF
      // callbacks both run in the pre-paint phase, so resizing there clears
      // the WebGL canvas after xterm's own rAF redraw has already run for
      // this frame — every drag step paints one textless frame. From a task,
      // the canvas resize and xterm's redraw land in the same frame.
      setTimeout(() => {
        fitQueued = false;
        if (disposed) return;
        const el = containerRef.current;
        // Skip zero-size passes (e.g. mid-layout) — fitting to them would
        // clamp the PTY to a bogus size and repaint visibly.
        if (!el || el.clientWidth === 0 || el.clientHeight === 0) return;
        const dims = fit.proposeDimensions();
        if (!dims || !(dims.cols > 0) || !(dims.rows > 0)) return;
        if (dims.rows !== term.rows) applyResize(term.cols, dims.rows);
        if (dims.cols !== term.cols) {
          pendingCols = dims.cols;
          clearTimeout(colsTimer);
          colsTimer = setTimeout(() => {
            if (!disposed) applyResize(pendingCols, term.rows);
          }, 100);
        }
      }, 0);
    });
    observer.observe(containerRef.current!);

    return () => {
      disposed = true;
      pendingInput = "";
      clearConnectWatchdog();
      clearTimeout(colsTimer);
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
