import { useState } from "react";
import { open, save } from "@tauri-apps/plugin-dialog";
import { History, RefreshCw, RotateCcw } from "lucide-react";

import {
  Badge,
  Button,
  ConfirmDialog,
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  EmptyState,
  PasswordInput,
  Separator,
  Spinner,
  Tooltip,
  type ConfirmState,
} from "@/components/ui";
import { useI18n } from "@/i18n";
import { errorCode, errorMessage, toast } from "@/lib/toast";
import type { SyncStatus, SyncVersion } from "@/types/models";
import {
  useSyncDisconnect,
  useSyncFileExport,
  useSyncFileImport,
  useSyncPush,
  useSyncRestoreVersion,
  useSyncStatus,
  useSyncVersions,
} from "./api";
import { providerMeta } from "./providers";
import { SetupView } from "./SetupView";

export function SyncSection() {
  const { data: status } = useSyncStatus();

  if (!status) return null;

  return (
    <div className="flex flex-col gap-6">
      {status.provider ? (
        <>
          <ConnectedCard status={status} />
          <Separator />
          <VersionsCard />
        </>
      ) : (
        <SetupView status={status} />
      )}
      <Separator />
      <FileBackupCard />
    </div>
  );
}

function ConnectedCard({ status }: { status: SyncStatus }) {
  const { t } = useI18n();
  const push = useSyncPush();
  const disconnect = useSyncDisconnect();
  const [confirmDisconnect, setConfirmDisconnect] = useState(false);

  const meta = providerMeta(status.provider!);
  const Icon = meta.icon;

  const doPush = async () => {
    try {
      const outcome = await push.mutateAsync();
      if (outcome.status === "unchanged") {
        toast.info(
          t("settings.sync.connected.unchangedTitle"),
          t("settings.sync.connected.unchangedDescription"),
        );
      } else {
        toast.success(t("settings.sync.connected.pushedTitle"));
      }
    } catch (err) {
      const code = errorCode(err);
      toast.error(
        t("settings.sync.connected.pushFailed"),
        code === "crypto"
          ? t("settings.sync.connected.pushWrongPassphrase")
          : code === "serde"
            ? t("settings.sync.corruptRemoteBackup")
            : errorMessage(err),
      );
    }
  };

  const doDisconnect = async () => {
    try {
      await disconnect.mutateAsync();
    } catch (err) {
      toast.error(
        t("settings.sync.connected.disconnectError"),
        errorMessage(err),
      );
    }
  };

  const disconnectConfirmState: ConfirmState | null = confirmDisconnect
    ? {
        title: t("settings.sync.connected.disconnectConfirmTitle"),
        description: t("settings.sync.connected.disconnectConfirmDescription"),
        cancelLabel: t("common.cancel"),
        actions: [
          {
            label: t("settings.sync.connected.disconnectConfirmButton"),
            variant: "destructive",
            onSelect: () => void doDisconnect(),
          },
        ],
      }
    : null;

  return (
    <div className="flex flex-col gap-4">
      <div>
        <h3 className="text-sm font-medium text-foreground">
          {t("settings.sync.title")}
        </h3>
        <p className="mt-1 text-sm text-muted-foreground">
          {t("settings.sync.connected.hint")}
        </p>
      </div>

      <div className="flex flex-wrap items-center gap-3 rounded-lg border border-input bg-surface px-4 py-3">
        <Icon className="size-6 shrink-0 text-foreground" />
        <div className="flex min-w-0 flex-1 basis-64 flex-col">
          <span className="text-sm font-medium text-foreground">
            {meta.name}
            {status.account && (
              <span className="ml-2 font-normal text-muted-foreground">
                {status.account}
              </span>
            )}
          </span>
          <span className="truncate text-xs text-muted-foreground">
            {status.detail ? `${status.detail} · ` : ""}
            {t("settings.sync.connected.lastSyncedLabel")}{" "}
            {status.lastSyncedAt
              ? new Date(status.lastSyncedAt).toLocaleString()
              : t("settings.sync.connected.neverSynced")}
          </span>
        </div>
        <Badge variant="primary">{t("settings.sync.connected.badge")}</Badge>
      </div>

      <div className="flex flex-wrap gap-2">
        <Button variant="secondary" onClick={doPush} loading={push.isPending}>
          {t("settings.sync.connected.pushButton")}
        </Button>
        <Button
          variant="ghost"
          onClick={() => setConfirmDisconnect(true)}
          loading={disconnect.isPending}
        >
          {t("settings.sync.connected.disconnectButton")}
        </Button>
      </div>

      <ConfirmDialog
        state={disconnectConfirmState}
        onClose={() => setConfirmDisconnect(false)}
      />
    </div>
  );
}

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function VersionsCard() {
  const { t } = useI18n();
  const {
    data: versions,
    isLoading,
    isFetching,
    isError,
    refetch,
  } = useSyncVersions(true);
  const [target, setTarget] = useState<SyncVersion | null>(null);
  const [manualRefreshing, setManualRefreshing] = useState(false);
  const showLoading = isLoading || manualRefreshing;
  const visibleVersions = manualRefreshing ? undefined : versions;

  const doRefresh = async () => {
    setManualRefreshing(true);
    try {
      await refetch();
    } finally {
      setManualRefreshing(false);
    }
  };

  return (
    <div className="flex flex-col gap-4">
      <div>
        <div className="flex items-center gap-1.5">
          <h3 className="text-sm font-medium text-foreground">
            {t("settings.sync.versions.title")}
          </h3>
          <Tooltip content={t("settings.sync.versions.refreshButton")}>
            <Button
              size="icon"
              variant="ghost"
              className="size-6"
              onClick={() => void doRefresh()}
              disabled={isFetching || manualRefreshing}
              aria-label={t("settings.sync.versions.refreshButton")}
            >
              <RefreshCw
                className={showLoading ? "size-3.5 animate-spin" : "size-3.5"}
              />
            </Button>
          </Tooltip>
        </div>
        <p className="mt-1 text-sm text-muted-foreground">
          {t("settings.sync.versions.description")}
        </p>
      </div>

      {showLoading && (
        <div className="flex items-center gap-2 py-6 text-sm text-muted-foreground">
          <Spinner />
          <span>{t("settings.sync.versions.loading")}</span>
        </div>
      )}

      {!showLoading && isError && (
        <p className="text-sm text-destructive">
          {t("settings.sync.versions.loadError")}
        </p>
      )}

      {!showLoading &&
        !isError &&
        (!visibleVersions || visibleVersions.length === 0) && (
          <EmptyState
            icon={History}
            title={t("settings.sync.versions.empty")}
          />
        )}

      {!!visibleVersions?.length && (
        <ul className="flex flex-col divide-y divide-border overflow-hidden rounded-lg border border-input">
          {visibleVersions.map((v, idx) => (
            <li
              key={v.id}
              className="flex flex-wrap items-center justify-between gap-3 px-3 py-2.5"
            >
              <div className="flex min-w-0 flex-1 basis-56 flex-col gap-0.5">
                <div className="flex items-center gap-2">
                  <span className="text-sm font-medium text-foreground">
                    {new Date(v.createdAt).toLocaleString()}
                  </span>
                  {idx === 0 && (
                    <Badge variant="primary">
                      {t("settings.sync.versions.latestBadge")}
                    </Badge>
                  )}
                </div>
                {v.sizeBytes != null && (
                  <span className="font-mono text-xs text-muted-foreground">
                    {formatSize(v.sizeBytes)}
                  </span>
                )}
              </div>
              <Button size="sm" variant="outline" onClick={() => setTarget(v)}>
                <RotateCcw /> {t("settings.sync.versions.restoreButton")}
              </Button>
            </li>
          ))}
        </ul>
      )}

      <RestoreConfirmDialog
        target={target}
        onOpenChange={() => setTarget(null)}
      />
    </div>
  );
}

