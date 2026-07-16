import type { IMarker, Terminal as XTerm } from "@xterm/xterm";

import { extractCommand } from "./autocomplete/engine";

const MAX_TRACKED = 500;

export interface CommandMark {
  marker: Pick<IMarker, "line" | "isDisposed"> & Partial<IMarker>;
  text: string;
}

export function stickyMarkAt(
  marks: readonly CommandMark[],
  viewportY: number,
): CommandMark | null {
  for (let i = marks.length - 1; i >= 0; i--) {
    const mark = marks[i];
    if (mark.marker.isDisposed) continue;
    if (mark.marker.line === viewportY) return null;
    if (mark.marker.line < viewportY) return mark;
  }
  return null;
}

export class CommandTracker {
  private readonly term: XTerm;
  private marks: Array<{ marker: IMarker; text: string }> = [];

  constructor(term: XTerm) {
    this.term = term;
  }

  noteInput(data: string) {
    if (data !== "\r" && data !== "\r\n") return;
    const buf = this.term.buffer.active;
    if (buf.type === "alternate") return;
    const cursorRow = buf.baseY + buf.cursorY;
    let startRow = cursorRow;
    while (startRow > 0 && buf.getLine(startRow)?.isWrapped) startRow--;
    const text = buf.getLine(startRow)?.translateToString(true) ?? "";
    if (!extractCommand(text)) return;
    this.track(startRow - cursorRow, text.trimEnd());
  }

  noteCommand(command: string) {
    const text = command.split("\n")[0].trim();
    if (!text || text.length > 500) return;
    if (this.term.buffer.active.type === "alternate") return;
    this.track(0, text);
  }

  private track(cursorOffset: number, text: string) {
    const marker = this.term.registerMarker(cursorOffset);
    if (!marker) return;
    marker.onDispose(() => {
      this.marks = this.marks.filter((m) => m.marker !== marker);
    });
    this.marks.push({ marker, text });
    if (this.marks.length > MAX_TRACKED) this.marks[0].marker.dispose();
  }

  stickyAt(viewportY: number): CommandMark | null {
    return stickyMarkAt(this.marks, viewportY);
  }

  dispose() {
    for (const mark of [...this.marks]) mark.marker.dispose();
    this.marks = [];
  }
}
