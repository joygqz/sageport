import { useEffect } from "react";
import { Controller, useForm } from "react-hook-form";

import { Field, FormBody, FormDialog, Input, Select } from "@/components/ui";
import { useI18n } from "@/i18n";
import { errorMessage, toast } from "@/lib/toast";
import { useCreateGroup, useGroups, useUpdateGroup } from "./api";

interface FormValues {
  name: string;
  parentId: string;
}

export function GroupFormDialog({
  open,
  groupId,
  onClose,
}: {
  open: boolean;
  groupId: string | null;
  onClose: () => void;
}) {
  const { t } = useI18n();
  return (
    <FormDialog
      open={open}
      onClose={onClose}
      width="w-[420px]"
      title={groupId ? t("groupForm.editTitle") : t("groupForm.newTitle")}
    >
      <GroupFormBody groupId={groupId} onClose={onClose} />
    </FormDialog>
  );
}

function GroupFormBody({
  groupId,
  onClose,
}: {
  groupId: string | null;
  onClose: () => void;
}) {
  const { t } = useI18n();
  const { data: groups = [] } = useGroups();
  const createGroup = useCreateGroup();
  const updateGroup = useUpdateGroup();

  const group = groupId ? groups.find((g) => g.id === groupId) : undefined;

  const {
    register,
    handleSubmit,
    control,
    reset,
    setFocus,
    formState: { errors },
  } = useForm<FormValues>({
    defaultValues: { name: "", parentId: "" },
  });

  useEffect(() => {
    reset({ name: group?.name ?? "", parentId: group?.parentId ?? "" });
    setFocus("name");
  }, [group, reset, setFocus]);

  const unavailable = new Set<string>();
  if (groupId) {
    unavailable.add(groupId);
    let changed = true;
    while (changed) {
      changed = false;
      for (const candidate of groups) {
        if (
          candidate.parentId &&
          unavailable.has(candidate.parentId) &&
          !unavailable.has(candidate.id)
        ) {
          unavailable.add(candidate.id);
          changed = true;
        }
      }
    }
  }

  const onSubmit = handleSubmit(async (values) => {
    const input = {
      name: values.name.trim(),
      parentId: values.parentId || null,
      sortOrder: group?.sortOrder ?? 0,
    };
    try {
      if (groupId) {
        await updateGroup.mutateAsync({ id: groupId, input });
      } else {
        await createGroup.mutateAsync(input);
      }
      onClose();
    } catch (err) {
      toast.error(t("groupForm.saveError"), errorMessage(err));
    }
  });

  return (
    <FormBody
      onClose={onClose}
      onSubmit={onSubmit}
      submitLabel={groupId ? t("common.save") : t("common.create")}
      pending={createGroup.isPending || updateGroup.isPending}
    >
      <Field label={t("groupForm.name")} error={errors.name?.message} required>
        <Input
          placeholder={t("groupForm.namePlaceholder")}
          {...register("name", { required: t("groupForm.nameRequired") })}
        />
      </Field>
      <Field label={t("groupForm.parent")} hint={t("groupForm.parentHint")}>
        <Controller
          control={control}
          name="parentId"
          render={({ field }) => (
            <Select
              value={field.value}
              onValueChange={field.onChange}
              onBlur={field.onBlur}
              options={[
                { value: "", label: t("groupForm.noParent") },
                ...groups
                  .filter((candidate) => !unavailable.has(candidate.id))
                  .map((candidate) => ({
                    value: candidate.id,
                    label: candidate.name,
                  })),
              ]}
            />
          )}
        />
      </Field>
    </FormBody>
  );
}
