import { useState } from "react";
import {
  Check,
  ChevronDown,
  ChevronRight,
  Loader2,
  Server,
  ShieldAlert,
  Terminal as TerminalIcon,
  X,
} from "lucide-react";

import { Button } from "@/components/ui/button";
import { useI18n } from "@/i18n";
import { cn } from "@/lib/utils";
import type { AgentLogItem, ToolStatus } from "./transcript";
import {
  askUserOptions,
  askUserQuestion,
  selectionResult,
  TOOL_CONFIRM_KEYS,
  TOOL_ICONS,
  TOOL_LABEL_KEYS,
  TOOLS_REQUIRING_APPROVAL,
} from "./tools";
import { terminalTabs, useTabsStore } from "@/workbench/tabs";

type ToolLogItem = Extract<AgentLogItem, { kind: "tool" }>;

const HIDDEN_APPROVAL_KEYS = new Set(["password", "passphrase", "privateKey"]);

function approvalValue(key: string, value: unknown): unknown {
  if (HIDDEN_APPROVAL_KEYS.has(key)) {
    return value === null || value === undefined ? value : "[provided]";
  }
  if (key === "content" && typeof value === "string") {
    return `[${value.length} characters]`;
  }
  if (Array.isArray(value)) return value.map((item) => approvalValue("", item));
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>).map(
        ([nestedKey, item]) => [nestedKey, approvalValue(nestedKey, item)],
      ),
    );
  }
  return value;
}

function approvalSummary(args: Record<string, unknown>): string | undefined {
  const summary = Object.fromEntries(
    Object.entries(args)
      .filter(([key]) => key !== "command" && key !== "sessionId")
      .map(([key, value]) => [key, approvalValue(key, value)]),
  );
  return Object.keys(summary).length
    ? JSON.stringify(summary, null, 2)
    : undefined;
}

function transferEndpointLabel(value: unknown): string | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) return;
  const endpoint = value as Record<string, unknown>;
  if (
    (endpoint.kind !== "local" && endpoint.kind !== "sftp") ||
    typeof endpoint.path !== "string"
  ) {
    return;
  }
  const host =
    endpoint.kind === "sftp" && typeof endpoint.hostId === "string"
      ? `${endpoint.hostId}:`
      : "";
  return `${endpoint.kind}:${host}${endpoint.path}`;
}

