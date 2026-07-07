import { useState } from "react";

import {
  Field,
  FormBody,
  FormDialog,
  Input,
  PasswordInput,
  Select,
} from "@/components/ui";
import { useI18n } from "@/i18n";
import { errorMessage, toast } from "@/lib/toast";
import type { AuthType, Identity } from "@/types/models";
import { useCreateIdentity, useSshKeys, useUpdateIdentity } from "./api";

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
      <IdentityFormBody identity={identity} onClose={onClose} />
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
  const [keyId, setKeyId] = useState(identity?.keyId ?? "");

  const editing = Boolean(identity);

  const submit = async () => {
    if (!name.trim() || !username.trim()) {
      return toast.error(t("credentials.identities.nameUsernameRequired"));
    }
    const input = {
      name: name.trim(),
      username: username.trim(),
      authType,
      keyId: authType === "key" ? keyId || null : null,

      password:
        authType === "password"
          ? editing && !password
            ? undefined
            : password || null
          : null,
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
          onChange={(e) => setAuthType(e.target.value as AuthType)}
        >
          <option value="password">{t("common.auth.password")}</option>
          <option value="key">{t("common.auth.key")}</option>
          <option value="agent">{t("common.auth.agent")}</option>
        </Select>
      </Field>

      {authType === "password" && (
        <Field
          label={t("credentials.identities.password")}
          hint={
            editing ? t("credentials.identities.passwordKeepHint") : undefined
          }
        >
          <PasswordInput
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            autoComplete="off"
          />
        </Field>
      )}

      {authType === "key" && (
        <Field
          label={t("credentials.identities.sshKey")}
          hint={
            keys.length === 0
              ? t("credentials.identities.noKeysHint")
              : undefined
          }
        >
          <Select value={keyId} onChange={(e) => setKeyId(e.target.value)}>
            <option value="">{t("hostForm.selectKey")}</option>
            {keys.map((k) => (
              <option key={k.id} value={k.id}>
                {k.name}
              </option>
            ))}
          </Select>
        </Field>
      )}
    </FormBody>
  );
}
