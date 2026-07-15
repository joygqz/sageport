import { useEffect, useRef } from "react";

import { useI18n } from "@/i18n";
import { useTheme } from "@/themes/useTheme";
import {
  terminalPanes,
  useTabsStore,
  type AdhocTarget,
  type TerminalTarget,
} from "@/workbench/tabs";
import { monoFontFamily } from "@/workbench/font";
import { terminalFontSize } from "@/workbench/zoom";
import { createAutocomplete } from "./autocomplete/controller";
import { broadcastTargets, useBroadcastStore } from "./broadcast";
import { useHostKeyStore } from "./host-key";
import { usePasswordPromptStore } from "./password-prompt";
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
      ? localTransport(sessionId, attempt)
      : target === "ssh-adhoc" && adhoc
        ? sshAdhocTransport(sessionId, attempt, adhoc)
        : sshTransport(sessionId, hostId, attempt);
    if (isSshLike) void bridgeMonitorEvents().catch(() => {});

    const describeError = (code?: string | null, message?: string) => {
      const translate = translateRef.current;
      if (code === "invalid") return translate("ssh.credentialsMissing");
      if (code === "auth") return translate("ssh.authFailed");
      if (code === "host_key") return translate("ssh.hostKeyRejected");
      if (code === "timeout") return translate("ssh.connectTimedOut");
      if (code === "dns") return translate("ssh.dnsFailed");
      if (code === "network") return translate("ssh.connectionInterrupted");
      if (code === "cancelled") return undefined;
      return message;
    };

    const autocomplete = createAutocomplete({
      hostId: target === "ssh" ? hostId : null,
      send: (data) => sessionRef.current?.send(data),
    });

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
          if (e.status === "connected") {
            void startMonitor(sessionId, attempt).catch(() => {});
          } else if (e.status === "closed" || e.status === "error") {
            stopMonitor(sessionId, attempt);
            useHostKeyStore.getState().rejectSession(sessionId);
            usePasswordPromptStore.getState().cancelSession(sessionId);
          }
        }
        useTabsStore
          .getState()
          .setTerminalStatus(
            sessionId,
            e.status,
            e.status === "error" ? describeError(e.code, e.message) : e.message,
            e.status === "error" ? e.code : undefined,
          );
      },
      onUserInput: (data) => {
        autocomplete.handleData(data);
        if (useBroadcastStore.getState().enabled) {
          const panes = terminalPanes(useTabsStore.getState().tabs);
          for (const other of broadcastTargets(panes, sessionId)) {
            getSession(other.id)?.send(data);
          }
        }
      },
      onDispose: () => {
        autocomplete.dispose();
        if (isSshLike) {
          stopMonitor(sessionId, attempt);
          useHostKeyStore.getState().rejectSession(sessionId);
          usePasswordPromptStore.getState().cancelSession(sessionId);
        }
      },
    });
    sessionRef.current = session;
    autocomplete.attach(session.term);
    registerSession(sessionId, session);
    session.attach(containerRef.current!);

    return () => {
      session.detach();
      if (sessionRef.current === session) sessionRef.current = null;
    };
  }, [sessionId, target, hostId, adhoc, attempt, connectionKey]);

  useEffect(() => {
    if (active) sessionRef.current?.focus();
  }, [active]);

  return <div ref={containerRef} className="h-full w-full" />;
}
