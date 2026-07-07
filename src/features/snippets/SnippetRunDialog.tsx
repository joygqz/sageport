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
      {snippet && (
        <RunBody snippet={snippet} onClose={onClose} onRun={onRun} />
      )}
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

  return (
    <FormBody
      onClose={onClose}
      onSubmit={() => {
        onRun(preview);
        onClose();
      }}
      submitLabel={t("snippets.run")}
    >
      {variables.map((variable, index) => (
        <Field key={variable.name} label={variable.name}>
          <Input
            autoFocus={index === 0}
            value={values[variable.name] ?? ""}
            placeholder={variable.defaultValue}
            onChange={(e) =>
              setValues((prev) => ({ ...prev, [variable.name]: e.target.value }))
            }
          />
        </Field>
      ))}
      <div className="rounded-md border border-input bg-surface p-3">
        <p className="whitespace-pre-wrap break-all font-mono text-xs text-muted-foreground">
          {preview}
        </p>
      </div>
    </FormBody>
  );
}
