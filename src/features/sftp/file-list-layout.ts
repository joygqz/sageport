import type { FileEntry } from "@/types/models";

export type FileSortKey = "name" | "size" | "modified";
export type FileSortDirection = "ascending" | "descending";

export interface FileSort {
  key: FileSortKey;
  direction: FileSortDirection;
}

export const DEFAULT_FILE_SORT: FileSort = {
  key: "name",
  direction: "ascending",
};

export interface ScrollVisibilityState {
  position: number;
  direction: "up" | "down" | null;
  distance: number;
  visible: boolean;
}

export const INITIAL_SCROLL_VISIBILITY: ScrollVisibilityState = {
  position: 0,
  direction: null,
  distance: 0,
  visible: true,
};

const fileNameCollator = new Intl.Collator(undefined, {
  numeric: true,
  sensitivity: "base",
});

function compareNames(a: FileEntry, b: FileEntry): number {
  return fileNameCollator.compare(a.name, b.name);
}

function compareNullableModified(
  a: FileEntry,
  b: FileEntry,
  direction: number,
): number {
  if (a.modified === null && b.modified === null) {
    return direction * compareNames(a, b);
  }
  if (a.modified === null) return 1;
  if (b.modified === null) return -1;
  return (
    direction * (a.modified - b.modified) || direction * compareNames(a, b)
  );
}

function compareEntries(a: FileEntry, b: FileEntry, sort: FileSort): number {
  const aDirectory = a.kind === "dir";
  const bDirectory = b.kind === "dir";
  if (aDirectory !== bDirectory) return aDirectory ? -1 : 1;

  const direction = sort.direction === "ascending" ? 1 : -1;
  if (sort.key === "name") return direction * compareNames(a, b);
  if (sort.key === "modified") {
    return compareNullableModified(a, b, direction);
  }
  if (aDirectory && bDirectory) return compareNames(a, b);
  return direction * (a.size - b.size) || direction * compareNames(a, b);
}

export function visibleFileEntries(
  entries: readonly FileEntry[],
  showHidden: boolean,
  query: string,
  sort: FileSort,
): FileEntry[] {
  const normalizedQuery = query.trim().toLocaleLowerCase();
  return entries
    .filter(
      (entry) =>
        (showHidden || !(entry.hidden ?? entry.name.startsWith("."))) &&
        (!normalizedQuery ||
          entry.name.toLocaleLowerCase().includes(normalizedQuery)),
    )
    .sort((a, b) => compareEntries(a, b, sort));
}

export function inlineCreateBlurAction(value: string): "create" | "cancel" {
  return value.trim() ? "create" : "cancel";
}

export function inlineCreateRowIndex(
  entries: readonly Pick<FileEntry, "kind">[],
  kind: "file" | "folder",
): number {
  if (kind === "folder") return 0;

  for (let index = entries.length - 1; index >= 0; index--) {
    if (entries[index]?.kind === "dir") return index + 1;
  }
  return 0;
}

export function updateScrollVisibility(
  state: ScrollVisibilityState,
  scrollTop: number,
  hideOffset: number,
  directionThreshold = 6,
): ScrollVisibilityState {
  const position = Math.max(0, scrollTop);
  if (position === 0) return INITIAL_SCROLL_VISIBILITY;

  const delta = position - state.position;
  if (delta === 0) return state;

  const direction = delta > 0 ? "down" : "up";
  const distance =
    state.direction === direction
      ? state.distance + Math.abs(delta)
      : Math.abs(delta);
  const crossedThreshold = distance >= directionThreshold;
  const visible = crossedThreshold
    ? direction === "up" || position < hideOffset
    : state.visible;

  return {
    position,
    direction,
    distance: crossedThreshold ? 0 : distance,
    visible,
  };
}
