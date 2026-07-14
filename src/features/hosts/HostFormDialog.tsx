import { useEffect } from "react";
import { useQuery } from "@tanstack/react-query";
import { Controller, useForm } from "react-hook-form";

import {
  Field,
  FormBody,
  FormDialog,
  FormLoading,
  Input,
  PasswordInput,
  Select,
  Textarea,
} from "@/components/ui";
import { useI18n } from "@/i18n";
import { ipc } from "@/lib/ipc";
import { errorMessage, toast } from "@/lib/toast";
import type { AuthType, HostInput } from "@/types/models";
import { useIdentities, useSshKeys } from "@/features/credentials/api";
import {
  hostKeys,
  useCreateHost,
  useGroups,
  useHosts,
  useUpdateHost,
} from "./api";

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
  jumpHostId: string;
  startupCommand: string;
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
  jumpHostId: "",
  startupCommand: "",
  notes: "",
};

export function HostFormDialog({
  open,
  hostId,
  onClose,
}: {
  open: boolean;
  hostId: string | null;
  onClose: () => void;
}) {
  const { t } = useI18n();
  return (
    <FormDialog
      open={open}
      onClose={onClose}
      width="w-[560px]"
      title={hostId ? t("hostForm.editTitle") : t("hostForm.newTitle")}
    >
      <HostFormBody hostId={hostId} onClose={onClose} />
    </FormDialog>
  );
}

function HostFormBody({
  hostId,
  onClose,
}: {
  hostId: string | null;
  onClose: () => void;
}) {
  const { t } = useI18n();
  const { data: groups = [] } = useGroups();
  const { data: hosts = [] } = useHosts();
  const { data: keys = [], isLoading: keysLoading } = useSshKeys();
  const { data: identities = [], isLoading: identitiesLoading } =
    useIdentities();
  const createHost = useCreateHost();
  const updateHost = useUpdateHost();

  const { data: host, isLoading } = useQuery({
    queryKey: hostKeys.detail(hostId ?? ""),
    queryFn: () => ipc.hosts.get(hostId!),
    enabled: Boolean(hostId),
  });

  const {
    control,
    register,
    handleSubmit,
    reset,
    resetField,
    watch,
    formState: { errors },
  } = useForm<FormValues>({ defaultValues: emptyValues });

  useEffect(() => {
    if (!hostId) return;

    if (host && !identitiesLoading && !keysLoading) {
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
        jumpHostId: host.jumpHostId ?? "",
        startupCommand: host.startupCommand ?? "",
        notes: host.notes ?? "",
      });
    }
  }, [host, hostId, identitiesLoading, keysLoading, reset]);

  const authType = watch("authType");
  const identityId = watch("identityId");
  const useIdentity = Boolean(identityId);

  const onSubmit = handleSubmit(async (values) => {
    const base = {
      label: values.label.trim(),
      address: values.address.trim(),
      port: values.port,
      groupId: values.groupId || null,
      jumpHostId: values.jumpHostId || null,
      osHint: host?.osHint ?? null,
      startupCommand: values.startupCommand.trim() || null,
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

          password:
            values.authType === "password" ? values.password : undefined,
        };

    try {
      if (hostId) {
        await updateHost.mutateAsync({ id: hostId, input });
      } else {
        await createHost.mutateAsync(input);
      }
      onClose();
    } catch (err) {
      toast.error(t("hostForm.saveError"), errorMessage(err));
    }
  });

  if (hostId && isLoading) return <FormLoading />;

  return (
    <FormBody
      onClose={onClose}
      onSubmit={onSubmit}
      submitLabel={hostId ? t("common.saveChanges") : t("hostForm.create")}
      pending={createHost.isPending || updateHost.isPending}
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
          <Controller
            control={control}
            name="groupId"
            render={({ field }) => (
              <Select
                value={field.value}
                onValueChange={field.onChange}
                onBlur={field.onBlur}
                options={[
                  { value: "", label: t("hostForm.noGroup") },
                  ...groups.map((group) => ({
                    value: group.id,
                    label: group.name,
                  })),
                ]}
              />
            )}
          />
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
        <Field label={t("hostForm.port")} error={errors.port?.message}>
          <Input
            type="number"
            min={1}
            max={65535}
            step={1}
            {...register("port", {
              valueAsNumber: true,
              required: t("hostForm.portInvalid"),
              min: { value: 1, message: t("hostForm.portInvalid") },
              max: { value: 65535, message: t("hostForm.portInvalid") },
              validate: (value) =>
                Number.isInteger(value) || t("hostForm.portInvalid"),
            })}
          />
        </Field>
      </div>

      {identities.length > 0 && (
        <Field
          label={t("hostForm.credentials")}
          hint={useIdentity ? t("hostForm.usingIdentityHint") : undefined}
        >
          <Controller
            control={control}
            name="identityId"
            render={({ field }) => (
              <Select
                value={field.value}
                onValueChange={(value) => {
                  field.onChange(value);
                  if (!value) return;
                  resetField("username");
                  resetField("authType");
                  resetField("password");
                  resetField("keyId");
                }}
                onBlur={field.onBlur}
                options={[
                  { value: "", label: t("hostForm.customCredentials") },
                  ...identities.map((identity) => ({
                    value: identity.id,
                    label: `${identity.name} (${identity.username})`,
                  })),
                ]}
              />
            )}
          />
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
            <Controller
              control={control}
              name="authType"
              render={({ field }) => (
                <Select
                  value={field.value}
                  onValueChange={field.onChange}
                  onBlur={field.onBlur}
                  options={[
                    {
                      value: "password",
                      label: t("common.auth.password"),
                    },
                    { value: "key", label: t("common.auth.key") },
                    { value: "agent", label: t("common.auth.agent") },
                  ]}
                />
              )}
            />
          </Field>
        </div>
      )}

      {!useIdentity && authType === "password" && (
        <Field
          label={t("hostForm.password")}
          hint={hostId ? t("hostForm.passwordKeepHint") : undefined}
        >
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
          <Controller
            control={control}
            name="keyId"
            render={({ field }) => (
              <Select
                value={field.value}
                onValueChange={field.onChange}
                onBlur={field.onBlur}
                options={[
                  { value: "", label: t("hostForm.selectKey") },
                  ...keys.map((key) => ({
                    value: key.id,
                    label: key.name,
                  })),
                ]}
              />
            )}
          />
        </Field>
      )}

      <Field label={t("hostForm.jumpHost")} hint={t("hostForm.jumpHostHint")}>
        <Controller
          control={control}
          name="jumpHostId"
          render={({ field }) => (
            <Select
              value={field.value}
              onValueChange={field.onChange}
              onBlur={field.onBlur}
              options={[
                { value: "", label: t("hostForm.noJumpHost") },
                ...hosts
                  .filter((host) => host.id !== hostId)
                  .map((host) => ({
                    value: host.id,
                    label: host.label,
                  })),
              ]}
            />
          )}
        />
      </Field>

      <Field
        label={t("hostForm.startupCommand")}
        hint={t("hostForm.startupCommandHint")}
      >
        <Textarea
          rows={2}
          placeholder={t("hostForm.startupCommandPlaceholder")}
          className="font-mono text-xs"
          {...register("startupCommand")}
        />
      </Field>

      <Field label={t("hostForm.notes")}>
        <Textarea
          rows={2}
          placeholder={t("hostForm.notesPlaceholder")}
          {...register("notes")}
        />
      </Field>
    </FormBody>
  );
}
