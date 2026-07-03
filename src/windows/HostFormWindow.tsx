import { useEffect } from "react";
import { useQuery } from "@tanstack/react-query";
import { useForm } from "react-hook-form";

import {
  Button,
  Field,
  Input,
  PasswordInput,
  Select,
  Textarea,
} from "@/components/ui";
import { Spinner } from "@/components/ui/spinner";
import { WindowHeader } from "@/components/layout/WindowHeader";
import { useI18n } from "@/i18n";
import { ipc } from "@/lib/ipc";
import { errorMessage, toast } from "@/lib/toast";
import { closeSelf, emitRefresh } from "@/lib/windows";
import type { AuthType, HostInput } from "@/types/models";
import { useIdentities, useSshKeys } from "@/features/credentials/api";
import { useCreateHost, useGroups, useUpdateHost } from "@/features/hosts/api";

interface FormValues {
  label: string;
  address: string;
  port: number;
  identityId: string;
  username: string;
  authType: AuthType;
  password: string;
  keyId: string;
  groupId: string;
  notes: string;
}

const emptyValues: FormValues = {
  label: "",
  address: "",
  port: 22,
  identityId: "",
  username: "",
  authType: "password",
  password: "",
  keyId: "",
  groupId: "",
  notes: "",
};

export function HostFormWindow({ hostId }: { hostId: string | null }) {
  const { t } = useI18n();
  const { data: groups = [] } = useGroups();
  const { data: keys = [] } = useSshKeys();
  const { data: identities = [] } = useIdentities();
  const createHost = useCreateHost();
  const updateHost = useUpdateHost();

  const { data: host, isLoading } = useQuery({
    queryKey: ["host", hostId],
    queryFn: () => ipc.hosts.get(hostId!),
    enabled: Boolean(hostId),
  });

  const {
    register,
    handleSubmit,
    reset,
    watch,
    formState: { errors },
  } = useForm<FormValues>({ defaultValues: emptyValues });

  useEffect(() => {
    if (!hostId) return;
    if (host) {
      reset({
        label: host.label,
        address: host.address,
        port: host.port,
        identityId: host.identityId ?? "",
        username: host.username ?? "",
        authType: (host.authType ?? "password") as AuthType,
        password: host.password ?? "",
        keyId: host.keyId ?? "",
        groupId: host.groupId ?? "",
        notes: host.notes ?? "",
      });
    }
  }, [host, hostId, reset]);

  const authType = watch("authType");
  const identityId = watch("identityId");
  const useIdentity = Boolean(identityId);

  const onSubmit = handleSubmit(async (values) => {
    const base = {
      label: values.label.trim(),
      address: values.address.trim(),
      port: Number(values.port) || 22,
      groupId: values.groupId || null,
      notes: values.notes.trim() || null,
    };

    const input: HostInput = values.identityId
      ? {
          ...base,
          identityId: values.identityId,
          username: null,
          authType: null,
          keyId: null,
        }
      : {
          ...base,
          identityId: null,
          username: values.username.trim() || null,
          authType: values.authType,
          keyId: values.authType === "key" ? values.keyId || null : null,
          // Always send the field value for password auth so clearing it
          // removes the stored secret; an empty string clears the column.
          password:
            values.authType === "password" ? values.password : undefined,
        };

    try {
      if (hostId) {
        await updateHost.mutateAsync({ id: hostId, input });
      } else {
        await createHost.mutateAsync(input);
      }
      await emitRefresh();
      await closeSelf();
    } catch (err) {
      toast.error(t("hostForm.saveError"), errorMessage(err));
    }
  });

  const title = hostId ? t("windowTitles.editHost") : t("windowTitles.newHost");

  if (hostId && isLoading) {
    return (
      <div className="flex h-full flex-col bg-background">
        <WindowHeader title={title} />
        <div className="flex flex-1 items-center justify-center">
          <Spinner />
        </div>
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col bg-background">
      <WindowHeader title={title} />
      <form
        onSubmit={onSubmit}
        className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto p-5"
      >
        <div className="grid grid-cols-2 gap-3">
          <Field
            label={t("hostForm.label")}
            error={errors.label?.message}
            required
          >
            <Input
              placeholder={t("hostForm.labelPlaceholder")}
              {...register("label", { required: t("hostForm.labelRequired") })}
            />
          </Field>
          <Field label={t("hostForm.group")}>
            <Select {...register("groupId")}>
              <option value="">{t("hostForm.noGroup")}</option>
              {groups.map((g) => (
                <option key={g.id} value={g.id}>
                  {g.name}
                </option>
              ))}
            </Select>
          </Field>
        </div>

        <div className="grid grid-cols-[1fr_7rem] gap-3">
          <Field
            label={t("hostForm.address")}
            error={errors.address?.message}
            required
          >
            <Input
              placeholder={t("hostForm.addressPlaceholder")}
              {...register("address", {
                required: t("hostForm.addressRequired"),
              })}
            />
          </Field>
          <Field label={t("hostForm.port")}>
            <Input type="number" {...register("port")} />
          </Field>
        </div>

        {identities.length > 0 && (
          <Field
            label={t("hostForm.credentials")}
            hint={useIdentity ? t("hostForm.usingIdentityHint") : undefined}
          >
            <Select {...register("identityId")}>
              <option value="">{t("hostForm.customCredentials")}</option>
              {identities.map((id) => (
                <option key={id.id} value={id.id}>
                  {id.name} ({id.username})
                </option>
              ))}
            </Select>
          </Field>
        )}

        {!useIdentity && (
          <div className="grid grid-cols-2 gap-3">
            <Field label={t("hostForm.username")}>
              <Input
                placeholder={t("hostForm.usernamePlaceholder")}
                {...register("username")}
              />
            </Field>
            <Field label={t("hostForm.authentication")}>
              <Select {...register("authType")}>
                <option value="password">{t("common.auth.password")}</option>
                <option value="key">{t("common.auth.key")}</option>
                <option value="agent">{t("common.auth.agent")}</option>
              </Select>
            </Field>
          </div>
        )}

        {!useIdentity && authType === "password" && (
          <Field label={t("hostForm.password")}>
            <PasswordInput
              placeholder="••••••••"
              autoComplete="off"
              {...register("password")}
            />
          </Field>
        )}

        {!useIdentity && authType === "key" && (
          <Field
            label={t("hostForm.sshKey")}
            hint={keys.length === 0 ? t("hostForm.noKeysHint") : undefined}
          >
            <Select {...register("keyId")}>
              <option value="">{t("common.selectKey")}</option>
              {keys.map((k) => (
                <option key={k.id} value={k.id}>
                  {k.name}
                </option>
              ))}
            </Select>
          </Field>
        )}

        <Field label={t("hostForm.notes")}>
          <Textarea
            rows={2}
            placeholder={t("hostForm.notesPlaceholder")}
            {...register("notes")}
          />
        </Field>

        <div className="mt-auto flex justify-end gap-2 pt-2">
          <Button type="button" variant="ghost" onClick={() => closeSelf()}>
            {t("common.cancel")}
          </Button>
          <Button
            type="submit"
            loading={createHost.isPending || updateHost.isPending}
          >
            {hostId ? t("hostForm.saveChanges") : t("hostForm.createHost")}
          </Button>
        </div>
      </form>
    </div>
  );
}
