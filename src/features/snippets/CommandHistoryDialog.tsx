import { useDeferredValue, useMemo, useState } from "react";
import { HardDrive, History, Server, Trash2 } from "lucide-react";

import {
  Button,
  ConfirmDialog,
  Dialog,
  DialogContent,
  DialogToolbar,
  EmptyState,
  ErrorState,
  Input,
  LoadingState,
  ScrollArea,
  Select,
  type ConfirmState,
} from "@/components/ui";
import { useHosts } from "@/features/hosts/api";
import { useI18n } from "@/i18n";
import { errorMessage, toast } from "@/lib/toast";
import { useClearCommandHistory, useCommandHistory } from "./api";

const ALL_HOSTS = "__all_hosts__";

export function CommandHistoryDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const { t } = useI18n();
  const [query, setQuery] = useState("");
  const [hostFilter, setHostFilter] = useState(ALL_HOSTS);
  const [confirmState, setConfirmState] = useState<ConfirmState | null>(null);
  const deferredQuery = useDeferredValue(query.trim());
  const hostId = hostFilter === ALL_HOSTS ? null : hostFilter;
  const history = useCommandHistory(hostId, deferredQuery, open);
  const clearHistory = useClearCommandHistory();
  const { data: hosts = [] } = useHosts();

  const hostOptions = useMemo(
    () => [
      { value: ALL_HOSTS, label: t("snippets.history.allHosts") },
      { value: "", label: t("snippets.history.local") },
      ...hosts.map((host) => ({ value: host.id, label: host.label })),
    ],
    [hosts, t],
  );

  const confirmClear = () => {
    setConfirmState({
      title: t("snippets.history.title"),
      description: t("snippets.history.clearConfirm"),
      cancelLabel: t("common.cancel"),
      actions: [
        {
          label: t("snippets.history.clear"),
          variant: "destructive",
          onSelect: () => {
            void clearHistory.mutateAsync().catch((error) => {
              toast.error(
                t("snippets.history.clearError"),
                errorMessage(error),
              );
            });
          },
        },
      ],
    });
  };

  const entries = history.data ?? [];

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        showClose={false}
        scrollMode="content"
        className="flex h-[min(70vh,620px)] max-w-2xl flex-col gap-0 p-0 sm:p-0"
        onInteractOutside={(event) => {
          if (confirmState) event.preventDefault();
        }}
        onEscapeKeyDown={(event) => {
          if (confirmState) event.preventDefault();
        }}
      >
        <DialogToolbar
          actions={
            <Button
              size="sm"
              variant="ghost"
              className="text-muted-foreground hover:text-danger"
              onClick={confirmClear}
              disabled={clearHistory.isPending}
            >
              <Trash2 /> {t("snippets.history.clear")}
            </Button>
          }
        >
          {t("snippets.history.title")}
        </DialogToolbar>

        <div className="flex min-h-0 flex-1 flex-col gap-4 p-5">
          <div className="flex gap-2">
            <Input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder={t("snippets.history.searchPlaceholder")}
              aria-label={t("snippets.history.searchPlaceholder")}
              maxLength={500}
              className="min-w-0 flex-1"
            />
            <Select
              value={hostFilter}
              onValueChange={setHostFilter}
              options={hostOptions}
              aria-label={t("snippets.history.hostFilter")}
              className="w-44"
            />
          </div>

          {history.isLoading ? (
            <LoadingState label={t("common.loading")} fill />
          ) : history.isError ? (
            <ErrorState
              title={t("snippets.history.loadError")}
              retryLabel={t("common.retry")}
              onRetry={() => void history.refetch()}
              fill
            />
          ) : entries.length === 0 ? (
            <EmptyState
              icon={History}
              title={t("snippets.history.empty")}
              fill
            />
          ) : (
            <ScrollArea className="min-h-0 flex-1">
              <ul className="flex flex-col divide-y divide-border overflow-hidden rounded-lg border border-border bg-surface">
                {entries.map((entry) => (
                  <li
                    key={entry.id}
                    className="flex items-start gap-3 px-3 py-2.5"
                  >
                    {entry.hostId ? (
                      <Server className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
                    ) : (
                      <HardDrive className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
                    )}
                    <div className="min-w-0 flex-1">
                      <pre className="whitespace-pre-wrap break-all font-mono text-xs text-foreground">
                        {entry.command}
                      </pre>
                      <p className="mt-1 truncate text-2xs text-muted-foreground">
                        {entry.hostId
                          ? (entry.hostLabel ?? entry.hostId)
                          : t("snippets.history.local")}
                        {" · "}
                        {new Date(entry.usedAt).toLocaleString()}
                        {" · "}
                        {t("snippets.history.useCount", {
                          count: entry.useCount,
                        })}
                      </p>
                    </div>
                  </li>
                ))}
              </ul>
            </ScrollArea>
          )}
        </div>
      </DialogContent>
      <ConfirmDialog
        state={confirmState}
        onClose={() => setConfirmState(null)}
      />
    </Dialog>
  );
}
