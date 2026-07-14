import { useState } from "react";

import { Field, FormBody, FormDialog, Input } from "@/components/ui";
import { useI18n } from "@/i18n";
import type { Snippet } from "@/types/models";
import { parseVariables, substitute } from "./variables";

export function SnippetRunDialog({
  snippet,
  onClose,
  onRun,
}: {
  snippet: Snippet | null;
  onClose: () => void;
  onRun: (command: string) => void;
}) {
  return (
    <FormDialog
      open={Boolean(snippet)}
      onClose={onClose}
      width="w-[480px]"
      title={snippet?.name ?? ""}
    >
      {snippet && <RunBody snippet={snippet} onClose={onClose} onRun={onRun} />}
    </FormDialog>
  );
}

function RunBody({
  snippet,
  onClose,
  onRun,
}: {
  snippet: Snippet;
  onClose: () => void;
  onRun: (command: string) => void;
}) {
  const { t } = useI18n();
  const variables = parseVariables(snippet.command);
  const [values, setValues] = useState<Record<string, string>>(() =>
    Object.fromEntries(variables.map((v) => [v.name, v.defaultValue])),
  );

  const preview = substitute(snippet.command, values);

  const isFilled = (variable: (typeof variables)[number]) =>
    Boolean(variable.defaultValue) ||
    (values[variable.name] ?? "").trim() !== "";
  const canRun = variables.every(isFilled);

  return (
    <FormBody
      onClose={onClose}
      onSubmit={() => {
        if (!canRun) return;
        onRun(preview);
        onClose();
      }}
      submitLabel={t("snippets.run")}
      submitDisabled={!canRun}
    >
      {variables.map((variable, index) => (
        <Field
          key={variable.name}
          label={variable.name}
          required={!variable.defaultValue}
        >
          <Input
            autoFocus={index === 0}
            value={values[variable.name] ?? ""}
            placeholder={variable.defaultValue}
            onChange={(e) =>
              setValues((prev) => ({
                ...prev,
                [variable.name]: e.target.value,
              }))
            }
          />
        </Field>
      ))}
      <div className="rounded-lg border border-border bg-surface p-3">
        <p className="whitespace-pre-wrap break-all font-mono text-xs text-muted-foreground">
          {preview}
        </p>
      </div>
    </FormBody>
  );
}
