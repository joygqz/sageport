import { useEffect, useRef, useState } from "react";
import {
  CheckCircle2,
  ChevronRight,
  Clock3,
  Loader2,
  XCircle,
} from "lucide-react";

import {
  Button,
  CONTROL_CONTAINER_CLASS,
  ErrorState,
  Field,
  FormDialog,
  INTERACTIVE_FOCUS_CLASS,
  LoadingState,
  ScrollArea,
  Switch,
  Textarea,
} from "@/components/ui";
import { useI18n } from "@/i18n";
import { ipc } from "@/lib/ipc";
import { cn } from "@/lib/utils";
import { errorMessage, toast } from "@/lib/toast";
import type { BatchExecEvent, BatchExecStatus } from "@/types/models";
import { useHosts } from "@/features/hosts/api";

interface Result {
  status: BatchExecStatus;
  output?: string;
  exitCode?: number;
  message?: string;
}

const MAX_BATCH_HOSTS = 100;

export function BatchRunDialog({
  open,
  initialCommand,
  onClose,
}: {
  open: boolean;
  initialCommand: string;
  onClose: () => void;
}) {
  const { t } = useI18n();
  return (
    <FormDialog
      open={open}
      onClose={onClose}
      width="w-[620px]"
      title={t("snippets.batch.title")}
    >
      {open && <BatchBody initialCommand={initialCommand} onClose={onClose} />}
    </FormDialog>
  );
}

function BatchBody({
  initialCommand,
  onClose,
}: {
  initialCommand: string;
  onClose: () => void;
}) {
  const { t } = useI18n();
  const {
    data: hosts = [],
    isLoading: hostsLoading,
    isError: hostsError,
    refetch: refetchHosts,
  } = useHosts();
  const [command, setCommand] = useState(initialCommand);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [results, setResults] = useState<Record<string, Result>>({});
  const [running, setRunning] = useState(false);
  const requestRef = useRef<string | null>(null);

  useEffect(
    () => () => {
      const requestId = requestRef.current;
      requestRef.current = null;
      if (requestId) void ipc.hosts.cancelRun(requestId).catch(() => {});
    },
    [],
  );

  const toggle = (id: string) => {
    if (!selected.has(id) && selected.size >= MAX_BATCH_HOSTS) {
      toast.warning(t("snippets.batch.hostLimit", { count: MAX_BATCH_HOSTS }));
      return;
    }
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const run = async () => {
    if (!command.trim() || selected.size === 0 || requestRef.current) return;
    const requestId = crypto.randomUUID();
    requestRef.current = requestId;
    setRunning(true);
    const hostIds = [...selected];
    setResults(
      Object.fromEntries(
        hostIds.map((hostId) => [hostId, { status: "queued" as const }]),
      ),
    );
    try {
      await ipc.hosts.runCommand(
        hostIds,
        command.trim(),
        (e: BatchExecEvent) => {
          if (requestRef.current !== requestId) return;
          setResults((prev) => ({
            ...prev,
            [e.hostId]: {
              status: e.status,
              output: e.output,
              exitCode: e.exitCode,
              message: e.message,
            },
          }));
        },
        requestId,
      );
    } catch (err) {
      if (requestRef.current === requestId) {
        toast.error(t("snippets.batch.error"), errorMessage(err));
      }
    } finally {
      if (requestRef.current === requestId) {
        requestRef.current = null;
        setRunning(false);
      }
    }
  };

  const hostName = (id: string) => hosts.find((h) => h.id === id)?.label ?? id;
  const resultEntries = Object.entries(results);

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto p-5">
      <Field label={t("snippets.batch.command")}>
        <Textarea
          rows={2}
          value={command}
          onChange={(e) => setCommand(e.target.value)}
          className="font-mono text-xs"
          disabled={running}
          maxLength={32 * 1024}
        />
      </Field>

      <Field label={t("snippets.batch.hosts")}>
        <ScrollArea className={cn(CONTROL_CONTAINER_CLASS, "max-h-40")}>
          {hostsLoading ? (
            <LoadingState label={t("common.loading")} />
          ) : hostsError ? (
            <ErrorState
              title={t("common.loadError")}
              retryLabel={t("common.retry")}
              onRetry={() => void refetchHosts()}
            />
          ) : hosts.length === 0 ? (
            <p className="p-3 text-xs text-muted-foreground">
              {t("snippets.batch.noHosts")}
            </p>
          ) : (
            hosts.map((host) => (
              <label
                key={host.id}
                className="flex cursor-pointer items-center justify-between gap-2 px-3 py-1.5 text-sm hover:bg-list-hover"
              >
                <span className="truncate">{host.label}</span>
                <Switch
                  checked={selected.has(host.id)}
                  onCheckedChange={() => toggle(host.id)}
                  disabled={running}
                />
              </label>
            ))
          )}
        </ScrollArea>
      </Field>

      {resultEntries.length > 0 && (
        <div className="flex flex-col gap-1.5">
          {resultEntries.map(([hostId, result]) => (
            <ResultRow key={hostId} name={hostName(hostId)} result={result} />
          ))}
        </div>
      )}

      <div className="mt-auto flex justify-end gap-2 pt-2">
        <Button variant="ghost" onClick={onClose}>
          {t("common.cancel")}
        </Button>
        <Button
          onClick={run}
          loading={running}
          disabled={!command.trim() || selected.size === 0}
        >
          {t("snippets.batch.run", { count: String(selected.size) })}
        </Button>
      </div>
    </div>
  );
}

function ResultRow({ name, result }: { name: string; result: Result }) {
  const [open, setOpen] = useState(false);
  const body = result.output ?? result.message ?? "";

  return (
    <div className="overflow-hidden rounded-lg border border-border bg-surface">
      <button
        type="button"
        onClick={() => body && setOpen((o) => !o)}
        aria-expanded={body ? open : undefined}
        className={cn(
          INTERACTIVE_FOCUS_CLASS,
          "flex w-full items-center gap-2 px-3 py-1.5 text-left text-sm transition-colors",
          body ? "hover:bg-list-hover" : "cursor-default",
        )}
      >
        {result.status === "queued" ? (
          <Clock3 className="size-3.5 shrink-0 text-muted-foreground" />
        ) : result.status === "running" ? (
          <Loader2 className="size-3.5 shrink-0 animate-spin text-warning" />
        ) : result.status === "error" || (result.exitCode ?? 0) !== 0 ? (
          <XCircle className="size-3.5 shrink-0 text-danger" />
        ) : (
          <CheckCircle2 className="size-3.5 shrink-0 text-success" />
        )}
        <span className="min-w-0 flex-1 truncate">{name}</span>
        {result.exitCode !== undefined && result.exitCode !== 0 && (
          <span className="shrink-0 font-mono text-2xs text-danger">
            exit {result.exitCode}
          </span>
        )}
        {body && (
          <ChevronRight
            className={cn(
              "size-3.5 shrink-0 text-muted-foreground transition-transform",
              open && "rotate-90",
            )}
          />
        )}
      </button>
      {open && body && (
        <pre className="max-h-48 overflow-auto border-t border-border bg-surface px-3 py-2 font-mono text-2xs">
          {body}
        </pre>
      )}
    </div>
  );
}
