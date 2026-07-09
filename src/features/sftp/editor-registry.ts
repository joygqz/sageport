import type { EditorView } from "@codemirror/view";

const registry = new Map<string, EditorView>();

export function registerFileEditor(id: string, view: EditorView) {
  registry.set(id, view);
}

export function unregisterFileEditor(id: string) {
  registry.delete(id);
}

export function focusFileEditor(id: string | null) {
  if (!id) return;
  registry.get(id)?.focus();
}
