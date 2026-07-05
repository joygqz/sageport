import { useState } from "react";
import {
  Check,
  ChevronDown,
  ChevronRight,
  Eye,
  ListTree,
  Loader2,
  ShieldAlert,
  Terminal as TerminalIcon,
  X,
} from "lucide-react";

import { Button } from "@/components/ui/button";
import { useI18n, type TKey } from "@/i18n";
import type { AgentLogItem, ToolStatus } from "./store";

type ToolLogItem = Extract<AgentLogItem, { kind: "tool" }>;

const TOOL_ICON: Record<string, typeof TerminalIcon> = {
  list_terminal_sessions: ListTree,
  read_terminal_output: Eye,
  run_terminal_command: TerminalIcon,
};

const TOOL_LABEL_KEY: Record<string, TKey> = {
  list_terminal_sessions: "ai.tool.listTerminalSessions",
  read_terminal_output: "ai.tool.readTerminalOutput",
  run_terminal_command: "ai.tool.runTerminalCommand",
};

/** One collapsible card showing a single tool call the agent made. */
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
  const Icon = TOOL_ICON[item.name] ?? TerminalIcon;
  const labelKey = TOOL_LABEL_KEY[item.name];
  const label = labelKey ? t(labelKey) : item.name;
  const command =
    typeof item.args.command === "string" ? item.args.command : undefined;

  return (
    <div className="overflow-hidden rounded-md border border-input bg-surface text-xs">
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
            <pre className="select-text overflow-x-auto overflow-y-hidden rounded bg-terminal-background p-1.5 font-mono text-[0.7rem] text-terminal-foreground">
              {command}
            </pre>
          )}
          {item.status === "awaiting-approval" && (
            <div className="flex items-center gap-2 pt-1">
              <span className="mr-auto flex min-w-0 items-center gap-1 text-warning">
                <ShieldAlert className="size-3.5 shrink-0" />
                <span className="truncate">{t("ai.confirmRun")}</span>
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

function StatusIcon({ status }: { status: ToolStatus }) {
  switch (status) {
    case "running":
      return (
        <Loader2 className="size-3.5 shrink-0 animate-spin text-primary" />
      );
    case "done":
      return <Check className="size-3.5 shrink-0 text-success" />;
    case "denied":
      return <X className="size-3.5 shrink-0 text-muted-foreground" />;
    case "error":
      return <X className="size-3.5 shrink-0 text-destructive" />;
    case "awaiting-approval":
      return <ShieldAlert className="size-3.5 shrink-0 text-warning" />;
    default:
      return null;
  }
}
