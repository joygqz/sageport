import { useEffect, useRef } from "react";

import { useI18n } from "@/i18n";
import { useTheme } from "@/themes/useTheme";
import {
  terminalTabs,
  useTabsStore,
  type AdhocTarget,
  type TerminalTarget,
} from "@/workbench/tabs";
import { monoFontFamily } from "@/workbench/font";
import { terminalFontSize } from "@/workbench/zoom";
import { createAutocomplete } from "./autocomplete/controller";
import { useBroadcastStore } from "./broadcast";
import { useHostKeyStore } from "./host-key";
import { bridgeMonitorEvents, startMonitor, stopMonitor } from "./monitor";
import { TerminalSession } from "./session";
import { disposeSession, getSession, registerSession } from "./sessions";
import { localTransport, sshAdhocTransport, sshTransport } from "./transport";
import { terminalTheme } from "./xterm";

export function TerminalView({
  sessionId,
  target,
  hostId,
  adhoc,
  attempt,
  active,
}: {
  sessionId: string;
  target: TerminalTarget;
  hostId: string;
  adhoc?: AdhocTarget;
  attempt: number;
  active: boolean;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const sessionRef = useRef<TerminalSession | null>(null);
  const { theme } = useTheme();
  const { t } = useI18n();
  const themeRef = useRef(theme);
  const translateRef = useRef(t);
  const connectionKey = JSON.stringify({ target, hostId, adhoc, attempt });

  useEffect(() => {
    themeRef.current = theme;
    sessionRef.current?.setTheme(terminalTheme(theme));
  }, [theme]);

  useEffect(() => {
    translateRef.current = t;
  }, [t]);

  useEffect(() => {
    const existing = getSession(sessionId);
    if (existing?.connectionKey === connectionKey) {
      sessionRef.current = existing;
      existing.attach(containerRef.current!);
      return () => {
        existing.detach();
        if (sessionRef.current === existing) sessionRef.current = null;
      };
    }
    if (existing) disposeSession(sessionId);

    const isLocal = target === "local";
    const isSshLike = !isLocal;
    const transport = isLocal
      ? localTransport(sessionId)
      : target === "ssh-adhoc" && adhoc
        ? sshAdhocTransport(sessionId, attempt, adhoc)
        : sshTransport(sessionId, hostId, attempt);
    if (isSshLike) bridgeMonitorEvents();

    const describeError = (code?: string | null, message?: string) => {
      const translate = translateRef.current;
      if (code === "invalid") return translate("ssh.credentialsMissing");
      if (code === "auth") return translate("ssh.authFailed");
      if (code === "host_key") return translate("ssh.hostKeyRejected");
      if (code === "timeout") return translate("ssh.connectTimedOut");
      return message;
    };

    const autocomplete =
      target === "ssh"
        ? createAutocomplete({
            hostId,
            send: (data) => sessionRef.current?.send(data),
          })
        : null;

    const session = new TerminalSession({
      id: sessionId,
      connectionKey,
      transport,
      fontFamily: monoFontFamily(),
      fontSize: terminalFontSize(),
      theme: terminalTheme(themeRef.current),
      watchHostKey: isSshLike,
      onStatus: (e) => {
        if (isSshLike) {
          if (e.status === "connected") startMonitor(sessionId);
          else if (e.status === "closed" || e.status === "error") {
            stopMonitor(sessionId);
            useHostKeyStore.getState().rejectSession(sessionId);
          }
        }
        useTabsStore
          .getState()
          .setTerminalStatus(
            sessionId,
            e.status,
            e.status === "error" ? describeError(e.code, e.message) : e.message,
          );
      },
      onUserInput: (data) => {
        autocomplete?.handleData(data);
        if (isSshLike && useBroadcastStore.getState().enabled) {
          for (const other of terminalTabs(useTabsStore.getState().tabs)) {
            if (
              other.target !== "local" &&
              other.id !== sessionId &&
              other.status === "connected"
            ) {
              getSession(other.id)?.send(data);
            }
          }
        }
      },
      onDispose: () => {
        autocomplete?.dispose();
        if (isSshLike) {
          stopMonitor(sessionId);
          useHostKeyStore.getState().rejectSession(sessionId);
        }
      },
    });
    sessionRef.current = session;
    autocomplete?.attach(session.term);
    registerSession(sessionId, session);
    session.attach(containerRef.current!);

    return () => {
      // A Tab drag can temporarily remount this view. Keep the terminal and
      // its SSH transport alive; the next view simply reattaches it. Closing
      // the Tab or starting a real reconnect calls disposeSession instead.
      session.detach();
      if (sessionRef.current === session) sessionRef.current = null;
    };
    // This effect owns the connection lifetime. Keep presentation-only values
    // (theme and translations) out of its dependencies so tab re-renders and
    // visual updates can never dispose and recreate a live terminal.
  }, [sessionId, target, hostId, adhoc, attempt, connectionKey]);

  useEffect(() => {
    if (active) sessionRef.current?.focus();
  }, [active]);

  return <div ref={containerRef} className="h-full w-full" />;
}
