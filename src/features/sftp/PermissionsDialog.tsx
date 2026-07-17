import { useState } from "react";

import {
  CONTROL_CONTAINER_CLASS,
  Field,
  FormBody,
  FormDialog,
  Input,
  Switch,
} from "@/components/ui";
import { useI18n } from "@/i18n";
import { ipc } from "@/lib/ipc";
import { errorCode, errorMessage, toast } from "@/lib/toast";
import type { FileEntry } from "@/types/models";
import {
  hasBit,
  modeToOctal,
  octalToMode,
  toggleBit,
  type PermBit,
  type PermClass,
} from "./permissions";
import { useSftpStore } from "./store";

const CLASSES: PermClass[] = ["owner", "group", "others"];
const BITS: PermBit[] = ["read", "write", "execute"];

export function PermissionsDialog({
  connectionId,
  entry,
  onClose,
  onSaved,
}: {
  connectionId: string | null;
  entry: FileEntry | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  const { t } = useI18n();
  return (
    <FormDialog
      open={Boolean(entry)}
      onClose={onClose}
      width="w-[420px]"
      title={entry ? t("sftp.permissions.title", { name: entry.name }) : ""}
    >
      {entry && (
        <PermissionsBody
          connectionId={connectionId}
          entry={entry}
          onClose={onClose}
          onSaved={onSaved}
        />
      )}
    </FormDialog>
  );
}

function PermissionsBody({
  connectionId,
  entry,
  onClose,
  onSaved,
}: {
  connectionId: string | null;
  entry: FileEntry;
  onClose: () => void;
  onSaved: () => void;
}) {
  const { t } = useI18n();
  const [mode, setMode] = useState((entry.permissions ?? 0o644) & 0o777);
  const [octal, setOctal] = useState(modeToOctal(mode));
  const [saving, setSaving] = useState(false);
  const parsedOctal = octalToMode(octal);

  const setBoth = (next: number) => {
    setMode(next);
    setOctal(modeToOctal(next));
  };

  const submit = async () => {
    setSaving(true);
    try {
      await ipc.sftp.chmod(connectionId, entry.path, mode);
      onSaved();
      onClose();
    } catch (err) {
      if (connectionId && errorCode(err) === "network") {
        useSftpStore
          .getState()
          .applyStatus(connectionId, "error", errorMessage(err), "network");
      }
      toast.error(t("sftp.permissions.error"), errorMessage(err));
    } finally {
      setSaving(false);
    }
  };

  return (
    <FormBody
      onClose={onClose}
      onSubmit={submit}
      submitLabel={t("common.save")}
      pending={saving}
      submitDisabled={parsedOctal === null}
    >
      <div className={`${CONTROL_CONTAINER_CLASS} overflow-hidden`}>
        <div className="grid grid-cols-[1fr_repeat(3,3.5rem)] items-center border-b border-border bg-surface px-3 py-1.5 text-2xs font-medium text-muted-foreground">
          <span />
          {BITS.map((bit) => (
            <span key={bit} className="text-center">
              {t(`sftp.permissions.${bit}`)}
            </span>
          ))}
        </div>
        {CLASSES.map((cls) => (
          <div
            key={cls}
            className="grid grid-cols-[1fr_repeat(3,3.5rem)] items-center px-3 py-1.5 text-sm"
          >
            <span>{t(`sftp.permissions.${cls}`)}</span>
            {BITS.map((bit) => (
              <div key={bit} className="flex justify-center">
                <Switch
                  checked={hasBit(mode, cls, bit)}
                  onCheckedChange={() => setBoth(toggleBit(mode, cls, bit))}
                />
              </div>
            ))}
          </div>
        ))}
      </div>

      <Field
        label={t("sftp.permissions.octal")}
        error={
          parsedOctal === null ? t("sftp.permissions.invalidOctal") : undefined
        }
      >
        <Input
          value={octal}
          inputMode="numeric"
          className="w-24 font-mono"
          onChange={(e) => {
            const value = e.target.value;
            setOctal(value);
            const parsed = octalToMode(value);
            if (parsed !== null) setMode(parsed);
          }}
        />
      </Field>
    </FormBody>
  );
}
