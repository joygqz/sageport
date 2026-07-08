import type { IDecoration, Terminal as XTerm } from "@xterm/xterm";

import { ipc } from "@/lib/ipc";
import { COMMON_COMMANDS } from "./common-commands";
import { currentInput, extractCommand, suggest } from "./engine";

const DEBOUNCE_MS = 80;

export interface AutocompleteController {
  attach: (term: XTerm) => void;
  handleData: (data: string) => void;
  dispose: () => void;
}

export function createAutocomplete(opts: {
  hostId: string | null;
  send: (data: string) => void;
}): AutocompleteController {
  let term: XTerm | null = null;
  let ghost = "";
  let decoration: IDecoration | null = null;
  let timer: ReturnType<typeof setTimeout> | null = null;
  let seq = 0;
  let disposed = false;

  const clearGhost = () => {
    ghost = "";
    decoration?.dispose();
    decoration = null;
  };

  const render = () => {
    decoration?.dispose();
    decoration = null;
    if (!term || !ghost) return;
    const buf = term.buffer.active;
    if (buf.type === "alternate") return;
    try {
      const marker = term.registerMarker(0);
      if (!marker) return;
      const created = term.registerDecoration({ marker, x: buf.cursorX });
      if (!created) return;
      created.onRender((el) => {
        el.textContent = ghost;
        el.style.color = "var(--color-muted-foreground, #888)";
        el.style.opacity = "0.5";
        el.style.whiteSpace = "pre";
        el.style.width = "max-content";
        el.style.pointerEvents = "none";
      });
      decoration = created;
    } catch {
      clearGhost();
    }
  };

  const refresh = async () => {
    if (!term || disposed) return clearGhost();
    const buf = term.buffer.active;
    if (buf.type === "alternate") return clearGhost();

    const line =
      buf.getLine(buf.cursorY + buf.baseY)?.translateToString(false) ?? "";
    const afterCursor = line.slice(buf.cursorX).replace(/\s+$/, "");
    if (afterCursor) return clearGhost();

    const input = currentInput(line.slice(0, buf.cursorX));
    if (!input.trim() || input.length < 2) return clearGhost();

    const mine = ++seq;
    const history = await ipc.history
      .search(opts.hostId, input, 5)
      .catch(() => [] as string[]);
    if (mine !== seq || disposed || !term) return;

    const commons = COMMON_COMMANDS.filter((c) => c.startsWith(input));
    const next = suggest(input, [...history, ...commons]);
    ghost = next ?? "";
    render();
  };

  const schedule = () => {
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => void refresh(), DEBOUNCE_MS);
  };

  const capture = () => {
    if (!term) return;
    const buf = term.buffer.active;
    const line =
      buf.getLine(buf.cursorY + buf.baseY)?.translateToString(true) ?? "";
    const command = extractCommand(line);
    if (command) void ipc.history.add(opts.hostId, command).catch(() => {});
  };

  const attach = (instance: XTerm) => {
    term = instance;
    instance.onCursorMove(() => schedule());
    instance.attachCustomKeyEventHandler((e) => {
      if (e.type !== "keydown") return true;
      if (e.key === "Escape" && ghost) {
        clearGhost();
        return true;
      }
      if (e.key === "ArrowRight" && ghost) {
        const buf = instance.buffer.active;
        const line =
          buf.getLine(buf.cursorY + buf.baseY)?.translateToString(false) ?? "";
        if (!line.slice(buf.cursorX).replace(/\s+$/, "")) {
          opts.send(ghost);
          clearGhost();
          return false;
        }
      }
      return true;
    });
  };

  const handleData = (data: string) => {
    if (data.includes("\r") || data.includes("\n")) {
      capture();
      clearGhost();
    } else {
      schedule();
    }
  };

  const dispose = () => {
    disposed = true;
    if (timer) clearTimeout(timer);
    clearGhost();
    term = null;
  };

  return { attach, handleData, dispose };
}
