import type { LucideIcon } from "lucide-react";

import type { TKey } from "@/i18n";
import type { AiToolSpec } from "@/types/models";
import { askTools } from "./ask";
import { bookmarkTools } from "./bookmarks";
import { credentialTools } from "./credentials";
import { fileTools } from "./files";
import { forwardTools } from "./forwards";
import { groupTools } from "./groups";
import { hostTools } from "./hosts";
import { monitorTools } from "./monitor";
import { snippetTools } from "./snippets";
import { terminalTools } from "./terminal";
import {
  toolFailure,
  type AiTool,
  type PreparedCall,
  type ToolExecutionContext,
  type ToolExecutionResult,
} from "./types";

export const ALL_TOOLS: AiTool[] = [
  ...askTools,
  ...terminalTools,
  ...hostTools,
  ...groupTools,
  ...snippetTools,
  ...forwardTools,
  ...fileTools,
  ...bookmarkTools,
  ...credentialTools,
  ...monitorTools,
];

const TOOLS_BY_NAME = new Map(ALL_TOOLS.map((tool) => [tool.spec.name, tool]));

export function getTool(name: string): AiTool | undefined {
  return TOOLS_BY_NAME.get(name);
}

export const AI_TOOL_SPECS: AiToolSpec[] = ALL_TOOLS.map((tool) => tool.spec);

export const TOOLS_REQUIRING_APPROVAL: ReadonlySet<string> = new Set(
  ALL_TOOLS.filter((tool) => tool.requiresApproval).map(
    (tool) => tool.spec.name,
  ),
);

export const TOOL_ICONS: Record<string, LucideIcon> = Object.fromEntries(
  ALL_TOOLS.map((tool) => [tool.spec.name, tool.icon]),
);

export const TOOL_LABEL_KEYS: Record<string, TKey> = Object.fromEntries(
  ALL_TOOLS.map((tool) => [tool.spec.name, tool.labelKey]),
);

export const TOOL_CONFIRM_KEYS: Record<string, TKey> = Object.fromEntries(
  ALL_TOOLS.flatMap((tool) =>
    tool.confirmKey ? [[tool.spec.name, tool.confirmKey] as const] : [],
  ),
);

export async function executeTool(
  name: string,
  args: Record<string, unknown>,
  context: ToolExecutionContext = {},
): Promise<ToolExecutionResult> {
  const tool = TOOLS_BY_NAME.get(name);
  if (!tool) return toolFailure(`Error: unknown tool "${name}".`);
  if (!tool.execute) {
    return toolFailure(
      `Error: ${name} is handled by the chat UI and should not reach the executor.`,
    );
  }
  return tool.execute(args, context);
}

export async function prepareTool(
  name: string,
  args: Record<string, unknown>,
  meta: { userPrompt: string },
): Promise<PreparedCall> {
  const tool = TOOLS_BY_NAME.get(name);
  if (!tool?.prepare) return { args };
  return tool.prepare(args, meta);
}
