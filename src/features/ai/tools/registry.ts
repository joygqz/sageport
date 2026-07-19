import type { LucideIcon } from "lucide-react";

import type { TKey } from "@/i18n";
import type { AiToolSpec } from "@/types/models";
import { administrationTools } from "./administration";
import { askTools } from "./ask";
import { bookmarkTools } from "./bookmarks";
import { setAiToolCatalog } from "./catalog";
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
  ...administrationTools,
];

export const CORE_TOOL_NAMES: ReadonlySet<string> = new Set([
  "ask_user",
  "list_terminal_sessions",
  "read_terminal_output",
  "run_terminal_command",
]);

setAiToolCatalog(
  ALL_TOOLS.map((tool) => ({
    name: tool.spec.name,
    required: CORE_TOOL_NAMES.has(tool.spec.name),
  })),
);

export const TOOL_GROUPS = [
  {
    id: "core",
    tools: ALL_TOOLS.filter((tool) => CORE_TOOL_NAMES.has(tool.spec.name)),
  },
  {
    id: "terminal",
    tools: terminalTools.filter((tool) => !CORE_TOOL_NAMES.has(tool.spec.name)),
  },
  { id: "hosts", tools: [...hostTools, ...groupTools, ...monitorTools] },
  { id: "files", tools: [...fileTools, ...bookmarkTools] },
  { id: "automation", tools: [...snippetTools, ...forwardTools] },
  { id: "credentials", tools: credentialTools },
  { id: "administration", tools: administrationTools },
] as const;

const TOOLS_BY_NAME = new Map(ALL_TOOLS.map((tool) => [tool.spec.name, tool]));

const SENSITIVE_ARGUMENTS: Readonly<Record<string, ReadonlySet<string>>> = {
  create_host: new Set(["password"]),
  update_host: new Set(["password"]),
  create_identity: new Set(["password"]),
  update_identity: new Set(["password"]),
  generate_ssh_key: new Set(["passphrase"]),
  create_ssh_key: new Set(["privateKey", "passphrase"]),
  import_ssh_key_file: new Set(["passphrase"]),
  update_ssh_key: new Set(["privateKey", "passphrase"]),
  update_ai_settings: new Set(["apiKey"]),
  connect_sync: new Set(["passphrase", "settings"]),
  export_sync_backup: new Set(["passphrase"]),
  import_sync_backup: new Set(["passphrase"]),
  send_terminal_input: new Set(["data"]),
  respond_password_prompt: new Set(["password"]),
};

export function getTool(name: string): AiTool | undefined {
  return TOOLS_BY_NAME.get(name);
}

export function redactToolArguments(
  name: string,
  raw: unknown,
): Record<string, unknown> {
  const args =
    raw && typeof raw === "object" && !Array.isArray(raw)
      ? (raw as Record<string, unknown>)
      : {};
  const sensitive = SENSITIVE_ARGUMENTS[name];
  if (!sensitive) return { ...args };
  return Object.fromEntries(
    Object.entries(args).map(([key, value]) => [
      key,
      sensitive.has(key) && value !== null && value !== undefined
        ? "[REDACTED]"
        : value,
    ]),
  );
}

function schemaTypeMatches(value: unknown, type: string): boolean {
  switch (type) {
    case "null":
      return value === null;
    case "object":
      return (
        Boolean(value) && typeof value === "object" && !Array.isArray(value)
      );
    case "array":
      return Array.isArray(value);
    case "string":
      return typeof value === "string";
    case "integer":
      return typeof value === "number" && Number.isInteger(value);
    case "number":
      return typeof value === "number" && Number.isFinite(value);
    case "boolean":
      return typeof value === "boolean";
    default:
      return true;
  }
}

