import type { IDecoration, IDisposable, Terminal } from "@xterm/xterm";

import { findLiteralMatches, type HighlightRule } from "./highlight-rules";

interface LineText {
  text: string;
  columns: number[];
}

function readLine(term: Terminal, index: number): LineText | null {
  const line = term.buffer.active.getLine(index);
  if (!line) return null;
  let text = "";
  const columns: number[] = [];
  for (let column = 0; column < term.cols; column += 1) {
    const cell = line.getCell(column);
    if (!cell || cell.getWidth() === 0) continue;
    const chars = cell.getChars() || " ";
    for (let offset = 0; offset < chars.length; offset += 1)
      columns.push(column);
    text += chars;
  }
  return { text: text.replace(/\s+$/, ""), columns };
}

export class HighlightAddon implements IDisposable {
  private term: Terminal | null = null;
  private rules: HighlightRule[];
  private listeners: IDisposable[] = [];
  private decorations: IDecoration[] = [];
  private queued = false;

  constructor(rules: HighlightRule[]) {
    this.rules = rules;
  }

  activate(term: Terminal): void {
    this.term = term;
    this.listeners = [
      term.onWriteParsed(() => this.schedule()),
      term.onScroll(() => this.schedule()),
      term.onResize(() => this.schedule()),
    ];
    this.schedule();
  }

  setRules(rules: HighlightRule[]): void {
    this.rules = rules;
    this.schedule();
  }

  dispose(): void {
    this.listeners.splice(0).forEach((listener) => listener.dispose());
    this.clear();
    this.term = null;
  }

  private schedule(): void {
    if (this.queued) return;
    this.queued = true;
    queueMicrotask(() => {
      this.queued = false;
      this.render();
    });
  }

  private clear(): void {
    this.decorations.splice(0).forEach((decoration) => {
      decoration.dispose();
      decoration.marker.dispose();
    });
  }

  private render(): void {
    const term = this.term;
    this.clear();
    if (!term || term.buffer.active.type === "alternate") return;
    const rules = this.rules.filter((rule) => rule.enabled && rule.pattern);
    if (rules.length === 0) return;
    const buffer = term.buffer.active;
    const start = buffer.viewportY;
    const end = Math.min(buffer.length, start + term.rows);
    const cursorLine = buffer.baseY + buffer.cursorY;
    for (let lineIndex = start; lineIndex < end; lineIndex += 1) {
      const line = readLine(term, lineIndex);
      if (!line?.text) continue;
      for (const rule of rules) {
        for (const match of findLiteralMatches(
          line.text,
          rule.pattern,
          rule.caseSensitive,
        )) {
          const x = line.columns[match.start];
          const last = line.columns[match.end - 1];
          if (x === undefined || last === undefined) continue;
          const marker = term.registerMarker(lineIndex - cursorLine);
          if (!marker) continue;
          const decoration = term.registerDecoration({
            marker,
            x,
            width: last - x + 1,
            foregroundColor: rule.foreground ?? undefined,
            backgroundColor: rule.background ?? undefined,
            layer: "top",
          });
          if (decoration) this.decorations.push(decoration);
          else marker.dispose();
        }
      }
    }
  }
}
