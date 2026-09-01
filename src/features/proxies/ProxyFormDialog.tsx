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
import { ipc } from "@/lib/ipc";
import { errorMessage, toast } from "@/lib/toast";
import type { ProxyKind, ProxyProfile } from "@/types/models";
import { useCreateProxy, useUpdateProxy } from "./api";

export function ProxyFormDialog({
  open,
  profile,
  onClose,
}: {
  open: boolean;
  profile: ProxyProfile | null;
  onClose: () => void;
}) {
  const { t } = useI18n();
  return (
    <FormDialog
      open={open}
      onClose={onClose}
      title={
        profile
          ? t("settings.proxy.form.editTitle")
          : t("settings.proxy.form.newTitle")
      }
    >
      <ProxyFormBody
        key={profile?.id ?? "new"}
        profile={profile}
        onClose={onClose}
      />
    </FormDialog>
  );
}

function ProxyFormBody({
  profile,
  onClose,
}: {
  profile: ProxyProfile | null;
  onClose: () => void;
}) {
  const { t } = useI18n();
  const createProxy = useCreateProxy();
  const updateProxy = useUpdateProxy();
  const [name, setName] = useState(profile?.name ?? "");
  const [kind, setKind] = useState<ProxyKind>(profile?.kind ?? "socks5");
  const [host, setHost] = useState(profile?.host ?? "");
  const [port, setPort] = useState(String(profile?.port ?? 1080));
  const [username, setUsername] = useState(profile?.username ?? "");
  const [password, setPassword] = useState("");
  const [passwordEdited, setPasswordEdited] = useState(false);

  const revealSavedPassword = async () => {
    if (password || !profile?.hasPassword) return true;
    try {
      setPassword(await ipc.proxies.revealPassword(profile.id));
      setPasswordEdited(false);
      return true;
    } catch (error) {
      toast.error(
        t("settings.proxy.form.passwordRevealError"),
        errorMessage(error),
      );
      return false;
    }
  };

  const submit = async () => {
    const parsedPort = Number(port);
    if (!name.trim()) {
      return toast.error(t("settings.proxy.form.nameRequired"));
    }
    if (!host.trim()) {
      return toast.error(t("settings.proxy.form.hostRequired"));
    }
    if (!Number.isInteger(parsedPort) || parsedPort < 1 || parsedPort > 65535) {
      return toast.error(t("settings.proxy.form.portInvalid"));
    }
    const input = {
      name: name.trim(),
      kind,
      host: host.trim(),
      port: parsedPort,
      username: username.trim() || null,
      password: passwordEdited ? password : undefined,
    };
    try {
      if (profile) {
        await updateProxy.mutateAsync({ id: profile.id, input });
      } else {
        await createProxy.mutateAsync(input);
      }
      onClose();
    } catch (error) {
      toast.error(t("settings.proxy.form.saveError"), errorMessage(error));
    }
  };

  return (
    <FormBody
      onClose={onClose}
      onSubmit={submit}
      submitLabel={
        profile ? t("common.saveChanges") : t("settings.proxy.form.create")
      }
      pending={createProxy.isPending || updateProxy.isPending}
    >
      <Field label={t("settings.proxy.form.name")} required>
        <Input
          autoFocus
          value={name}
          onChange={(event) => setName(event.target.value)}
          placeholder={t("settings.proxy.form.namePlaceholder")}
        />
      </Field>

      <Field
        label={t("settings.proxy.form.kind")}
        hint={t(`settings.proxy.form.kindHint.${kind}`)}
      >
        <Select
          value={kind}
          onValueChange={(value) => setKind(value as ProxyKind)}
          options={[
            { value: "socks5", label: t("settings.proxy.kind.socks5") },
            { value: "http", label: t("settings.proxy.kind.http") },
          ]}
        />
      </Field>

      <div className="grid grid-cols-[minmax(0,1fr)_7rem] gap-3">
        <Field label={t("settings.proxy.form.host")} required>
          <Input
            value={host}
            onChange={(event) => setHost(event.target.value)}
            placeholder="127.0.0.1"
            autoComplete="off"
            spellCheck={false}
          />
        </Field>
        <Field label={t("settings.proxy.form.port")} required>
          <Input
            type="number"
            min={1}
            max={65535}
            value={port}
            onChange={(event) => setPort(event.target.value)}
          />
        </Field>
      </div>

      <Field
        label={t("settings.proxy.form.username")}
        hint={t("settings.proxy.form.authHint")}
      >
        <Input
          value={username}
          onChange={(event) => setUsername(event.target.value)}
          autoComplete="off"
          spellCheck={false}
        />
      </Field>

      <Field
        label={t("settings.proxy.form.password")}
        hint={
          profile?.hasPassword
            ? t("settings.proxy.form.passwordSavedHint")
            : undefined
        }
      >
        <PasswordInput
          value={password}
          onChange={(event) => {
            setPassword(event.target.value);
            setPasswordEdited(true);
          }}
          placeholder="••••••••"
          autoComplete="new-password"
          onBeforeReveal={
            profile?.hasPassword ? revealSavedPassword : undefined
          }
        />
      </Field>
    </FormBody>
  );
}
