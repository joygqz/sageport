import { readText } from "@tauri-apps/plugin-clipboard-manager";
import type { Terminal as XTerm } from "@xterm/xterm";

import { ipc } from "@/lib/ipc";

async function clipboardImagePath(): Promise<string | null> {
  return ipc.clipboard.saveImage().catch(() => null);
}

export async function pasteIntoTerminal(
  term: XTerm,
  opts: { images: boolean },
): Promise<void> {
  if (opts.images) {
    const path = await clipboardImagePath();
    if (path) {
      term.paste(path);
      return;
    }
  }
  const text = await readText().catch(() => "");
  if (text) term.paste(text);
}

export function attachImagePaste(term: XTerm): () => void {
  const root = term.element;
  if (!root) return () => {};
  const onPaste = (event: ClipboardEvent) => {
    const data = event.clipboardData;
    if (!data) return;
    const hasImage = Array.from(data.items).some((item) =>
      item.type.startsWith("image/"),
    );
    if (!hasImage && data.getData("text")) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    void pasteIntoTerminal(term, { images: true });
  };
  root.addEventListener("paste", onPaste, true);
  return () => root.removeEventListener("paste", onPaste, true);
}
