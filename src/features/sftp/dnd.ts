import type { FileEntry } from "@/types/models";
import type { PaneSide } from "./store";

export const dragState: { fromSide: PaneSide | null; entries: FileEntry[] } = {
  fromSide: null,
  entries: [],
};
