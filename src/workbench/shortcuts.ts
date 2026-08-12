import {
  findKeybinding,
  type KeybindingId,
  type KeybindingOverrides,
} from "./keybinding-registry";
import { useKeybindingStore } from "./keybinding-store";

export function isWorkbenchShortcut(
  event: KeyboardEvent,
  isMacOS = typeof navigator !== "undefined" &&
    /Mac|iPhone|iPad|iPod/.test(navigator.platform),
  overrides: KeybindingOverrides = useKeybindingStore.getState().overrides,
): boolean {
  return findKeybinding(event, overrides, isMacOS) !== null;
}

export function clipboardShortcutShouldDefer(
  id: KeybindingId,
  overlayOpen: boolean,
  activeElement: Element | null,
  hasSelectedText = false,
): boolean {
  if (id !== "terminal.copy" && id !== "terminal.paste") return false;
  if (overlayOpen) return true;
  if (id === "terminal.copy" && hasSelectedText) return true;
  if (!activeElement) return false;
  if (activeElement.closest(".xterm")) return false;
  const tag = activeElement.tagName.toLowerCase();
  return (
    tag === "input" ||
    tag === "textarea" ||
    (activeElement as HTMLElement).isContentEditable === true
  );
}