function RestoreConfirmDialog({
  target,
  onOpenChange,
}: {
  target: SyncVersion | null;
  onOpenChange: () => void;
}) {
  const { t } = useI18n();
  const restore = useSyncRestoreVersion();

  const confirm = async (id: string) => {
    try {
      const outcome = await restore.mutateAsync(id);
      toast.success(
        t("settings.sync.versions.restoredTitle"),
        outcome.remoteSynced
          ? undefined
          : t("settings.sync.versions.restoredPendingDescription"),
      );
    } catch (err) {
      const code = errorCode(err);
      toast.error(
        t("settings.sync.versions.restoreFailed"),
        code === "crypto"
          ? t("settings.sync.versions.restoreWrongPassphrase")
          : code === "serde"
            ? t("settings.sync.corruptRemoteBackup")
            : errorMessage(err),
      );
    }
  };

  const state: ConfirmState | null = target
    ? {
        title: t("settings.sync.versions.restoreConfirmTitle"),
        description: t("settings.sync.versions.restoreConfirmDescription"),
        cancelLabel: t("common.cancel"),
        actions: [
          {
            label: t("settings.sync.versions.restoreConfirmButton"),
            variant: "destructive",
            loading: restore.isPending,
            onSelect: () => confirm(target.id),
          },
        ],
      }
    : null;

  return <ConfirmDialog state={state} onClose={onOpenChange} />;
}

