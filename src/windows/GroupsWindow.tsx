import { useEffect } from "react";
import { useForm } from "react-hook-form";

import { Button, Field, Input } from "@/components/ui";
import { useI18n } from "@/i18n";
import { errorMessage, toast } from "@/lib/toast";
import { closeSelf, emitRefresh } from "@/lib/windows";
import { useCreateGroup, useGroups, useUpdateGroup } from "@/features/hosts/api";

interface FormValues {
  name: string;
}

export function GroupsWindow({ groupId }: { groupId: string | null }) {
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
      await emitRefresh();
      await closeSelf();
    } catch (err) {
      toast.error(t("groups.saveError"), errorMessage(err));
    }
  });

  return (
    <form
      onSubmit={onSubmit}
      className="flex h-full flex-col gap-4 bg-background p-5"
    >
      <Field label={t("groups.nameLabel")} error={errors.name?.message} required>
        <Input
          placeholder={t("groups.namePlaceholder")}
          {...register("name", { required: t("groups.nameRequired") })}
        />
      </Field>

      <div className="mt-auto flex justify-end gap-2 pt-2">
        <Button type="button" variant="ghost" onClick={() => closeSelf()}>
          {t("common.cancel")}
        </Button>
        <Button
          type="submit"
          loading={createGroup.isPending || updateGroup.isPending}
        >
          {groupId ? t("common.save") : t("common.add")}
        </Button>
      </div>
    </form>
  );
}
