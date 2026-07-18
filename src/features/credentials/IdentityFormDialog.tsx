import { useState } from "react";

import {
  Button,
  Field,
  FormBody,
  FormDialog,
  Input,
  PasswordInput,
  Select,
} from "@/components/ui";
import { useI18n } from "@/i18n";
import { ipc } from "@/lib/ipc";
import { errorMessage, toast } from "@/lib/toast";
import type { AuthType, Identity } from "@/types/models";
import { useCreateIdentity, useSshKeys, useUpdateIdentity } from "./api";
import { identityPasswordSubmissionValue } from "./identityForm";

export function IdentityFormDialog({
  open,
  identity,
  onClose,
}: {
  open: boolean;
  identity: Identity | null;
  onClose: () => void;
}) {
  const { t } = useI18n();
  return (
    <FormDialog
      open={open}
      onClose={onClose}
      title={
        identity
          ? t("credentials.identities.editTitle")
          : t("credentials.identities.newTitle")
      }
    >
      {open && (
        <IdentityFormBody
          key={identity?.id ?? "new"}
          identity={identity}
          onClose={onClose}
        />
      )}
    </FormDialog>
  );
}

function IdentityFormBody({
  identity,
  onClose,
}: {
  identity: Identity | null;
  onClose: () => void;
}) {
  const { t } = useI18n();
  const { data: keys = [] } = useSshKeys();
  const createIdentity = useCreateIdentity();
  const updateIdentity = useUpdateIdentity();

  const [name, setName] = useState(identity?.name ?? "");
  const [username, setUsername] = useState(identity?.username ?? "");
  const [authType, setAuthType] = useState<AuthType>(
    identity?.authType ?? "password",
  );
  const [password, setPassword] = useState("");
  const [passwordEdited, setPasswordEdited] = useState(false);
  const [clearSavedPassword, setClearSavedPassword] = useState(false);
  const [keyId, setKeyId] = useState(identity?.keyId ?? "");

  const editing = Boolean(identity);

  const revealSavedPassword = async () => {
    if (password) return true;
    if (!identity?.hasPassword) return true;
    try {
      setPassword(await ipc.identities.revealPassword(identity.id));
      setPasswordEdited(false);
      return true;
    } catch (error) {
      toast.error(
        t("credentials.identities.passwordRevealError"),
        errorMessage(error),
      );
      return false;
    }
  };

  const submit = async () => {
    if (!name.trim() || !username.trim()) {
      return toast.error(t("credentials.identities.nameUsernameRequired"));
    }
    if (authType === "key" && !keyId) {
      return toast.error(t("credentials.identities.keyRequired"));
    }
    const input = {
      name: name.trim(),
      username: username.trim(),
      authType,
      keyId: authType === "key" ? keyId || null : null,

      password: identityPasswordSubmissionValue({
        authType,
        value: identity && !passwordEdited ? "" : password,
        clearSavedPassword,
      }),
    };
    try {
      if (identity) {
        await updateIdentity.mutateAsync({ id: identity.id, input });
      } else {
        await createIdentity.mutateAsync(input);
      }
      onClose();
    } catch (err) {
      toast.error(t("credentials.identities.saveError"), errorMessage(err));
    }
  };

  return (
    <FormBody
      onClose={onClose}
      onSubmit={submit}
      submitLabel={editing ? t("common.saveChanges") : t("common.create")}
      pending={createIdentity.isPending || updateIdentity.isPending}
    >
      <div className="grid grid-cols-2 gap-3">
        <Field label={t("credentials.identities.name")} required>
          <Input
            autoFocus
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder={t("credentials.identities.namePlaceholder")}
          />
        </Field>
        <Field label={t("credentials.identities.username")} required>
          <Input
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            placeholder="root"
          />
        </Field>
      </div>

      <Field label={t("credentials.identities.authentication")}>
        <Select
          value={authType}
          onValueChange={(value) => setAuthType(value as AuthType)}
          options={[
            { value: "password", label: t("common.auth.password") },
            { value: "key", label: t("common.auth.key") },
            { value: "agent", label: t("common.auth.agent") },
          ]}
        />
      </Field>

      {authType === "password" && (
        <div className="space-y-2">
          <Field
            label={t("credentials.identities.password")}
            hint={
              clearSavedPassword
                ? t("credentials.identities.passwordWillClear")
                : editing
                  ? t("credentials.identities.passwordKeepHint")
                  : undefined
            }
          >
            <PasswordInput
              value={password}
              onChange={(event) => {
                setPassword(event.target.value);
                setPasswordEdited(true);
                if (event.target.value) setClearSavedPassword(false);
              }}
              placeholder="••••••••"
              disabled={clearSavedPassword}
              autoComplete="new-password"
              onBeforeReveal={
                identity?.hasPassword ? revealSavedPassword : undefined
              }
            />
          </Field>
          {identity?.hasPassword && (
            <Button
              type="button"
              size="sm"
              variant="ghost"
              className="h-auto px-0 py-0 text-xs text-muted-foreground hover:bg-transparent hover:text-foreground"
              onClick={() => {
                if (!clearSavedPassword) setPassword("");
                setPasswordEdited(false);
                setClearSavedPassword((value) => !value);
              }}
            >
              {clearSavedPassword
                ? t("credentials.identities.passwordClearUndo")
                : t("credentials.identities.passwordClear")}
            </Button>
          )}
        </div>
      )}

      {authType === "key" && (
        <Field
          label={t("credentials.identities.sshKey")}
          hint={
            keys.length === 0
              ? t("credentials.identities.noKeysHint")
              : undefined
          }
          required
        >
          <Select
            value={keyId}
            onValueChange={setKeyId}
            options={[
              { value: "", label: t("hostForm.selectKey") },
              ...keys.map((key) => ({ value: key.id, label: key.name })),
            ]}
          />
        </Field>
      )}
    </FormBody>
  );
}
