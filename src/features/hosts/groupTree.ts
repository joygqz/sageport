import type { Group } from "@/types/models";

export function descendantGroupIds(groups: Group[], groupId: string) {
  const descendants = new Set([groupId]);
  let changed = true;
  while (changed) {
    changed = false;
    for (const group of groups) {
      if (
        group.parentId &&
        descendants.has(group.parentId) &&
        !descendants.has(group.id)
      ) {
        descendants.add(group.id);
        changed = true;
      }
    }
  }
  return descendants;
}
