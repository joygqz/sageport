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
import {
  terminalTabs,
  useTabsStore,
  type AdhocTarget,
  type TerminalTarget,
} from "@/workbench/tabs";
import { terminalFontSize } from "@/workbench/zoom";
import { useFontStore, resolveFontFamily } from "./font-store";
import { createAutocomplete } from "./autocomplete/controller";
import { useBroadcastStore } from "./broadcast";
import { bridgeMonitorEvents, startMonitor, stopMonitor } from "./monitor";
import { registerTerminal, unregisterTerminal } from "./registry";
import {
  localTransport,
  sshAdhocTransport,
  sshTransport,
} from "./transport";
import { xtermTheme } from "./xterm-theme";

const CONNECT_WATCHDOG_MS = 45_000;

function attachWebgl(term: XTerm) {
  try {
    const webgl = new WebglAddon();
    webgl.onContextLoss(() => webgl.dispose());
    term.loadAddon(webgl);
  } catch {}
}

export function TerminalView({
  sessionId,
  target,
  hostId,
  adhoc,
  attempt,
}: {
  sessionId: string;
  target: TerminalTarget;
  hostId: string;
  adhoc?: AdhocTarget;
  attempt: number;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const termRef = useRef<XTerm | null>(null);
  const { theme } = useTheme();
  const { t } = useI18n();
  const setStatus = useTabsStore((s) => s.setTerminalStatus);

  const describeConnectError = (code?: string | null, message?: string) => {
    if (code === "invalid") return t("terminal.credentialsMissing");
    if (code === "auth") return t("terminal.authFailed");
    return message;
  };

  useEffect(() => {
    if (termRef.current) termRef.current.options.theme = xtermTheme(theme);
  }, [theme]);

  useEffect(() => {
    const isLocal = target === "local";
    const isSshLike = !isLocal;
    const transport = isLocal
      ? localTransport(sessionId)
      : target === "ssh-adhoc" && adhoc
        ? sshAdhocTransport(sessionId, attempt, adhoc)
        : sshTransport(sessionId, hostId, attempt);
    if (isSshLike) bridgeMonitorEvents();

    const fontFamily = resolveFontFamily(
      useFontStore.getState().preset,
      useFontStore.getState().customFamily,
    );
    const term = new XTerm({
      fontFamily,
      fontSize: terminalFontSize(),
      lineHeight: 1.25,
      allowProposedApi: true,

      macOptionIsMeta: true,

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
    attachWebgl(term);
    fit.fit();
    termRef.current = term;
    registerTerminal(sessionId, { term, fit, search });

    const autocomplete =
      target === "ssh"
        ? createAutocomplete({
            hostId,
            send: (data) => void transport.send(data).catch(() => {}),
          })
        : null;
    autocomplete?.attach(term);

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
      void transport
        .send(data)
        .catch(() => {})
        .finally(() => {
          sendingInput = false;
          flushInput();
        });
    };

    const dataSub = term.onData((data) => {
      pendingInput += data;
      flushInput();
      autocomplete?.handleData(data);
      if (isSshLike && useBroadcastStore.getState().enabled) {
        for (const other of terminalTabs(useTabsStore.getState().tabs)) {
          if (
            other.target !== "local" &&
            other.id !== sessionId &&
            other.status === "connected"
          ) {
            void ipc.ssh.send(other.id, data).catch(() => {});
          }
        }
      }
    });

    void (async () => {
      const [unData, unStatus] = await Promise.all([
        transport.onData((bytes) => {
          if (!disposed && !connectTimedOut) term.write(bytes);
        }),
        transport.onStatus((e) => {
          if (disposed || connectTimedOut) return;
          if (e.status !== "connecting") settleConnect();
          if (isSshLike) {
            if (e.status === "connected") startMonitor(sessionId);
            else if (e.status === "closed" || e.status === "error")
              stopMonitor(sessionId);
          }
          setStatus(
            sessionId,
            e.status,
            e.status === "error"
              ? describeConnectError(e.code, e.message)
              : e.message,
          );
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
        void transport.disconnect().catch(() => {});
      }, CONNECT_WATCHDOG_MS);
      try {
        await transport.connect({ cols: term.cols, rows: term.rows });
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

    let fitQueued = false;
    let pendingCols = 0;
    let colsTimer: ReturnType<typeof setTimeout> | undefined;

    const applyResize = (cols: number, rows: number) => {
      if (cols === term.cols && rows === term.rows) return;
      term.resize(cols, rows);
      void transport.resize(term.cols, term.rows).catch(() => {});
    };

    const observer = new ResizeObserver(() => {
      if (fitQueued) return;
      fitQueued = true;

      setTimeout(() => {
        fitQueued = false;
        if (disposed) return;
        const el = containerRef.current;

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
      if (isSshLike) stopMonitor(sessionId);
      autocomplete?.dispose();
      term.dispose();
      termRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sessionId, target, hostId, attempt]);

  return <div ref={containerRef} className="h-full w-full" />;
}