function validateSchema(
  value: unknown,
  rawSchema: unknown,
  path: string,
): string | null {
  if (!rawSchema || typeof rawSchema !== "object" || Array.isArray(rawSchema)) {
    return null;
  }
  const schema = rawSchema as Record<string, unknown>;
  if (Array.isArray(schema.enum) && !schema.enum.includes(value)) {
    return `${path} must be one of ${schema.enum.map(String).join(", ")}`;
  }
  const types = Array.isArray(schema.type)
    ? schema.type.filter((type): type is string => typeof type === "string")
    : typeof schema.type === "string"
      ? [schema.type]
      : [];
  if (types.length && !types.some((type) => schemaTypeMatches(value, type))) {
    return `${path} must be ${types.join(" or ")}`;
  }
  if (value === null) return null;

  if (typeof value === "string") {
    if (
      typeof schema.minLength === "number" &&
      value.length < schema.minLength
    ) {
      return `${path} must contain at least ${schema.minLength} character(s)`;
    }
    if (
      typeof schema.maxLength === "number" &&
      value.length > schema.maxLength
    ) {
      return `${path} allows at most ${schema.maxLength} character(s)`;
    }
  } else if (typeof value === "number") {
    if (typeof schema.minimum === "number" && value < schema.minimum) {
      return `${path} must be at least ${schema.minimum}`;
    }
    if (typeof schema.maximum === "number" && value > schema.maximum) {
      return `${path} must be at most ${schema.maximum}`;
    }
  }

  if (Array.isArray(value)) {
    if (typeof schema.minItems === "number" && value.length < schema.minItems) {
      return `${path} needs at least ${schema.minItems} item(s)`;
    }
    if (typeof schema.maxItems === "number" && value.length > schema.maxItems) {
      return `${path} allows at most ${schema.maxItems} item(s)`;
    }
    for (let index = 0; index < value.length; index += 1) {
      const error = validateSchema(
        value[index],
        schema.items,
        `${path}[${index}]`,
      );
      if (error) return error;
    }
  } else if (value && typeof value === "object") {
    const record = value as Record<string, unknown>;
    const properties =
      schema.properties &&
      typeof schema.properties === "object" &&
      !Array.isArray(schema.properties)
        ? (schema.properties as Record<string, unknown>)
        : {};
    const required = Array.isArray(schema.required)
      ? schema.required.filter((key): key is string => typeof key === "string")
      : [];
    for (const key of required) {
      if (!(key in record)) return `${path}.${key} is required`;
    }
    if (schema.additionalProperties === false) {
      const extra = Object.keys(record).find((key) => !(key in properties));
      if (extra) return `${path}.${extra} is not allowed`;
    }
    for (const [key, item] of Object.entries(record)) {
      const childSchema = properties[key] ?? schema.additionalProperties;
      const error = validateSchema(item, childSchema, `${path}.${key}`);
      if (error) return error;
    }
  }
  return null;
}

export function validateToolArguments(
  name: string,
  args: Record<string, unknown>,
): string | undefined {
  const tool = TOOLS_BY_NAME.get(name);
  if (!tool) return `Error: unknown tool "${name}".`;
  const error = validateSchema(args, tool.spec.parameters, "arguments");
  return error ? `Error: invalid arguments for ${name}: ${error}.` : undefined;
}

export const AI_TOOL_SPECS: AiToolSpec[] = ALL_TOOLS.map((tool) => tool.spec);

export function normalizeEnabledToolNames(names: readonly string[]): string[] {
  const requested = new Set(names);
  return ALL_TOOLS.filter(
    (tool) =>
      !CORE_TOOL_NAMES.has(tool.spec.name) && requested.has(tool.spec.name),
  ).map((tool) => tool.spec.name);
}

export function resolveEnabledToolNames(
  names: readonly string[] | null | undefined,
): string[] {
  if (!names) {
    return ALL_TOOLS.filter((tool) => !CORE_TOOL_NAMES.has(tool.spec.name)).map(
      (tool) => tool.spec.name,
    );
  }
  return normalizeEnabledToolNames(names);
}

function enabledTools(names: readonly string[]): AiTool[] {
  const optional = new Set(normalizeEnabledToolNames(names));
  return ALL_TOOLS.filter(
    (tool) =>
      CORE_TOOL_NAMES.has(tool.spec.name) || optional.has(tool.spec.name),
  );
}

export function enabledToolSpecs(names: readonly string[]): AiToolSpec[] {
  return enabledTools(names).map((tool) => tool.spec);
}

export const TOOLS_REQUIRING_APPROVAL: ReadonlySet<string> = new Set(
  ALL_TOOLS.filter((tool) => tool.requiresApproval).map(
    (tool) => tool.spec.name,
  ),
);

export const TOOLS_ALWAYS_REQUIRING_APPROVAL: ReadonlySet<string> = new Set(
  ALL_TOOLS.filter((tool) => tool.alwaysRequireApproval).map(
    (tool) => tool.spec.name,
  ),
);

export const TOOLS_WITH_SENSITIVE_RESULTS: ReadonlySet<string> = new Set(
  ALL_TOOLS.filter((tool) => tool.sensitiveResult).map(
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
