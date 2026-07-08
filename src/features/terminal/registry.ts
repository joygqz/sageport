import type { Terminal as XTerm } from "@xterm/xterm";
import type { FitAddon } from "@xterm/addon-fit";
import type { SearchAddon } from "@xterm/addon-search";

export interface TerminalEntry {
  term: XTerm;
  fit: FitAddon;
  search: SearchAddon;
}

const registry = new Map<string, TerminalEntry>();

export function registerTerminal(id: string, entry: TerminalEntry) {
  registry.set(id, entry);
}

export function unregisterTerminal(id: string) {
  registry.delete(id);
}

export function getTerminal(id: string | null): TerminalEntry | undefined {
  return id ? registry.get(id) : undefined;
}

export function focusTerminal(id: string | null) {
  if (!id) return;
  registry.get(id)?.term.focus();
}

export function applyTerminalFontSize(size: number) {
  for (const { term, fit } of registry.values()) {
    term.options.fontSize = size;
    try {
      fit.fit();
    } catch {}
  }
}

export function applyTerminalFont(fontFamily: string) {
  for (const { term, fit } of registry.values()) {
    term.options.fontFamily = fontFamily;
    try {
      fit.fit();
    } catch {}
  }
}

export function readTerminalContext(
  id: string | null,
  maxLines = 60,
): string | undefined {
  if (!id) return undefined;
  const entry = registry.get(id);
  if (!entry) return undefined;

  const buf = entry.term.buffer.active;
  const start = Math.max(0, buf.length - maxLines);
  const lines: string[] = [];
  for (let i = start; i < buf.length; i++) {
    const line = buf.getLine(i);
    if (line) lines.push(line.translateToString(true));
  }
  const text = lines.join("\n").replace(/\s+$/, "");
  return text || undefined;
}
