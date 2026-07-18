import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Controller, useForm } from "react-hook-form";

import {
  Field,
  Button,
  ErrorState,
  FormBody,
  FormDialog,
  FormLoading,
  Input,
  PasswordInput,
  Select,
  TreeSelect,
  SwitchField,
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
import { passwordSubmissionValue } from "./hostForm";

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
  requiresApproval: boolean;
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
  requiresApproval: false,
};

export function HostFormDialog({
  open,
  hostId,
  initialGroupId,
  onClose,
}: {
  open: boolean;
  hostId: string | null;
  initialGroupId: string | null;
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
      <HostFormBody
        key={hostId ?? `new:${initialGroupId ?? "ungrouped"}`}
        hostId={hostId}
        initialGroupId={initialGroupId}
        onClose={onClose}
      />
    </FormDialog>
  );
}

function HostFormBody({
  hostId,
  initialGroupId,
  onClose,
}: {
  hostId: string | null;
  initialGroupId: string | null;
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
  const [clearSavedPassword, setClearSavedPassword] = useState(false);

  const {
    data: host,
    isLoading,
    isError,
    refetch,
  } = useQuery({
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
    getValues,
    setValue,
    watch,
    formState: { errors },
  } = useForm<FormValues>({
    defaultValues: { ...emptyValues, groupId: initialGroupId ?? "" },
  });
  const [passwordEdited, setPasswordEdited] = useState(false);

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
        password: "",
        keyId: host.keyId ?? "",
        groupId: host.groupId ?? "",
        jumpHostId: host.jumpHostId ?? "",
        startupCommand: host.startupCommand ?? "",
        notes: host.notes ?? "",
        requiresApproval: host.requiresApproval,
      });
      setClearSavedPassword(false);
      setPasswordEdited(false);
    }
  }, [host, hostId, identitiesLoading, keysLoading, reset]);

  const authType = watch("authType");
  const identityId = watch("identityId");
  const useIdentity = Boolean(identityId);

  const revealSavedPassword = async () => {
    if (getValues("password")) return true;
    if (!hostId || !host?.hasPassword) return true;
    try {
      const password = await ipc.hosts.revealPassword(hostId);
      setValue("password", password, { shouldDirty: false });
      setPasswordEdited(false);
      return true;
    } catch (error) {
      toast.error(t("hostForm.passwordRevealError"), errorMessage(error));
      return false;
    }
  };

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
      requiresApproval: values.requiresApproval,
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

          password: passwordSubmissionValue({
            authType: values.authType,
            value: hostId && !passwordEdited ? "" : values.password,
            clearSavedPassword,
          }),
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
  if (hostId && isError) {
    return (
      <ErrorState
        title={t("common.loadError")}
        retryLabel={t("common.retry")}
        onRetry={() => void refetch()}
        fill
      />
    );
  }

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
              <TreeSelect
                value={field.value}
                onValueChange={field.onChange}
                onBlur={field.onBlur}
                rootOption={{ value: "", label: t("hostForm.noGroup") }}
                nodes={groups.map((group) => ({
                  value: group.id,
                  label: group.name,
                  parentValue: group.parentId,
                }))}
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
          <Field
            label={t("hostForm.username")}
            error={errors.username?.message}
            required
          >
            <Input
              placeholder={t("hostForm.usernamePlaceholder")}
              {...register("username", {
                required: t("hostForm.usernameRequired"),
              })}
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
        <div className="space-y-2">
          <Field
            label={t("hostForm.password")}
            hint={
              clearSavedPassword
                ? t("hostForm.passwordWillClear")
                : hostId
                  ? t("hostForm.passwordKeepHint")
                  : undefined
            }
          >
            <PasswordInput
              placeholder="••••••••"
              autoComplete="new-password"
              disabled={clearSavedPassword}
              onBeforeReveal={
                host?.hasPassword ? revealSavedPassword : undefined
              }
              {...register("password", {
                onChange: (event) => {
                  if (event.target.value) setClearSavedPassword(false);
                  setPasswordEdited(true);
                },
              })}
            />
          </Field>
          {host?.hasPassword && (
            <Button
              type="button"
              size="sm"
              variant="ghost"
              className="h-auto px-0 py-0 text-xs text-muted-foreground hover:bg-transparent hover:text-foreground"
              onClick={() => {
                if (!clearSavedPassword) resetField("password");
                setPasswordEdited(false);
                setClearSavedPassword((value) => !value);
              }}
            >
              {clearSavedPassword
                ? t("hostForm.passwordClearUndo")
                : t("hostForm.passwordClear")}
            </Button>
          )}
        </div>
      )}

      {!useIdentity && authType === "key" && (
        <Field
          label={t("hostForm.sshKey")}
          error={errors.keyId?.message}
          hint={keys.length === 0 ? t("hostForm.noKeysHint") : undefined}
          required
        >
          <Controller
            control={control}
            name="keyId"
            rules={{ required: t("hostForm.keyRequired") }}
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

      <Controller
        control={control}
        name="requiresApproval"
        render={({ field }) => (
          <SwitchField
            fieldLabel={t("hostForm.approval")}
            label={t("hostForm.approvalToggle")}
            description={t("hostForm.approvalHint")}
            checked={field.value}
            onCheckedChange={field.onChange}
          />
        )}
      />
    </FormBody>
  );
}
