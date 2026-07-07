import { useEffect } from "react";
import { useForm } from "react-hook-form";

import { Field, FormBody, FormDialog, Input } from "@/components/ui";
import { useI18n } from "@/i18n";
import { errorMessage, toast } from "@/lib/toast";
import { useCreateGroup, useGroups, useUpdateGroup } from "./api";

interface FormValues {
  name: string;
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
    setFocus,
    formState: { errors },
  } = useForm<FormValues>({ defaultValues: { name: group?.name ?? "" } });

  useEffect(() => {
    setFocus("name");
  }, [setFocus]);

  const onSubmit = handleSubmit(async (values) => {
    const input = { name: values.name.trim() };
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
    </FormBody>
  );
}
