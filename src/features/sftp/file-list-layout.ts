import type { FileEntry } from "@/types/models";

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
