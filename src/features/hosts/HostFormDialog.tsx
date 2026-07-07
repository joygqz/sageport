import { useEffect, type ChangeEvent } from "react";
import { useQuery } from "@tanstack/react-query";
import { useForm } from "react-hook-form";

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
import { useCreateHost, useGroups, useUpdateHost } from "./api";

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
  const { data: keys = [], isLoading: keysLoading } = useSshKeys();
  const { data: identities = [], isLoading: identitiesLoading } =
    useIdentities();
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
          <Select
            {...register("identityId", {
              onChange: (e: ChangeEvent<HTMLSelectElement>) => {
                if (!e.target.value) return;
                resetField("username");
                resetField("authType");
                resetField("password");
                resetField("keyId");
              },
            })}
          >
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
          <Select {...register("keyId")}>
            <option value="">{t("hostForm.selectKey")}</option>
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
    </FormBody>
  );
}
