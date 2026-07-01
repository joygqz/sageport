import type { Terminal as XTerm } from "@xterm/xterm";

/**
 * Registry of live terminal instances keyed by session id. Lets non-terminal
 * code (e.g. the AI panel) read the recent on-screen output of a session
 * without threading the xterm instance through React state.
 */
const registry = new Map<string, XTerm>();

export function registerTerminal(id: string, term: XTerm) {
  registry.set(id, term);
}

export function unregisterTerminal(id: string) {
  registry.delete(id);
}

/** Read the last `maxLines` rendered lines of a session's buffer, trimmed. */
export function readTerminalContext(
  id: string | null,
  maxLines = 60,
): string | undefined {
  if (!id) return undefined;
  const term = registry.get(id);
  if (!term) return undefined;

  const buf = term.buffer.active;
  const start = Math.max(0, buf.length - maxLines);
  const lines: string[] = [];
  for (let i = start; i < buf.length; i++) {
    const line = buf.getLine(i);
    if (line) lines.push(line.translateToString(true));
  }
  const text = lines.join("\n").replace(/\s+$/, "");
  return text || undefined;
}
