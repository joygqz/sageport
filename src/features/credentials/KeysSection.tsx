import { useState } from "react";
import { KeyRound, Plus, Trash2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { Field } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { useI18n } from "@/i18n";
import { errorMessage, toast } from "@/lib/toast";
import { emitRefresh } from "@/lib/windows";
import { useCreateSshKey, useDeleteSshKey, useSshKeys } from "./api";

export function KeysSection() {
  const { t } = useI18n();
  const { data: keys = [] } = useSshKeys();
  const createKey = useCreateSshKey();
  const deleteKey = useDeleteSshKey();
  const [adding, setAdding] = useState(false);
  const [name, setName] = useState("");
  const [privateKey, setPrivateKey] = useState("");
  const [passphrase, setPassphrase] = useState("");

  const reset = () => {
    setName("");
    setPrivateKey("");
    setPassphrase("");
    setAdding(false);
  };

  const submit = async () => {
    if (!name.trim() || !privateKey.trim()) {
      return toast.error(t("keys.nameKeyRequired"));
    }
    try {
      await createKey.mutateAsync({
        name: name.trim(),
        privateKey,
        passphrase: passphrase || null,
      });
      await emitRefresh();
      toast.success(t("keys.addedTitle"), name.trim());
      reset();
    } catch (err) {
      toast.error(t("keys.addError"), errorMessage(err));
    }
  };

  const remove = async (id: string) => {
    await deleteKey.mutateAsync(id);
    await emitRefresh();
  };

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center justify-between">
        <p className="text-sm text-muted-foreground">{t("keys.description")}</p>
        {!adding && (
          <Button size="sm" variant="secondary" onClick={() => setAdding(true)}>
            <Plus /> {t("keys.addKey")}
          </Button>
        )}
      </div>

      {adding && (
        <div className="flex flex-col gap-3 rounded-lg border border-border p-3">
          <Field label={t("keys.name")} required>
            <Input
              autoFocus
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder={t("keys.namePlaceholder")}
            />
          </Field>
          <Field label={t("keys.privateKey")} required hint={t("keys.privateKeyHint")}>
            <Textarea
              rows={5}
              value={privateKey}
              onChange={(e) => setPrivateKey(e.target.value)}
              placeholder={t("keys.privateKeyPlaceholder")}
              className="font-mono text-xs"
            />
          </Field>
          <Field label={t("keys.passphrase")} hint={t("keys.passphraseHint")}>
            <Input
              type="password"
              value={passphrase}
              onChange={(e) => setPassphrase(e.target.value)}
              autoComplete="off"
            />
          </Field>
          <div className="flex justify-end gap-2">
            <Button variant="ghost" size="sm" onClick={reset}>
              {t("common.cancel")}
            </Button>
            <Button size="sm" onClick={submit} loading={createKey.isPending}>
              {t("keys.saveKey")}
            </Button>
          </div>
        </div>
      )}

      {keys.length === 0 && !adding ? (
        <EmptyState
          icon={KeyRound}
          title={t("keys.emptyTitle")}
          description={t("keys.emptyDescription")}
        />
      ) : (
        <div className="flex flex-col gap-1">
          {keys.map((k) => (
            <div
              key={k.id}
              className="flex items-center gap-2 rounded-md border border-border px-3 py-2 text-sm"
            >
              <KeyRound className="size-4 text-muted-foreground" />
              <span className="font-medium">{k.name}</span>
              <Button
                size="icon"
                variant="ghost"
                className="ml-auto size-7"
                onClick={() => remove(k.id)}
              >
                <Trash2 className="size-3.5" />
              </Button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
