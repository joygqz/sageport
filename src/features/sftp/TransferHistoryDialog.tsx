import { useState } from "react";
import { History, HardDrive, Server, Trash2 } from "lucide-react";

import {
  Badge,
  Button,
  ConfirmDialog,
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  EmptyState,
  ScrollArea,
  Spinner,
  Tooltip,
  type ConfirmState,
} from "@/components/ui";
import { useI18n } from "@/i18n";
import { errorMessage, toast } from "@/lib/toast";
import { formatBytes } from "@/lib/utils";
import type { TransferStatus } from "@/types/models";
import {
  useClearTransferHistory,
  useDeleteTransferHistory,
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
  const { data: entries, isLoading, isError } = useTransferHistory(open);
  const deleteOne = useDeleteTransferHistory();
  const clearAll = useClearTransferHistory();
  const [confirmState, setConfirmState] = useState<ConfirmState | null>(null);

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
      toast.error(t("sftp.history.clearError"), errorMessage(err));
    }
  };

  const confirmClear = () => {
    setConfirmState({
      title: t("sftp.history.title"),
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
        className="flex max-h-[70vh] max-w-2xl flex-col gap-4"

        onInteractOutside={(e) => {
          if (confirmState) e.preventDefault();
        }}
        onEscapeKeyDown={(e) => {
          if (confirmState) e.preventDefault();
        }}
      >
        <DialogHeader className="flex-row items-center justify-between gap-2 space-y-0">
          <DialogTitle>{t("sftp.history.title")}</DialogTitle>
          {!!entries?.length && (
            <Button
              size="sm"
              variant="ghost"
              className="mr-6 text-muted-foreground hover:text-danger"
              onClick={confirmClear}
            >
              <Trash2 /> {t("sftp.history.clear")}
            </Button>
          )}
        </DialogHeader>

        {isLoading && (
          <div className="flex items-center gap-2 py-6 text-sm text-muted-foreground">
            <Spinner /> …
          </div>
        )}

        {isError && (
          <p className="text-sm text-danger">{t("sftp.history.loadError")}</p>
        )}

        {!isLoading && !isError && entries?.length === 0 && (
          <EmptyState icon={History} title={t("sftp.history.empty")} />
        )}

        {!isLoading && !!entries?.length && (
          <ScrollArea className="min-h-0 flex-1">
            <ul className="flex flex-col divide-y divide-border overflow-hidden rounded-lg border border-border bg-card/35">
              {entries.map((e) => (
                <li
                  key={e.id}
                  className="group flex items-center gap-3 px-3 py-2.5"
                >
                  <div className="flex min-w-0 flex-1 flex-col gap-1">
                    <div className="flex items-center gap-2">
                      <span
                        className="truncate text-sm font-medium text-foreground"
                        title={e.sourceLabel}
                      >
                        {e.sourceLabel}
                      </span>
                      <Badge variant={statusVariant[e.status]}>
                        {t(`sftp.history.status.${e.status}`)}
                      </Badge>
                    </div>
                    <div className="flex items-center gap-1 truncate text-xs text-muted-foreground">
                      {e.sourceConnectionId ? (
                        <Server className="size-3 shrink-0" />
                      ) : (
                        <HardDrive className="size-3 shrink-0" />
                      )}
                      <span className="truncate" title={e.sourcePath}>
                        {e.sourcePath}
                      </span>
                      <span className="shrink-0">→</span>
                      {e.destConnectionId ? (
                        <Server className="size-3 shrink-0" />
                      ) : (
                        <HardDrive className="size-3 shrink-0" />
                      )}
                      <span className="truncate" title={e.destPath}>
                        {e.destPath}
                      </span>
                    </div>
                    <span className="font-mono text-xs text-muted-foreground">
                      {formatBytes(e.transferredBytes)}
                      {e.totalBytes > 0 && ` / ${formatBytes(e.totalBytes)}`}
                      {" · "}
                      {new Date(e.startedAt).toLocaleString()}
                      {e.message && ` · ${e.message}`}
                    </span>
                  </div>
                  <Tooltip content={t("common.delete")}>
                    <Button
                      size="icon"
                      variant="ghost"
                      className="size-6 shrink-0 opacity-0 group-hover:opacity-100"
                      onClick={() => void onDeleteOne(e.id)}
                    >
                      <Trash2 className="size-3.5" />
                    </Button>
                  </Tooltip>
                </li>
              ))}
            </ul>
          </ScrollArea>
        )}
      </DialogContent>
      <ConfirmDialog
        state={confirmState}
        onClose={() => setConfirmState(null)}
      />
    </Dialog>
  );
}
