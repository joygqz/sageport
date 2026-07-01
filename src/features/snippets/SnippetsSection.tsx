import { useState } from "react";
import { Play, Plus, ScrollText, Trash2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { Field } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Tooltip } from "@/components/ui/tooltip";
import { useI18n } from "@/i18n";
import { errorMessage, toast } from "@/lib/toast";
import { emitAction, emitRefresh } from "@/lib/windows";
import {
  useCreateSnippet,
  useDeleteSnippet,
  useSnippets,
} from "@/features/credentials/api";

export function SnippetsSection() {
  const { t } = useI18n();
  const { data: snippets = [] } = useSnippets();
  const createSnippet = useCreateSnippet();
  const deleteSnippet = useDeleteSnippet();

  const [adding, setAdding] = useState(false);
  const [name, setName] = useState("");
  const [command, setCommand] = useState("");
  const [description, setDescription] = useState("");

  const reset = () => {
    setName("");
    setCommand("");
    setDescription("");
    setAdding(false);
  };

  const submit = async () => {
    if (!name.trim() || !command.trim()) {
      return toast.error(t("snippets.nameCommandRequired"));
    }
    try {
      await createSnippet.mutateAsync({
        name: name.trim(),
        command: command.trim(),
        description: description.trim() || null,
      });
      await emitRefresh();
      toast.success(t("snippets.savedTitle"), name.trim());
      reset();
    } catch (err) {
      toast.error(t("snippets.saveError"), errorMessage(err));
    }
  };

  const remove = async (id: string) => {
    await deleteSnippet.mutateAsync(id);
    await emitRefresh();
  };

  // Snippets live in the Settings window; ask the main window to run it.
  const run = (cmd: string) => {
    void emitAction({ type: "run-command", command: cmd });
    toast.success(t("common.sentToTerminal"));
  };

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center justify-between">
        <p className="text-sm text-muted-foreground">
          {t("snippets.description")}
        </p>
        {!adding && (
          <Button size="sm" variant="secondary" onClick={() => setAdding(true)}>
            <Plus /> {t("snippets.newSnippet")}
          </Button>
        )}
      </div>

      {adding && (
        <div className="flex flex-col gap-3 rounded-lg border border-border p-3">
          <Field label={t("snippets.name")} required>
            <Input
              autoFocus
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder={t("snippets.namePlaceholder")}
            />
          </Field>
          <Field label={t("snippets.command")} required>
            <Textarea
              rows={3}
              value={command}
              onChange={(e) => setCommand(e.target.value)}
              placeholder={t("snippets.commandPlaceholder")}
              className="font-mono text-xs"
            />
          </Field>
          <Field label={t("snippets.descriptionLabel")}>
            <Input
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder={t("snippets.descriptionPlaceholder")}
            />
          </Field>
          <div className="flex justify-end gap-2">
            <Button variant="ghost" size="sm" onClick={reset}>
              {t("common.cancel")}
            </Button>
            <Button size="sm" onClick={submit} loading={createSnippet.isPending}>
              {t("snippets.saveSnippet")}
            </Button>
          </div>
        </div>
      )}

      {snippets.length === 0 && !adding ? (
        <EmptyState
          icon={ScrollText}
          title={t("snippets.emptyTitle")}
          description={t("snippets.emptyDescription")}
        />
      ) : (
        <div className="flex flex-col gap-1">
          {snippets.map((s) => (
            <div
              key={s.id}
              className="flex items-center gap-2 rounded-md border border-border px-3 py-2"
            >
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium">{s.name}</p>
                <p className="truncate font-mono text-xs text-muted-foreground">
                  {s.command}
                </p>
              </div>
              <Tooltip content={t("common.runInTerminal")}>
                <Button
                  size="icon"
                  variant="ghost"
                  className="size-7"
                  onClick={() => run(s.command)}
                >
                  <Play className="size-3.5" />
                </Button>
              </Tooltip>
              <Button
                size="icon"
                variant="ghost"
                className="size-7"
                onClick={() => remove(s.id)}
              >
                <Trash2 className="size-3.5" />
              </Button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