function FileBackupCard() {
  const { t } = useI18n();
  const fileExport = useSyncFileExport();
  const fileImport = useSyncFileImport();
  const [action, setAction] = useState<"export" | "import" | null>(null);

  const doExport = async (passphrase: string) => {
    const path = await save({
      title: t("settings.sync.file.exportDialogTitle"),
      defaultPath: "sageport-vault.json",
      filters: [
        { name: t("settings.sync.file.vaultFilterName"), extensions: ["json"] },
      ],
    });
    if (!path) return;
    try {
      await fileExport.mutateAsync({ path, passphrase });
      toast.success(t("settings.sync.file.exportedTitle"));
    } catch (err) {
      toast.error(t("settings.sync.file.exportFailed"), errorMessage(err));
    }
  };

  const doImport = async (passphrase: string) => {
    const selected = await open({
      title: t("settings.sync.file.importDialogTitle"),
      multiple: false,
      filters: [
        { name: t("settings.sync.file.vaultFilterName"), extensions: ["json"] },
      ],
    });
    const path = Array.isArray(selected) ? selected[0] : selected;
    if (!path) return;
    try {
      await fileImport.mutateAsync({ path, passphrase });
      toast.success(t("settings.sync.file.importedTitle"));
    } catch (err) {
      const code = errorCode(err);
      toast.error(
        t("settings.sync.file.importFailed"),
        code === "crypto"
          ? t("settings.sync.file.importWrongPassphrase")
          : code === "serde"
            ? t("settings.sync.file.importInvalidFile")
            : errorMessage(err),
      );
    }
  };

  const handleConfirm = async (passphrase: string) => {
    const pending = action;
    setAction(null);
    if (pending === "export") await doExport(passphrase);
    else if (pending === "import") await doImport(passphrase);
  };

  return (
    <div className="flex flex-col gap-4">
      <div>
        <h3 className="text-sm font-medium text-foreground">
          {t("settings.sync.file.title")}
        </h3>
        <p className="mt-1 text-sm text-muted-foreground">
          {t("settings.sync.file.description")}
        </p>
      </div>

      <div className="flex flex-wrap gap-2">
        <Button
          variant="outline"
          onClick={() => setAction("export")}
          loading={fileExport.isPending}
        >
          {t("settings.sync.file.exportButton")}
        </Button>
        <Button
          variant="outline"
          onClick={() => setAction("import")}
          loading={fileImport.isPending}
        >
          {t("settings.sync.file.importButton")}
        </Button>
      </div>

      <FilePassphraseDialog
        open={action !== null}
        onOpenChange={(next) => !next && setAction(null)}
        onConfirm={handleConfirm}
      />
    </div>
  );
}

function FilePassphraseDialog({
  open,
  onOpenChange,
  onConfirm,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onConfirm: (passphrase: string) => void;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <FilePassphraseForm
          onCancel={() => onOpenChange(false)}
          onConfirm={onConfirm}
        />
      </DialogContent>
    </Dialog>
  );
}

function FilePassphraseForm({
  onCancel,
  onConfirm,
}: {
  onCancel: () => void;
  onConfirm: (passphrase: string) => void;
}) {
  const { t } = useI18n();
  const [passphrase, setPassphrase] = useState("");

  return (
    <>
      <DialogHeader>
        <DialogTitle>
          {t("settings.sync.file.passphraseDialogTitle")}
        </DialogTitle>
      </DialogHeader>
      <PasswordInput
        value={passphrase}
        onChange={(e) => setPassphrase(e.target.value)}
        placeholder="••••••••"
        autoComplete="off"
        autoFocus
      />
      <DialogFooter>
        <Button variant="ghost" onClick={onCancel}>
          {t("common.cancel")}
        </Button>
        <Button onClick={() => onConfirm(passphrase)} disabled={!passphrase}>
          {t("settings.sync.file.passphraseDialogConfirm")}
        </Button>
      </DialogFooter>
    </>
  );
}