export function ToolActivity({
  item,
  onApprove,
  onDeny,
}: {
  item: ToolLogItem;
  onApprove: (id: string) => void;
  onDeny: (id: string) => void;
}) {
  const { t } = useI18n();
  const [expanded, setExpanded] = useState(item.status === "awaiting-approval");
  const Icon = TOOL_ICONS[item.name] ?? TerminalIcon;
  const labelKey = TOOL_LABEL_KEYS[item.name];
  const label = labelKey ? t(labelKey) : item.name;
  const command =
    typeof item.args.command === "string" ? item.args.command : undefined;
  const path =
    typeof item.args.path === "string"
      ? item.args.path
      : typeof item.args.from === "string"
        ? item.args.from
        : undefined;
  const transferSource = transferEndpointLabel(item.args.source);
  const transferDestination = transferEndpointLabel(item.args.destination);
  const transfer =
    transferSource && transferDestination
      ? `${transferSource}  →  ${transferDestination}`
      : undefined;
  const details = TOOLS_REQUIRING_APPROVAL.has(item.name)
    ? approvalSummary(item.args)
    : undefined;
  const targetSessionId =
    typeof item.args.sessionId === "string" ? item.args.sessionId : undefined;
  const targetTitle = useTabsStore((state) =>
    targetSessionId
      ? terminalTabs(state.tabs).find((tab) => tab.id === targetSessionId)
          ?.title
      : undefined,
  );

  return (
    <div className="overflow-hidden rounded-lg border border-border bg-card/55 text-xs">
      <button
        type="button"
        onClick={() => setExpanded((e) => !e)}
        className="flex w-full items-center gap-2 px-2.5 py-1.5 text-left hover:bg-accent"
      >
        <Icon className="size-3.5 shrink-0 text-muted-foreground" />
        <span className="min-w-0 flex-1 truncate text-muted-foreground">
          {label}
        </span>
        <StatusIcon status={item.status} />
        {expanded ? (
          <ChevronDown className="size-3.5 shrink-0 text-muted-foreground" />
        ) : (
          <ChevronRight className="size-3.5 shrink-0 text-muted-foreground" />
        )}
      </button>

      {expanded && (
        <div className="space-y-1.5 border-t border-border px-2.5 py-1.5">
          {command && (
            <>
              {targetSessionId && (
                <div className="flex items-center gap-1 text-muted-foreground">
                  <Server className="size-3.5 shrink-0" />
                  <span>
                    {t("ai.commandTarget", {
                      name: targetTitle ?? targetSessionId,
                    })}
                  </span>
                </div>
              )}
              <pre className="select-text overflow-x-auto overflow-y-hidden rounded bg-terminal-background p-1.5 font-mono text-[0.7rem] text-terminal-foreground">
                {command}
              </pre>
            </>
          )}
          {!command && transfer && (
            <pre className="select-text overflow-x-auto overflow-y-hidden rounded bg-terminal-background p-1.5 font-mono text-[0.7rem] text-terminal-foreground">
              {transfer}
            </pre>
          )}
          {!command && !transfer && path && (
            <pre className="select-text overflow-x-auto overflow-y-hidden rounded bg-terminal-background p-1.5 font-mono text-[0.7rem] text-terminal-foreground">
              {path}
            </pre>
          )}
          {details && (
            <pre className="max-h-48 select-text overflow-auto whitespace-pre-wrap rounded bg-muted/60 p-1.5 font-mono text-[0.7rem] text-muted-foreground">
              {details}
            </pre>
          )}
          {item.status === "awaiting-approval" && (
            <div className="flex items-center gap-2 pt-1">
              <span className="mr-auto flex min-w-0 items-center gap-1 text-warning">
                <ShieldAlert className="size-3.5 shrink-0" />
                <span className="truncate">
                  {t(TOOL_CONFIRM_KEYS[item.name] ?? "ai.confirmAction")}
                </span>
              </span>
              <Button
                size="sm"
                variant="outline"
                className="h-6 shrink-0 px-2"
                onClick={() => onDeny(item.id)}
              >
                {t("ai.deny")}
              </Button>
              <Button
                size="sm"
                className="h-6 shrink-0 px-2"
                onClick={() => onApprove(item.id)}
              >
                {t("ai.approve")}
              </Button>
            </div>
          )}
          {item.result && (
            <pre className="max-h-48 select-text overflow-auto whitespace-pre-wrap font-mono text-[0.7rem] text-muted-foreground">
              {item.result}
            </pre>
          )}
        </div>
      )}
    </div>
  );
}

export function QuestionPrompt({
  item,
  onAnswer,
}: {
  item: ToolLogItem;
  onAnswer: (id: string, option: string) => void;
}) {
  const question = askUserQuestion(item.args);
  const options = askUserOptions(item.args);
  const awaiting = item.status === "awaiting-input";
  const selected = options.find((o) => item.result === selectionResult(o));

  return (
    <div className="space-y-1.5 rounded-lg border border-border bg-card/55 p-2.5">
      <p className="select-text whitespace-pre-wrap break-words text-sm text-foreground/90">
        {question}
      </p>
      <div className="flex flex-col gap-1.5">
        {options.map((option) => (
          <button
            key={option}
            type="button"
            disabled={!awaiting}
            onClick={() => onAnswer(item.id, option)}
            className={cn(
              "flex items-center gap-2 rounded-md border px-3 py-1.5 text-left text-xs transition-colors",
              awaiting
                ? "border-input text-foreground hover:border-ring hover:bg-accent"
                : option === selected
                  ? "border-primary/50 bg-accent/60 text-foreground"
                  : "border-input text-muted-foreground opacity-60",
            )}
          >
            <span className="min-w-0 flex-1 break-words">{option}</span>
            {option === selected && (
              <Check className="size-3.5 shrink-0 text-success" />
            )}
          </button>
        ))}
      </div>
    </div>
  );
}

function StatusIcon({ status }: { status: ToolStatus }) {
  switch (status) {
    case "running":
      return <Loader2 className="size-3.5 shrink-0 animate-spin text-link" />;
    case "done":
      return <Check className="size-3.5 shrink-0 text-success" />;
    case "denied":
      return <X className="size-3.5 shrink-0 text-muted-foreground" />;
    case "error":
      return <X className="size-3.5 shrink-0 text-danger" />;
    case "awaiting-approval":
      return <ShieldAlert className="size-3.5 shrink-0 text-warning" />;
    default:
      return null;
  }
}
