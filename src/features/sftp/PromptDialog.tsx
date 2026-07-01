import { useState } from "react";

import {
  Button,
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  Input,
} from "@/components/ui";
import { useI18n } from "@/i18n";

export interface PromptState {
  title: string;
  initial: string;
  confirmLabel: string;
  onConfirm: (value: string) => void;
}

/** A tiny single-input modal used for "new folder" and "rename". */
export function PromptDialog({
  state,
  onClose,
}: {
  state: PromptState | null;
  onClose: () => void;
}) {
  return (
    <Dialog open={!!state} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-w-sm">
        {/* Mount fresh per open so the field initializes without an effect. */}
        {state && <PromptForm state={state} onClose={onClose} />}
      </DialogContent>
    </Dialog>
  );
}

function PromptForm({
  state,
  onClose,
}: {
  state: PromptState;
  onClose: () => void;
}) {
  const { t } = useI18n();
  const [value, setValue] = useState(state.initial);

  const submit = () => {
    const trimmed = value.trim();
    if (!trimmed) return;
    state.onConfirm(trimmed);
    onClose();
  };

  return (
    <>
      <DialogHeader>
        <DialogTitle>{state.title}</DialogTitle>
      </DialogHeader>
      <Input
        autoFocus
        value={value}
        onChange={(e) => setValue(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") submit();
        }}
      />
      <DialogFooter>
        <Button variant="ghost" onClick={onClose}>
          {t("common.cancel")}
        </Button>
        <Button onClick={submit}>{state.confirmLabel}</Button>
      </DialogFooter>
    </>
  );
}
