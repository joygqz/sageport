import { useState } from "react";

import { Field, FormBody, FormDialog, Input, Textarea } from "@/components/ui";
import { useI18n } from "@/i18n";
import { errorMessage, toast } from "@/lib/toast";
import type { Snippet } from "@/types/models";
import { useCreateSnippet, useUpdateSnippet } from "./api";

export function SnippetFormDialog({
  open,
  snippet,
  onClose,
}: {
  open: boolean;
  snippet: Snippet | null;
  onClose: () => void;
}) {
  const { t } = useI18n();
  return (
    <FormDialog
      open={open}
      onClose={onClose}
      width="w-[480px]"
      title={snippet ? t("snippets.editTitle") : t("snippets.newTitle")}
    >
      <SnippetFormBody snippet={snippet} onClose={onClose} />
    </FormDialog>
  );
}

function SnippetFormBody({
  snippet,
  onClose,
}: {
  snippet: Snippet | null;
  onClose: () => void;
}) {
  const { t } = useI18n();
  const createSnippet = useCreateSnippet();
  const updateSnippet = useUpdateSnippet();

  const [name, setName] = useState(snippet?.name ?? "");
  const [command, setCommand] = useState(snippet?.command ?? "");
  const [description, setDescription] = useState(snippet?.description ?? "");

  const submit = async () => {
    if (!name.trim() || !command.trim()) {
      return toast.error(t("snippets.nameCommandRequired"));
    }
    const input = {
      name: name.trim(),
      command: command.trim(),
      description: description.trim() || null,
    };
    try {
      if (snippet) {
        await updateSnippet.mutateAsync({ id: snippet.id, input });
      } else {
        await createSnippet.mutateAsync(input);
      }
      onClose();
    } catch (err) {
      toast.error(t("snippets.saveError"), errorMessage(err));
    }
  };

  return (
    <FormBody
      onClose={onClose}
      onSubmit={submit}
      submitLabel={snippet ? t("common.saveChanges") : t("common.create")}
      pending={createSnippet.isPending || updateSnippet.isPending}
    >
      <Field label={t("snippets.name")} required>
        <Input
          autoFocus
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder={t("snippets.namePlaceholder")}
        />
      </Field>
      <Field
        label={t("snippets.command")}
        hint={t("snippets.commandHint")}
        required
      >
        <Textarea
          rows={3}
          value={command}
          onChange={(e) => setCommand(e.target.value)}
          placeholder={t("snippets.commandPlaceholder")}
          className="font-mono text-xs"
        />
      </Field>
      <Field label={t("snippets.description")}>
        <Input
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          placeholder={t("snippets.descriptionPlaceholder")}
        />
      </Field>
    </FormBody>
  );
}
