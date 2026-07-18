import { FolderPlus, SquarePen, Trash2 } from "lucide-react";

import { ipc } from "@/lib/ipc";
import type { Group, GroupInput } from "@/types/models";
import { invalidateGroups, invalidateHosts } from "./cache";
import {
  nullableStr,
  optionalStr,
  str,
  toolFailure,
  toolSuccess,
  type AiTool,
  type ToolExecutionResult,
} from "./types";

async function findGroup(id: string): Promise<Group | undefined> {
  const groups = await ipc.groups.list();
  return groups.find((g) => g.id === id);
}

function inputFromArgs(
  args: Record<string, unknown>,
  base?: Group,
): GroupInput {
  const parentId = nullableStr(args, "parentId");
  return {
    name: optionalStr(args, "name") ?? base?.name ?? "",
    parentId: parentId === undefined ? (base?.parentId ?? null) : parentId,
  };
}

async function createGroup(
  args: Record<string, unknown>,
): Promise<ToolExecutionResult> {
  const name = optionalStr(args, "name");
  if (!name) return toolFailure("Error: a group name is required.");
  const group = await ipc.groups.create(inputFromArgs(args));
  invalidateGroups();
  return toolSuccess(`Created group "${group.name}". id: ${group.id}`);
}

async function updateGroup(
  args: Record<string, unknown>,
): Promise<ToolExecutionResult> {
  const id = str(args, "id");
  if (!id) return toolFailure("Error: no group id given.");
  const current = await findGroup(id);
  if (!current) return toolFailure(`Error: no group with id "${id}".`);
  const group = await ipc.groups.update(id, inputFromArgs(args, current));
  invalidateGroups();
  return toolSuccess(`Updated group "${group.name}".`);
}

async function deleteGroup(
  args: Record<string, unknown>,
): Promise<ToolExecutionResult> {
  const id = str(args, "id");
  if (!id) return toolFailure("Error: no group id given.");
  try {
    await ipc.groups.remove(id);
  } catch {
    return toolFailure(`Error: could not delete group "${id}".`);
  }
  invalidateGroups();
  invalidateHosts();
  return toolSuccess(
    `Deleted group ${id}. Its hosts and child groups were moved to its parent.`,
  );
}

export const groupTools: AiTool[] = [
  {
    spec: {
      name: "create_group",
      description: "Create a host group for organizing hosts.",
      parameters: {
        type: "object",
        properties: {
          name: { type: "string", description: "Group name." },
          parentId: {
            type: "string",
            description: "Parent group id for nesting (from list_groups).",
          },
        },
        required: ["name"],
        additionalProperties: false,
      },
    },
    icon: FolderPlus,
    labelKey: "ai.tool.createGroup",
    requiresApproval: true,
    execute: async (args) => createGroup(args),
  },
  {
    spec: {
      name: "update_group",
      description:
        "Rename or re-parent a host group. Only the given fields change.",
      parameters: {
        type: "object",
        properties: {
          id: { type: "string", description: "Group id." },
          name: { type: "string" },
          parentId: {
            type: ["string", "null"],
            description: "New parent group id. Set null to make it top-level.",
          },
        },
        required: ["id"],
        additionalProperties: false,
      },
    },
    icon: SquarePen,
    labelKey: "ai.tool.updateGroup",
    requiresApproval: true,
    execute: async (args) => updateGroup(args),
  },
  {
    spec: {
      name: "delete_group",
      description:
        "Delete a host group without deleting hosts. Its hosts and direct child groups move to its parent.",
      parameters: {
        type: "object",
        properties: {
          id: { type: "string", description: "Group id." },
        },
        required: ["id"],
        additionalProperties: false,
      },
    },
    icon: Trash2,
    labelKey: "ai.tool.deleteGroup",
    requiresApproval: true,
    execute: async (args) => deleteGroup(args),
  },
];
