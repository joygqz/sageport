import { useState } from "react";
import { open, save } from "@tauri-apps/plugin-dialog";
import { History, RotateCcw } from "lucide-react";

import {
  Badge,
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  EmptyState,
  Field,
  PasswordInput,
  Separator,
  Spinner,
} from "@/components/ui";
import { useI18n } from "@/i18n";
import { errorMessage, toast } from "@/lib/toast";
import type { GistVersion } from "@/types/models";
import {
  useSyncConfig,
  useSyncConnect,
  useSyncDisconnect,
  useSyncFileExport,
  useSyncFileImport,
  useSyncPush,
  useSyncRestoreVersion,
  useSyncVersions,
} from "./api";

export function SyncSection() {
  const { data: config } = useSyncConfig();
  return (
    <div className="flex flex-col gap-6">
      <ConnectCard />
      {!!config?.gistId && (
        <>
          <Separator />
          <VersionsCard />
        </>
      )}
      <Separator />
      <FileBackupCard />
    </div>
  );
}

function ConnectCard() {
  const { t } = useI18n();
  const { data: config } = useSyncConfig();
  const connect = useSyncConnect();
  const disconnect = useSyncDisconnect();
  const push = useSyncPush();
  const [token, setToken] = useState("");
  const [passphrase, setPassphrase] = useState("");
  const [mismatchGistId, setMismatchGistId] = useState<string | null>(null);

  const doConnect = async (force: boolean) => {
    try {
      const outcome = await connect.mutateAsync({ token, passphrase, force });
      if (outcome.status === "passphraseMismatch") {
        setMismatchGistId(outcome.gistId);
        return;
      }
      setMismatchGistId(null);
      setToken("");
      setPassphrase("");
    } catch (err) {
      toast.error(t("settings.sync.connect.connectError"), errorMessage(err));
    }
  };

  const doDisconnect = async () => {
    try {
      await disconnect.mutateAsync();
    } catch (err) {
      toast.error(
        t("settings.sync.connect.disconnectError"),
        errorMessage(err),
      );
    }
  };

  const doPush = async () => {
    try {
      await push.mutateAsync();
      toast.success(t("settings.sync.connect.pushedTitle"));
    } catch (err) {
      toast.error(t("settings.sync.connect.pushFailed"), errorMessage(err));
    }
  };

  if (config?.hasToken) {
    return (
      <div className="flex flex-col gap-4">
        <div>
          <h3 className="text-sm font-medium text-foreground">
            {t("settings.sync.connect.title")}
          </h3>
          <p className="mt-1 text-sm text-muted-foreground">
            {t("settings.sync.connect.connectedHint")}
          </p>
        </div>

        {config.gistId && (
          <p className="text-xs text-muted-foreground">
            {t("settings.sync.connect.linkedLabel")}{" "}
            <a
              href={`https://gist.github.com/${config.gistId}`}
              target="_blank"
              rel="noreferrer"
              className="font-mono text-foreground underline underline-offset-2"
            >
              {config.gistId.slice(0, 12)}…
            </a>
          </p>
        )}

        <p className="text-xs text-muted-foreground">
          {t("settings.sync.connect.lastSyncedLabel")}{" "}
          {config.lastSyncedAt
            ? new Date(config.lastSyncedAt).toLocaleString()
            : t("settings.sync.connect.neverSynced")}
        </p>

        <div className="flex gap-2">
          <Button variant="secondary" onClick={doPush} loading={push.isPending}>
            {t("settings.sync.connect.pushButton")}
          </Button>
          <Button
            variant="ghost"
            onClick={doDisconnect}
            loading={disconnect.isPending}
          >
            {t("settings.sync.connect.disconnectButton")}
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      <div>
        <h3 className="text-sm font-medium text-foreground">
          {t("settings.sync.connect.title")}
        </h3>
        <p className="mt-1 text-sm text-muted-foreground">
          {t("settings.sync.connect.description")}
        </p>
      </div>

      <Field
        label={t("settings.sync.connect.tokenLabel")}
        hint={t("settings.sync.connect.tokenHint")}
      >
        <PasswordInput
          value={token}
          onChange={(e) => setToken(e.target.value)}
          placeholder="ghp_…"
          autoComplete="off"
        />
      </Field>

      <Field
        label={t("settings.sync.connect.passphraseLabel")}
        hint={t("settings.sync.connect.passphraseHint")}
      >
        <PasswordInput
          value={passphrase}
          onChange={(e) => setPassphrase(e.target.value)}
          placeholder="••••••••"
          autoComplete="off"
        />
      </Field>

      <div>
        <Button
          onClick={() => doConnect(false)}
          disabled={!token || !passphrase}
          loading={connect.isPending}
        >
          {t("settings.sync.connect.connectButton")}
        </Button>
      </div>

      <Dialog
        open={!!mismatchGistId}
        onOpenChange={(open) => !open && setMismatchGistId(null)}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {t("settings.sync.connect.mismatchTitle")}
            </DialogTitle>
            <DialogDescription>
              {t("settings.sync.connect.mismatchDescription")}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setMismatchGistId(null)}>
              {t("settings.sync.connect.mismatchCancelButton")}
            </Button>
            <Button
              variant="destructive"
              onClick={() => doConnect(true)}
              loading={connect.isPending}
            >
              {t("settings.sync.connect.mismatchForceButton")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function VersionsCard() {
  const { t } = useI18n();
  const { data: config } = useSyncConfig();
  const {
    data: versions,
    isLoading,
    isError,
  } = useSyncVersions(!!config?.gistId);
  const [target, setTarget] = useState<GistVersion | null>(null);

  return (
    <div className="flex flex-col gap-4">
      <div>
        <h3 className="text-sm font-medium text-foreground">
          {t("settings.sync.versions.title")}
        </h3>
        <p className="mt-1 text-sm text-muted-foreground">
          {t("settings.sync.versions.description")}
        </p>
      </div>

      {isLoading && (
        <div className="flex items-center gap-2 py-6 text-sm text-muted-foreground">
          <Spinner /> …
        </div>
      )}

      {isError && (
        <p className="text-sm text-destructive">
          {t("settings.sync.versions.loadError")}
        </p>
      )}

      {!isLoading && !isError && (!versions || versions.length === 0) && (
        <EmptyState
          icon={History}
          title={t("settings.sync.versions.empty")}
        />
      )}

      {!!versions?.length && (
        <ul className="flex flex-col divide-y divide-border overflow-hidden rounded-lg border border-border">
          {versions.map((v, idx) => (
            <li
              key={v.sha}
              className="flex items-center justify-between gap-3 px-3 py-2.5"
            >
              <div className="flex min-w-0 flex-col gap-1">
                <div className="flex items-center gap-2">
                  <span className="text-sm font-medium text-foreground">
                    {new Date(v.committedAt).toLocaleString()}
                  </span>
                  {idx === 0 && (
                    <Badge variant="primary">
                      {t("settings.sync.versions.latestBadge")}
                    </Badge>
                  )}
                </div>
                <span className="font-mono text-xs text-muted-foreground">
                  {v.sha.slice(0, 10)} ·{" "}
                  {t("settings.sync.versions.changesLabel", {
                    additions: v.additions,
                    deletions: v.deletions,
                  })}
                </span>
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
  target: GistVersion | null;
  onOpenChange: () => void;
}) {
  const { t } = useI18n();
  const restore = useSyncRestoreVersion();

  const confirm = async () => {
    if (!target) return;
    try {
      await restore.mutateAsync(target.sha);
      toast.success(t("settings.sync.versions.restoredTitle"));
      onOpenChange();
    } catch (err) {
      toast.error(t("settings.sync.versions.restoreFailed"), errorMessage(err));
    }
  };

  return (
    <Dialog open={!!target} onOpenChange={(open) => !open && onOpenChange()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>
            {t("settings.sync.versions.restoreConfirmTitle")}
          </DialogTitle>
          <DialogDescription>
            {t("settings.sync.versions.restoreConfirmDescription")}
          </DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button variant="ghost" onClick={onOpenChange}>
            {t("settings.sync.versions.cancelButton")}
          </Button>
          <Button
            variant="destructive"
            onClick={confirm}
            loading={restore.isPending}
          >
            {t("settings.sync.versions.restoreConfirmButton")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function FileBackupCard() {
  const { t } = useI18n();
  const fileExport = useSyncFileExport();
  const fileImport = useSyncFileImport();
  const [action, setAction] = useState<"export" | "import" | null>(null);

  const doExport = async (passphrase: string) => {
    const path = await save({
      title: t("settings.sync.exportDialogTitle"),
      defaultPath: "sageport-vault.json",
      filters: [
        { name: t("settings.sync.vaultFilterName"), extensions: ["json"] },
      ],
    });
    if (!path) return;
    try {
      await fileExport.mutateAsync({ path, passphrase });
      toast.success(t("settings.sync.exportedTitle"));
    } catch (err) {
      toast.error(t("settings.sync.exportFailed"), errorMessage(err));
    }
  };

  const doImport = async (passphrase: string) => {
    const selected = await open({
      title: t("settings.sync.importDialogTitle"),
      multiple: false,
      filters: [
        { name: t("settings.sync.vaultFilterName"), extensions: ["json"] },
      ],
    });
    const path = Array.isArray(selected) ? selected[0] : selected;
    if (!path) return;
    try {
      await fileImport.mutateAsync({ path, passphrase });
      toast.success(t("settings.sync.importedTitle"));
    } catch (err) {
      toast.error(t("settings.sync.importFailed"), errorMessage(err));
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

      <div className="flex gap-2">
        <Button
          onClick={() => setAction("export")}
          loading={fileExport.isPending}
        >
          {t("settings.sync.exportButton")}
        </Button>
        <Button
          variant="outline"
          onClick={() => setAction("import")}
          loading={fileImport.isPending}
        >
          {t("settings.sync.importButton")}
        </Button>
      </div>

      <FilePassphraseDialog
        open={action !== null}
        onOpenChange={(open) => !open && setAction(null)}
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

/** Lives inside DialogContent so its state resets when the dialog closes. */
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
        <DialogTitle>{t("settings.sync.file.passphraseDialogTitle")}</DialogTitle>
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
