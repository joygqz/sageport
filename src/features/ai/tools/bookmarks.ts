import { Bookmark, BookmarkPlus, Trash2 } from "lucide-react";

import { ipc } from "@/lib/ipc";
import { invalidateBookmarks } from "./cache";
import {
  optionalStr,
  str,
  toolFailure,
  toolSuccess,
  type AiTool,
  type ToolExecutionResult,
} from "./types";

async function listBookmarks(): Promise<ToolExecutionResult> {
  const bookmarks = await ipc.bookmarks.list();
  if (bookmarks.length === 0)
    return toolSuccess("No SFTP bookmarks saved yet.");
  return toolSuccess(
    JSON.stringify(
      bookmarks.map((b) => ({
        id: b.id,
        label: b.label,
        path: b.path,
        hostId: b.hostId ?? undefined,
      })),
    ),
  );
}

async function createBookmark(
  args: Record<string, unknown>,
): Promise<ToolExecutionResult> {
  const label = optionalStr(args, "label");
  const path = optionalStr(args, "path");
  if (!label || !path) {
    return toolFailure("Error: label and path are required.");
  }
  const bookmark = await ipc.bookmarks.create({
    label,
    path,
    hostId: optionalStr(args, "hostId") ?? null,
  });
  invalidateBookmarks();
  return toolSuccess(`Saved bookmark "${bookmark.label}". id: ${bookmark.id}`);
}

async function deleteBookmark(
  args: Record<string, unknown>,
): Promise<ToolExecutionResult> {
  const id = str(args, "id");
  if (!id) return toolFailure("Error: no bookmark id given.");
  try {
    await ipc.bookmarks.remove(id);
  } catch {
    return toolFailure(`Error: could not delete bookmark "${id}".`);
  }
  invalidateBookmarks();
  return toolSuccess(`Deleted bookmark ${id}.`);
}

export const bookmarkTools: AiTool[] = [
  {
    spec: {
      name: "list_bookmarks",
      description: "List saved SFTP path bookmarks.",
      parameters: {
        type: "object",
        properties: {},
        additionalProperties: false,
      },
    },
    icon: Bookmark,
    labelKey: "ai.tool.listBookmarks",
    execute: async () => listBookmarks(),
  },
  {
    spec: {
      name: "create_bookmark",
      description:
        "Save an SFTP path bookmark. Omit hostId for the local filesystem.",
      parameters: {
        type: "object",
        properties: {
          label: { type: "string", description: "Bookmark name." },
          path: { type: "string", description: "Directory path to bookmark." },
          hostId: {
            type: "string",
            description: "Host id from list_hosts. Omit for local paths.",
          },
        },
        required: ["label", "path"],
        additionalProperties: false,
      },
    },
    icon: BookmarkPlus,
    labelKey: "ai.tool.createBookmark",
    requiresApproval: true,
    execute: async (args) => createBookmark(args),
  },
  {
    spec: {
      name: "delete_bookmark",
      description: "Delete an SFTP bookmark by id.",
      parameters: {
        type: "object",
        properties: { id: { type: "string", description: "Bookmark id." } },
        required: ["id"],
        additionalProperties: false,
      },
    },
    icon: Trash2,
    labelKey: "ai.tool.deleteBookmark",
    requiresApproval: true,
    execute: async (args) => deleteBookmark(args),
  },
];
