import { useEffect } from "react";
import { useForm } from "react-hook-form";

import {
  Button,
  Dialog,
  DialogContent,
  DialogToolbar,
  Field,
  Input,
} from "@/components/ui";
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
  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent
        showClose={false}
        className="flex w-[420px] max-w-[92vw] flex-col gap-0 p-0"
      >
        <GroupFormBody groupId={groupId} onClose={onClose} />
      </DialogContent>
    </Dialog>
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
    reset,
    setFocus,
    formState: { errors },
  } = useForm<FormValues>({ defaultValues: { name: "" } });

  useEffect(() => {
    if (group) reset({ name: group.name });
  }, [group, reset]);

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
    <>
      <DialogToolbar>
        {groupId ? t("groupForm.editTitle") : t("groupForm.newTitle")}
      </DialogToolbar>
      <form onSubmit={onSubmit} className="flex flex-col gap-4 p-5">
        <Field
          label={t("groupForm.name")}
          error={errors.name?.message}
          required
        >
          <Input
            placeholder={t("groupForm.namePlaceholder")}
            {...register("name", { required: t("groupForm.nameRequired") })}
          />
        </Field>

        <div className="flex justify-end gap-2">
          <Button type="button" variant="ghost" onClick={onClose}>
            {t("common.cancel")}
          </Button>
          <Button
            type="submit"
            loading={createGroup.isPending || updateGroup.isPending}
          >
            {groupId ? t("common.save") : t("common.create")}
          </Button>
        </div>
      </form>
    </>
  );
}
