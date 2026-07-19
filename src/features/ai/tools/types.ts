import type { LucideIcon } from "lucide-react";

import type { TKey } from "@/i18n";
import type { AiToolSpec } from "@/types/models";

export interface ToolExecutionResult {
  content: string;
  isError: boolean;
}

export interface ToolExecutionContext {
  isCancelled?: () => boolean;
}

export interface PreparedCall {
  args: Record<string, unknown>;
  preflightError?: string;
  automaticResult?: string;
}

export type ToolExecute = (
  args: Record<string, unknown>,
  ctx: ToolExecutionContext,
) => Promise<ToolExecutionResult>;

export type ToolPrepare = (
  args: Record<string, unknown>,
  meta: { userPrompt: string },
) => PreparedCall | Promise<PreparedCall>;

export interface AiTool {
  spec: AiToolSpec;
  icon: LucideIcon;
  labelKey: TKey;
  requiresApproval?: boolean;
  alwaysRequireApproval?: boolean;
  sensitiveResult?: boolean;
  confirmKey?: TKey;
  execute?: ToolExecute;
  prepare?: ToolPrepare;
}

export function toolSuccess(content: string): ToolExecutionResult {
  return { content, isError: false };
}

export function toolFailure(content: string): ToolExecutionResult {
  return { content, isError: true };
}

export function normalizeArgs(raw: unknown): Record<string, unknown> {
  return raw && typeof raw === "object" && !Array.isArray(raw)
    ? (raw as Record<string, unknown>)
    : {};
}

export function str(args: Record<string, unknown>, key: string): string {
  const value = args[key];
  return typeof value === "string" ? value : "";
}

export function optionalStr(
  args: Record<string, unknown>,
  key: string,
): string | undefined {
  const value = args[key];
  return typeof value === "string" && value.trim() ? value : undefined;
}

export function nullableStr(
  args: Record<string, unknown>,
  key: string,
): string | null | undefined {
  if (!(key in args)) return undefined;
  const value = args[key];
  if (value === null) return null;
  if (typeof value !== "string") return undefined;
  return value.trim() ? value : null;
}

export function num(
  args: Record<string, unknown>,
  key: string,
): number | undefined {
  const value = args[key];
  return typeof value === "number" && Number.isFinite(value)
    ? value
    : undefined;
}

export function nullableNum(
  args: Record<string, unknown>,
  key: string,
): number | null | undefined {
  if (!(key in args)) return undefined;
  if (args[key] === null) return null;
  return num(args, key);
}

export function bool(args: Record<string, unknown>, key: string): boolean {
  return args[key] === true;
}

export function strArray(args: Record<string, unknown>, key: string): string[] {
  const value = args[key];
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is string => typeof item === "string");
}

export function record(
  args: Record<string, unknown>,
  key: string,
): Record<string, string> {
  const value = args[key];
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
    if (typeof v === "string") out[k] = v;
    else if (typeof v === "number" || typeof v === "boolean")
      out[k] = String(v);
  }
  return out;
}
