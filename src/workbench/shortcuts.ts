import {
  findKeybinding,
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
