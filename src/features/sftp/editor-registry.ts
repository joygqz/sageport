interface FocusableEditor {
  focus: () => void;
}

const registry = new Map<string, FocusableEditor>();

export function registerFileEditor(id: string, editor: FocusableEditor) {
  registry.set(id, editor);
}

export function unregisterFileEditor(id: string) {
  registry.delete(id);
}

export function focusFileEditor(id: string | null) {
  if (!id) return;
  registry.get(id)?.focus();
}
