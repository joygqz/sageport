import { useEffect, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";

import {
  Button,
  CONTROL_CONTAINER_CLASS,
  FormBody,
  FormDialog,
  FormLoading,
  Switch,
} from "@/components/ui";
import { useI18n } from "@/i18n";
import { ipc } from "@/lib/ipc";
import { cn } from "@/lib/utils";
import { errorMessage, toast } from "@/lib/toast";
import type { SshConfigHost } from "@/types/models";
import { credentialKeys } from "@/features/credentials/api";
import { hostKeys } from "./api";

export function SshConfigImportDialog({
  open,
  onClose,
}: {
  open: boolean;
  onClose: () => void;
}) {
  const { t } = useI18n();
  return (
    <FormDialog
      open={open}
      onClose={onClose}
      width="w-[560px]"
      title={t("hosts.import.title")}
    >
      <ImportBody onClose={onClose} />
    </FormDialog>
  );
}

function ImportBody({ onClose }: { onClose: () => void }) {
  const { t } = useI18n();
  const qc = useQueryClient();
  const [entries, setEntries] = useState<SshConfigHost[] | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    void ipc.hosts.importPreview().then(
      (found) => {
        setEntries(found);
        setSelected(
          new Set(
            found
              .filter((host) => !host.existing && host.warnings.length === 0)
              .map((host) => host.alias),
          ),
        );
      },
      (err) => {
        toast.error(t("hosts.import.error"), errorMessage(err));
        setEntries([]);
      },
    );
  }, [t]);

  if (entries === null) return <FormLoading />;

  const selectable = entries.filter(
    (entry) => !entry.existing && entry.warnings.length === 0,
  );
  const allSelected =
    selectable.length > 0 && selected.size === selectable.length;

  const toggle = (entry: SshConfigHost) => {
    if (entry.existing || entry.warnings.length > 0) return;
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(entry.alias)) next.delete(entry.alias);
      else next.add(entry.alias);
      return next;
    });
  };

  const toggleAll = () =>
    setSelected(
      allSelected ? new Set() : new Set(selectable.map((host) => host.alias)),
    );

  const warningLabel = (warning: string) => {
    switch (warning) {
      case "identity_unreadable":
        return t("hosts.import.warning.identityUnreadable");
      case "proxy_unresolved":
        return t("hosts.import.warning.proxyUnresolved");
      case "username_missing":
        return t("hosts.import.warning.usernameMissing");
      case "match_unsupported":
        return t("hosts.import.warning.matchUnsupported");
      case "include_unreadable":
        return t("hosts.import.warning.includeUnreadable");
      case "include_depth":
        return t("hosts.import.warning.includeDepth");
      case "invalid_port":
        return t("hosts.import.warning.invalidPort");
      case "unsupported_token":
        return t("hosts.import.warning.unsupportedToken");
      default:
        return warning;
    }
  };

  const submit = async () => {
    const chosen = entries.filter((h) => selected.has(h.alias));
    if (chosen.length === 0) return;
    setSaving(true);
    try {
      const count = await ipc.hosts.importApply(chosen);
      await qc.invalidateQueries({ queryKey: hostKeys.hosts });
      await qc.invalidateQueries({ queryKey: credentialKeys.sshKeys });
      toast.success(t("hosts.import.success", { count: String(count) }));
      onClose();
    } catch (err) {
      toast.error(t("hosts.import.error"), errorMessage(err));
    } finally {
      setSaving(false);
    }
  };

  if (entries.length === 0) {
    return (
      <div className="flex flex-col gap-4 p-5">
        <p className="text-sm text-muted-foreground">
          {t("hosts.import.empty")}
        </p>
        <div className="flex justify-end">
          <Button variant="ghost" onClick={onClose}>
            {t("common.cancel")}
          </Button>
        </div>
      </div>
    );
  }

  return (
    <FormBody
      onClose={onClose}
      onSubmit={submit}
      submitLabel={t("hosts.import.submit", { count: String(selected.size) })}
      pending={saving}
      submitDisabled={selected.size === 0}
      footerStart={
        <label className="flex cursor-pointer items-center gap-2 text-sm text-muted-foreground">
          <Switch checked={allSelected} onCheckedChange={toggleAll} />
          {t("hosts.import.selectAll")}
        </label>
      }
    >
      <p className="text-sm text-muted-foreground">
        {t("hosts.import.description")}
      </p>
      <div className={cn(CONTROL_CONTAINER_CLASS, "overflow-hidden")}>
        {entries.map((entry, index) => {
          const on = selected.has(entry.alias);
          const disabled = entry.existing || entry.warnings.length > 0;
          return (
            <div
              key={entry.alias}
              className={cn(
                "flex w-full items-center text-sm transition-colors hover:bg-list-hover",
                index > 0 && "border-t border-border",
                on && "bg-list-hover",
                disabled && "opacity-60",
              )}
            >
              <Switch
                className="ml-3"
                checked={on}
                disabled={disabled}
                onCheckedChange={() => toggle(entry)}
              />
              <button
                type="button"
                onClick={() => toggle(entry)}
                disabled={disabled}
                className="min-w-0 flex-1 py-2 pl-3 pr-3 text-left"
              >
                <div className="flex items-baseline gap-2">
                  <span className="truncate font-medium">{entry.alias}</span>
                  {entry.existing && (
                    <span className="shrink-0 rounded-sm bg-muted px-1 py-px text-2xs text-muted-foreground">
                      {t("hosts.import.alreadyExists")}
                    </span>
                  )}
                  {entry.proxyJump && (
                    <span className="truncate text-2xs text-muted-foreground">
                      {t("hosts.import.viaJump", { jump: entry.proxyJump })}
                    </span>
                  )}
                </div>
                <span className="truncate font-mono text-2xs text-muted-foreground">
                  {entry.user ? `${entry.user}@` : ""}
                  {entry.hostName}
                  {entry.port !== 22 ? `:${entry.port}` : ""}
                </span>
                {entry.warnings.map((warning) => (
                  <span
                    key={warning}
                    className="block text-2xs leading-relaxed text-danger"
                  >
                    {warningLabel(warning)}
                  </span>
                ))}
              </button>
            </div>
          );
        })}
      </div>
    </FormBody>
  );
}
