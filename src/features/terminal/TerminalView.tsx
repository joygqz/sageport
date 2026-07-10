import { useEffect, useRef } from "react";

import { useI18n } from "@/i18n";
import { useTheme } from "@/themes/useTheme";
import {
  terminalTabs,
  useTabsStore,
  type AdhocTarget,
  type TerminalTarget,
} from "@/workbench/tabs";
import { terminalFontSize } from "@/workbench/zoom";
import { createAutocomplete } from "./autocomplete/controller";
import { useBroadcastStore } from "./broadcast";
import { useHostKeyStore } from "./host-key";
import { bridgeMonitorEvents, startMonitor, stopMonitor } from "./monitor";
import { TerminalSession } from "./session";
import { getSession, registerSession, unregisterSession } from "./sessions";
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
  const setStatus = useTabsStore((s) => s.setTerminalStatus);

  useEffect(() => {
    sessionRef.current?.setTheme(terminalTheme(theme));
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

    const describeError = (code?: string | null, message?: string) => {
      if (code === "invalid") return t("ssh.credentialsMissing");
      if (code === "auth") return t("ssh.authFailed");
      if (code === "host_key") return t("ssh.hostKeyRejected");
      if (code === "timeout") return t("ssh.connectTimedOut");
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
      transport,
      fontSize: terminalFontSize(),
      theme: terminalTheme(theme),
      watchHostKey: isSshLike,
      onStatus: (e) => {
        if (isSshLike) {
          if (e.status === "connected") startMonitor(sessionId);
          else if (e.status === "closed" || e.status === "error") {
            stopMonitor(sessionId);
            useHostKeyStore.getState().rejectSession(sessionId);
          }
        }
        setStatus(
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
    });
    sessionRef.current = session;
    autocomplete?.attach(session.term);
    registerSession(sessionId, session);
    session.attach(containerRef.current!);
    if (active) session.focus();

    return () => {
      unregisterSession(sessionId);
      if (isSshLike) {
        stopMonitor(sessionId);
        useHostKeyStore.getState().rejectSession(sessionId);
      }
      autocomplete?.dispose();
      session.dispose();
      sessionRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sessionId, target, hostId, attempt]);

  useEffect(() => {
    if (active) sessionRef.current?.focus();
  }, [active]);

  return <div ref={containerRef} className="h-full w-full" />;
}
