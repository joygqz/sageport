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
  useSetSyncPassphrase,
  useSetSyncToken,
  useSyncConfig,
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
      <PassphraseCard />
      <Separator />
      <GistCard />
      {!!config?.gistId && (
        <>
          <Separator />
          <VersionsCard />
        </>
      )}
      <Separator />
      <FileBackupCard hasPassphrase={!!config?.hasPassphrase} />
    </div>
  );
}

function PassphraseCard() {
  const { t } = useI18n();
  const { data: config } = useSyncConfig();
  const setPassphrase = useSetSyncPassphrase();
  const [value, setValue] = useState("");

  const doSave = async () => {
    try {
      await setPassphrase.mutateAsync(value);
      setValue("");
      toast.success(t("settings.sync.passphrase.saved"));
    } catch (err) {
      toast.error(t("settings.sync.passphrase.saveError"), errorMessage(err));
    }
  };

  return (
    <div className="flex flex-col gap-4">
      <div>
        <h3 className="text-sm font-medium text-foreground">
          {t("settings.sync.passphrase.title")}
        </h3>
        <p className="mt-1 text-sm text-muted-foreground">
          {t("settings.sync.passphrase.description")}
        </p>
      </div>

      <Field
        label={t("settings.sync.passphrase.label")}
        hint={
          config?.hasPassphrase
            ? t("settings.sync.passphrase.hintSaved")
            : t("settings.sync.passphrase.hint")
        }
      >
        <div className="flex gap-2">
          <PasswordInput
            value={value}
            onChange={(e) => setValue(e.target.value)}
            placeholder={
              config?.hasPassphrase ? "•••••••• (saved)" : "••••••••"
            }
            autoComplete="off"
          />
          <Button
            onClick={doSave}
            disabled={!value}
            loading={setPassphrase.isPending}
          >
            {t("common.save")}
          </Button>
        </div>
      </Field>
    </div>
  );
}

function GistCard() {
  const { t } = useI18n();
  const { data: config } = useSyncConfig();
  const setToken = useSetSyncToken();
  const disconnect = useSyncDisconnect();
  const push = useSyncPush();
  const [token, setTokenValue] = useState("");

  const saveToken = async () => {
    try {
      await setToken.mutateAsync(token);
      setTokenValue("");
      toast.success(t("settings.sync.gist.tokenSaved"));
    } catch (err) {
      toast.error(t("settings.sync.gist.tokenSaveError"), errorMessage(err));
    }
  };

  const doPush = async () => {
    if (!config?.hasPassphrase) {
      return toast.error(t("settings.sync.setPassphraseFirst"));
    }
    try {
      await push.mutateAsync();
      toast.success(
        t("settings.sync.gist.pushedTitle"),
        t("settings.sync.gist.pushedDescription"),
      );
    } catch (err) {
      toast.error(t("settings.sync.gist.pushFailed"), errorMessage(err));
    }
  };

  const doDisconnect = async () => {
    try {
      await disconnect.mutateAsync();
      toast.success(t("settings.sync.gist.disconnected"));
    } catch (err) {
      toast.error(t("settings.sync.gist.disconnectError"), errorMessage(err));
    }
  };

  return (
    <div className="flex flex-col gap-4">
      <div>
        <h3 className="text-sm font-medium text-foreground">
          {t("settings.sync.gist.title")}
        </h3>
        <p className="mt-1 text-sm text-muted-foreground">
          {t("settings.sync.gist.description")}
        </p>
      </div>

      <Field
        label={t("settings.sync.gist.tokenLabel")}
        hint={
          config?.hasToken
            ? t("settings.sync.gist.tokenHintSaved")
            : t("settings.sync.gist.tokenHint")
        }
      >
        <div className="flex gap-2">
          <PasswordInput
            value={token}
            onChange={(e) => setTokenValue(e.target.value)}
            placeholder={config?.hasToken ? "•••••••• (saved)" : "ghp_…"}
            autoComplete="off"
          />
          <Button
            onClick={saveToken}
            disabled={!token}
            loading={setToken.isPending}
          >
            {t("common.save")}
          </Button>
        </div>
      </Field>

      {config?.gistId && (
        <p className="text-xs text-muted-foreground">
          {t("settings.sync.gist.linkedLabel")}{" "}
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

      {config?.hasToken && (
        <p className="text-xs text-muted-foreground">
          {t("settings.sync.gist.lastSyncedLabel")}{" "}
          {config.lastSyncedAt
            ? new Date(config.lastSyncedAt).toLocaleString()
            : t("settings.sync.gist.neverSynced")}
        </p>
      )}

      <div className="flex gap-2">
        <Button
          variant="secondary"
          onClick={doPush}
          disabled={!config?.hasToken}
          loading={push.isPending}
        >
          {t("settings.sync.gist.pushButton")}
        </Button>
        {config?.hasToken && (
          <Button
            variant="ghost"
            onClick={doDisconnect}
            loading={disconnect.isPending}
          >
            {t("settings.sync.gist.disconnectButton")}
          </Button>
        )}
      </div>
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
          description={t("settings.sync.versions.emptyDescription")}
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
      toast.success(
        t("settings.sync.versions.restoredTitle"),
        t("settings.sync.versions.restoredDescription"),
      );
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

function FileBackupCard({ hasPassphrase }: { hasPassphrase: boolean }) {
  const { t } = useI18n();
  const fileExport = useSyncFileExport();
  const fileImport = useSyncFileImport();

  const doExport = async () => {
    if (!hasPassphrase)
      return toast.error(t("settings.sync.setPassphraseFirst"));
    const path = await save({
      title: t("settings.sync.exportDialogTitle"),
      defaultPath: "sageport-vault.json",
      filters: [
        { name: t("settings.sync.vaultFilterName"), extensions: ["json"] },
      ],
    });
    if (!path) return;
    try {
      await fileExport.mutateAsync(path);
      toast.success(
        t("settings.sync.exportedTitle"),
        t("settings.sync.exportedDescription"),
      );
    } catch (err) {
      toast.error(t("settings.sync.exportFailed"), errorMessage(err));
    }
  };

  const doImport = async () => {
    if (!hasPassphrase)
      return toast.error(t("settings.sync.setPassphraseFirst"));
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
      await fileImport.mutateAsync(path);
      toast.success(
        t("settings.sync.importedTitle"),
        t("settings.sync.importedDescription"),
      );
    } catch (err) {
      toast.error(t("settings.sync.importFailed"), errorMessage(err));
    }
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
          variant="secondary"
          onClick={doExport}
          loading={fileExport.isPending}
        >
          {t("settings.sync.exportButton")}
        </Button>
        <Button
          variant="outline"
          onClick={doImport}
          loading={fileImport.isPending}
        >
          {t("settings.sync.importButton")}
        </Button>
      </div>
    </div>
  );
}
