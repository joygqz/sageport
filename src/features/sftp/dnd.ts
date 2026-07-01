import type { FileEntry } from "@/types/models";
import type { PaneSide } from "./store";

/**
 * Cross-pane drag payload. HTML5 drag-and-drop can't carry rich objects
 * reliably across elements, so the dragged selection is stashed here on
 * `dragstart` and read by the opposite pane on `drop`.
 */
export const dragState: { fromSide: PaneSide | null; entries: FileEntry[] } = {
  fromSide: null,
  entries: [],
};
