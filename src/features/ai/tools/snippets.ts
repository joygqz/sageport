import { Play, SquarePen, Save, ScrollText, Trash2 } from "lucide-react";

import { parseVariables, substitute } from "@/features/snippets/variables";
import { ipc } from "@/lib/ipc";
import type { Snippet, SnippetInput } from "@/types/models";
import { invalidateSnippets } from "./cache";
import { executeTerminalCommand, prepareTerminalTarget } from "./terminal";
import {
  optionalStr,
  nullableStr,
  record,
  str,
  toolFailure,
  toolSuccess,
  type AiTool,
  type PreparedCall,
  type ToolExecutionResult,
} from "./types";

async function findSnippet(id: string): Promise<Snippet | undefined> {
  const snippets = await ipc.snippets.list();
  return snippets.find((s) => s.id === id);
}

async function listSnippets(): Promise<ToolExecutionResult> {
  const snippets = await ipc.snippets.list();
  if (snippets.length === 0) {
    return toolSuccess("No saved command snippets yet.");
  }
  return toolSuccess(
    JSON.stringify(
      snippets.map((s) => ({
        id: s.id,
        name: s.name,
        description: s.description || undefined,
        command: s.command,
        variables: parseVariables(s.command).map((v) => v.name),
      })),
    ),
  );
}

async function prepareRunSnippet(
  args: Record<string, unknown>,
): Promise<PreparedCall> {
  const snippetId = str(args, "snippetId");
  if (!snippetId) {
    return { args, preflightError: "Error: no snippetId given." };
  }
  const snippet = await findSnippet(snippetId);
  if (!snippet) {
    return {
      args,
      preflightError: `Error: no snippet with id "${snippetId}". Call list_snippets to see valid ids.`,
    };
  }
  const command = substitute(snippet.command, record(args, "values")).trim();
  if (!command) {
    return {
      args: { ...args, command },
      preflightError: "Error: the snippet resolved to an empty command.",
    };
  }
  return prepareTerminalTarget({ ...args, command });
}

function inputFromArgs(
  args: Record<string, unknown>,
  base?: Snippet,
): SnippetInput {
  const description = nullableStr(args, "description");
  return {
    name: optionalStr(args, "name") ?? base?.name ?? "",
    command: optionalStr(args, "command") ?? base?.command ?? "",
    description:
      description === undefined ? (base?.description ?? null) : description,
  };
}

async function saveSnippet(
  args: Record<string, unknown>,
): Promise<ToolExecutionResult> {
  const name = optionalStr(args, "name");
  const command = optionalStr(args, "command");
  if (!name || !command) {
    return toolFailure("Error: name and command are required.");
  }
  const snippet = await ipc.snippets.create(inputFromArgs(args));
  invalidateSnippets();
  return toolSuccess(`Saved snippet "${snippet.name}". id: ${snippet.id}`);
}

async function updateSnippet(
  args: Record<string, unknown>,
): Promise<ToolExecutionResult> {
  const id = str(args, "id");
  if (!id) return toolFailure("Error: no snippet id given.");
  const current = await findSnippet(id);
  if (!current) return toolFailure(`Error: no snippet with id "${id}".`);
  const snippet = await ipc.snippets.update(id, inputFromArgs(args, current));
  invalidateSnippets();
  return toolSuccess(`Updated snippet "${snippet.name}".`);
}

async function deleteSnippet(
  args: Record<string, unknown>,
): Promise<ToolExecutionResult> {
  const id = str(args, "id");
  if (!id) return toolFailure("Error: no snippet id given.");
  try {
    await ipc.snippets.remove(id);
  } catch {
    return toolFailure(`Error: could not delete snippet "${id}".`);
  }
  invalidateSnippets();
  return toolSuccess(`Deleted snippet ${id}.`);
}

export const snippetTools: AiTool[] = [
  {
    spec: {
      name: "list_snippets",
      description:
        "List saved command snippets with ids, commands, and any {{variable}} placeholders they contain.",
      parameters: {
        type: "object",
        properties: {},
        additionalProperties: false,
      },
    },
    icon: ScrollText,
    labelKey: "ai.tool.listSnippets",
    execute: async () => listSnippets(),
  },
  {
    spec: {
      name: "run_snippet",
      description:
        "Run a saved snippet in a live terminal. This requires user approval in supervised mode and runs automatically in autonomous mode. Fill any {{variable}} placeholders via values. Omit sessionId for the Current terminal.",
      parameters: {
        type: "object",
        properties: {
          snippetId: {
            type: "string",
            description: "Snippet id from list_snippets.",
          },
          values: {
            type: "object",
            description:
              "Map of variable name to value for the snippet's {{placeholders}}.",
            additionalProperties: { type: "string" },
          },
          sessionId: {
            type: "string",
            description:
              "Session id from list_terminal_sessions. Omit to use the current terminal.",
          },
        },
        required: ["snippetId"],
        additionalProperties: false,
      },
    },
    icon: Play,
    labelKey: "ai.tool.runSnippet",
    requiresApproval: true,
    confirmKey: "ai.confirmRun",
    prepare: (args) => prepareRunSnippet(args),
    execute: executeTerminalCommand,
  },
  {
    spec: {
      name: "save_snippet",
      description:
        "Save a command as a reusable snippet. Use {{name}} or {{name:default}} for variables.",
      parameters: {
        type: "object",
        properties: {
          name: { type: "string", description: "Snippet name." },
          command: { type: "string", description: "The command text." },
          description: { type: "string", description: "Optional description." },
        },
        required: ["name", "command"],
        additionalProperties: false,
      },
    },
    icon: Save,
    labelKey: "ai.tool.saveSnippet",
    requiresApproval: true,
    execute: async (args) => saveSnippet(args),
  },
  {
    spec: {
      name: "update_snippet",
      description:
        "Update a saved snippet. Only the given fields change; others are kept.",
      parameters: {
        type: "object",
        properties: {
          id: { type: "string", description: "Snippet id." },
          name: { type: "string" },
          command: { type: "string" },
          description: {
            type: ["string", "null"],
            description: "Set null to clear the description.",
          },
        },
        required: ["id"],
        additionalProperties: false,
      },
    },
    icon: SquarePen,
    labelKey: "ai.tool.updateSnippet",
    requiresApproval: true,
    execute: async (args) => updateSnippet(args),
  },
  {
    spec: {
      name: "delete_snippet",
      description: "Delete a saved snippet by id.",
      parameters: {
        type: "object",
        properties: { id: { type: "string", description: "Snippet id." } },
        required: ["id"],
        additionalProperties: false,
      },
    },
    icon: Trash2,
    labelKey: "ai.tool.deleteSnippet",
    requiresApproval: true,
    execute: async (args) => deleteSnippet(args),
  },
];
