import { useState } from "react";

import { FormBody, FormDialog, Input } from "@/components/ui";

export interface PromptState {
  title: string;
  initial: string;
  confirmLabel: string;
  onConfirm: (value: string) => void;
}

export function PromptDialog({
  state,
  onClose,
}: {
  state: PromptState | null;
  onClose: () => void;
}) {
  return (
    <FormDialog
      open={!!state}
      onClose={onClose}
      width="w-[420px]"
      title={state?.title}
    >
      {state && <PromptForm state={state} onClose={onClose} />}
    </FormDialog>
  );
}

function PromptForm({
  state,
  onClose,
}: {
  state: PromptState;
  onClose: () => void;
}) {
  const [value, setValue] = useState(state.initial);

  const submit = () => {
    const trimmed = value.trim();
    if (!trimmed) return;
    state.onConfirm(trimmed);
    onClose();
  };

  return (
    <FormBody
      onClose={onClose}
      onSubmit={submit}
      submitLabel={state.confirmLabel}
    >
      <Input
        autoFocus
        value={value}
        onChange={(e) => setValue(e.target.value)}
      />
    </FormBody>
  );
}
