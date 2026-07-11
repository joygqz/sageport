import type { TerminalSession } from "./session";

const sessions = new Map<string, TerminalSession>();

export function registerSession(id: string, session: TerminalSession) {
  sessions.set(id, session);
}

export function unregisterSession(id: string) {
  sessions.delete(id);
}

export function disposeSession(id: string) {
  const session = sessions.get(id);
  if (!session) return;
  sessions.delete(id);
  session.dispose();
}

export function getSession(id: string | null): TerminalSession | undefined {
  return id ? sessions.get(id) : undefined;
}

export function focusTerminal(id: string | null) {
  if (!id) return;
  sessions.get(id)?.focus();
}

export function applyTerminalFontSize(size: number) {
  for (const session of sessions.values()) session.setFontSize(size);
}

export function applyTerminalFontFamily(family: string) {
  for (const session of sessions.values()) session.setFontFamily(family);
}

export function readTerminalContext(
  id: string | null,
  maxLines = 60,
): string | undefined {
  return getSession(id)?.readContext(maxLines);
}
