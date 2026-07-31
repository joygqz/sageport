import { useState } from "react";
import {
  ArrowRightLeft,
  ArrowUpDown,
  Clock,
  HardDrive,
  History,
  RotateCcw,
  Server,
  Trash2,
} from "lucide-react";

import {
  Badge,
  Button,
  ConfirmDialog,
  Dialog,
  DialogContent,
  DialogToolbar,
  EmptyState,
  ErrorState,
  LoadingState,
  MetaItem,
  ScrollArea,
  Tooltip,
  type ConfirmState,
} from "@/components/ui";
import { useI18n } from "@/i18n";
import { errorDescription, errorMessage, toast } from "@/lib/toast";
import { formatBytes } from "@/lib/utils";
import type { TransferStatus } from "@/types/models";
import {
  useClearTransferHistory,
  useDeleteTransferHistory,
  useRetryTransfer,
  useTransferHistory,
} from "./api";

const statusVariant: Record<
  TransferStatus,
  "primary" | "success" | "destructive" | "default"
> = {
  active: "primary",
  done: "success",
  error: "destructive",
  cancelled: "default",
};

export function TransferHistoryDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const { t } = useI18n();
  const { data, isLoading, isError, refetch } = useTransferHistory(open);
  const deleteOne = useDeleteTransferHistory();
  const clearAll = useClearTransferHistory();
  const retryTransfer = useRetryTransfer();
  const [confirmState, setConfirmState] = useState<ConfirmState | null>(null);
  const entries = data ?? [];

  const onClear = async () => {
    try {
      await clearAll.mutateAsync();
    } catch (err) {
      toast.error(t("sftp.history.clearError"), errorMessage(err));
    }
  };

  const onDeleteOne = async (id: string) => {
    try {
      await deleteOne.mutateAsync(id);
    } catch (err) {
      toast.error(t("sftp.history.deleteError"), errorDescription(err));
    }
  };

  const onRetry = async (entry: (typeof entries)[number]) => {
    try {
      await retryTransfer.mutateAsync(entry);
    } catch (err) {
      toast.error(t("sftp.history.retryError"), errorMessage(err));
    }
  };

  const confirmClear = () => {
    setConfirmState({
      title: t("sftp.history.clearTitle"),
      description: t("sftp.history.clearConfirm"),
      cancelLabel: t("common.cancel"),
      actions: [
        {
          label: t("sftp.history.clear"),
          variant: "destructive",
          onSelect: () => void onClear(),
        },
      ],
    });
  };

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
            entries.length > 0 && (
              <Button
                size="sm"
                variant="ghost"
                className="h-[var(--toolbar-control-size)] text-muted-foreground hover:text-danger"
                onClick={confirmClear}
                disabled={clearAll.isPending}
              >
                <Trash2 /> {t("sftp.history.clear")}
              </Button>
            )
          }
        >
          {t("sftp.history.title")}
        </DialogToolbar>

        <div className="ui-dialog-body">
          {isLoading ? (
            <LoadingState label={t("common.loading")} fill />
          ) : isError ? (
            <ErrorState
              title={t("sftp.history.loadError")}
              retryLabel={t("common.retry")}
              onRetry={() => void refetch()}
              fill
            />
          ) : entries.length === 0 ? (
            <EmptyState icon={History} title={t("sftp.history.empty")} fill />
          ) : (
            <ScrollArea className="min-h-0 flex-1">
              <ul className="ui-divided-list flex flex-col">
                {entries.map((entry) => (
                  <li
                    key={entry.id}
                    className="ui-list-row group flex items-start"
                  >
                    <ArrowRightLeft className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
                    <div className="flex min-w-0 flex-1 flex-col gap-1">
                      <div className="flex items-center gap-2">
                        <span
                          className="truncate text-sm font-medium text-foreground"
                          title={entry.sourceLabel}
                        >
                          {entry.sourceLabel}
                        </span>
                        <Badge variant={statusVariant[entry.status]}>
                          {t(`sftp.history.status.${entry.status}`)}
                        </Badge>
                      </div>
                      <div className="flex items-center gap-1 truncate text-xs text-muted-foreground">
                        {entry.sourceConnectionId ? (
                          <Server className="size-3 shrink-0" />
                        ) : (
                          <HardDrive className="size-3 shrink-0" />
                        )}
                        {entry.sourceHostLabel && (
                          <span
                            className="shrink-0 text-foreground"
                            title={entry.sourceHostLabel}
                          >
                            {entry.sourceHostLabel}:
                          </span>
                        )}
                        <span className="truncate" title={entry.sourcePath}>
                          {entry.sourcePath}
                        </span>
                        <span className="shrink-0">→</span>
                        {entry.destConnectionId ? (
                          <Server className="size-3 shrink-0" />
                        ) : (
                          <HardDrive className="size-3 shrink-0" />
                        )}
                        {entry.destHostLabel && (
                          <span
                            className="shrink-0 text-foreground"
                            title={entry.destHostLabel}
                          >
                            {entry.destHostLabel}:
                          </span>
                        )}
                        <span className="truncate" title={entry.destPath}>
                          {entry.destPath}
                        </span>
                      </div>
                      <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-2xs text-muted-foreground">
                        <MetaItem icon={ArrowUpDown}>
                          {formatBytes(entry.transferredBytes)}
                          {entry.totalBytes > 0 &&
                            ` / ${formatBytes(entry.totalBytes)}`}
                        </MetaItem>
                        <MetaItem icon={Clock}>
                          {new Date(entry.startedAt).toLocaleString()}
                        </MetaItem>
                      </div>
                      {entry.message && (
                        <span className="text-2xs text-danger">
                          {entry.message}
                        </span>
                      )}
                    </div>
                    {(entry.status === "error" ||
                      entry.status === "cancelled") && (
                      <Tooltip content={t("sftp.history.retry")}>
                        <Button
                          size="icon"
                          variant="ghost"
                          className="h-6 w-6 shrink-0"
                          loading={
                            retryTransfer.isPending &&
                            retryTransfer.variables?.id === entry.id
                          }
                          onClick={() => void onRetry(entry)}
                        >
                          <RotateCcw className="size-3.5" />
                        </Button>
                      </Tooltip>
                    )}
                    <Tooltip content={t("sftp.history.delete")}>
                      <Button
                        size="icon"
                        variant="ghost"
                        className="history-row-action pointer-events-none -ml-3 h-6 w-0 shrink-0 overflow-hidden opacity-0 transition-opacity group-hover:pointer-events-auto group-hover:ml-0 group-hover:w-6 group-hover:opacity-100 group-focus-within:pointer-events-auto group-focus-within:ml-0 group-focus-within:w-6 group-focus-within:opacity-100"
                        onClick={() => void onDeleteOne(entry.id)}
                      >
                        <Trash2 className="size-3.5" />
                      </Button>
                    </Tooltip>
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
