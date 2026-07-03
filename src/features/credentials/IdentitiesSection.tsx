import { useState } from "react";
import { Plus, Trash2, UserCog } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  ConfirmDialog,
  type ConfirmState,
} from "@/components/ui/confirm-dialog";
import { EmptyState } from "@/components/ui/empty-state";
import { Field } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { PasswordInput } from "@/components/ui/password-input";
import { Select } from "@/components/ui/select";
import { useI18n } from "@/i18n";
import { errorMessage, toast } from "@/lib/toast";
import type { AuthType, Identity } from "@/types/models";
import {
  useCreateIdentity,
  useDeleteIdentity,
  useIdentities,
  useSshKeys,
} from "./api";

export function IdentitiesSection() {
  const { t } = useI18n();
  const { data: identities = [] } = useIdentities();
  const { data: keys = [] } = useSshKeys();
  const createIdentity = useCreateIdentity();
  const deleteIdentity = useDeleteIdentity();

  const [adding, setAdding] = useState(false);
  const [name, setName] = useState("");
  const [username, setUsername] = useState("");
  const [authType, setAuthType] = useState<AuthType>("password");
  const [password, setPassword] = useState("");
  const [keyId, setKeyId] = useState("");
  const [confirmState, setConfirmState] = useState<ConfirmState | null>(null);

  const reset = () => {
    setName("");
    setUsername("");
    setAuthType("password");
    setPassword("");
    setKeyId("");
    setAdding(false);
  };

  const submit = async () => {
    if (!name.trim() || !username.trim()) {
      return toast.error(t("identities.nameUsernameRequired"));
    }
    try {
      await createIdentity.mutateAsync({
        name: name.trim(),
        username: username.trim(),
        authType,
        keyId: authType === "key" ? keyId || null : null,
        password: authType === "password" && password ? password : null,
      });
      reset();
    } catch (err) {
      toast.error(t("identities.addError"), errorMessage(err));
    }
  };

  const remove = async (id: string) => {
    try {
      await deleteIdentity.mutateAsync(id);
    } catch (err) {
      toast.error(t("identities.deleteError"), errorMessage(err));
    }
  };

  const confirmRemove = (identity: Identity) => {
    setConfirmState({
      title: t("identities.deleteConfirmTitle"),
      description: t("identities.deleteConfirmDescription", {
        name: identity.name,
      }),
      cancelLabel: t("common.cancel"),
      actions: [
        {
          label: t("common.delete"),
          variant: "destructive",
          onSelect: () => void remove(identity.id),
        },
      ],
    });
  };

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center justify-end">
        {!adding && (
          <Button size="sm" variant="secondary" onClick={() => setAdding(true)}>
            <Plus /> {t("identities.addIdentity")}
          </Button>
        )}
      </div>

      {adding && (
        <div className="flex flex-col gap-3 rounded-lg border border-border p-3">
          <div className="grid grid-cols-2 gap-3">
            <Field label={t("identities.name")} required>
              <Input
                autoFocus
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder={t("identities.namePlaceholder")}
              />
            </Field>
            <Field label={t("identities.username")} required>
              <Input
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                placeholder={t("identities.usernamePlaceholder")}
              />
            </Field>
          </div>
          <Field label={t("identities.authentication")}>
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
            <Field label={t("identities.password")}>
              <PasswordInput
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                autoComplete="off"
              />
            </Field>
          )}
          {authType === "key" && (
            <Field
              label={t("identities.sshKey")}
              hint={
                keys.length === 0 ? t("identities.addKeyFirstHint") : undefined
              }
            >
              <Select value={keyId} onChange={(e) => setKeyId(e.target.value)}>
                <option value="">{t("common.selectKey")}</option>
                {keys.map((k) => (
                  <option key={k.id} value={k.id}>
                    {k.name}
                  </option>
                ))}
              </Select>
            </Field>
          )}
          <div className="flex justify-end gap-2">
            <Button variant="ghost" size="sm" onClick={reset}>
              {t("common.cancel")}
            </Button>
            <Button
              size="sm"
              onClick={submit}
              loading={createIdentity.isPending}
            >
              {t("identities.saveIdentity")}
            </Button>
          </div>
        </div>
      )}

      {identities.length === 0 && !adding ? (
        <EmptyState icon={UserCog} title={t("identities.emptyTitle")} />
      ) : (
        <div className="flex flex-col gap-1">
          {identities.map((id) => (
            <div
              key={id.id}
              className="flex items-center gap-2 rounded-md border border-border px-3 py-2 text-sm"
            >
              <UserCog className="size-4 text-muted-foreground" />
              <span className="font-medium">{id.name}</span>
              <span className="text-xs text-muted-foreground">
                {id.username} · {id.authType}
              </span>
              <Button
                size="icon"
                variant="ghost"
                className="ml-auto size-7"
                onClick={() => confirmRemove(id)}
              >
                <Trash2 className="size-3.5" />
              </Button>
            </div>
          ))}
        </div>
      )}
      <ConfirmDialog
        state={confirmState}
        onClose={() => setConfirmState(null)}
      />
    </div>
  );
}
