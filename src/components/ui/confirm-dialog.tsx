import type { ButtonProps } from "./button";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogTitle,
} from "./alert-dialog";
import { Button } from "./button";
import { DialogFooter, DialogHeader } from "./dialog";

export interface ConfirmAction {
  label: string;
  variant?: ButtonProps["variant"];
  loading?: boolean;
  disabled?: boolean;
  /** Return false to keep the confirmation open after an unsuccessful action. */
  onSelect: () => void | boolean | Promise<void | boolean>;
}

export interface ConfirmState {
  title: string;
  description?: ReactNode;
  cancelLabel: string;

  actions: ConfirmAction[];
}

export function ConfirmDialog({
  state,
  onClose,
}: {
  state: ConfirmState | null;
  onClose: () => void;
}) {
  const busy = state?.actions.some((action) => action.loading) ?? false;

  return (
    <AlertDialog
      open={!!state}
      onOpenChange={(open) => !open && !busy && onClose()}
    >
      <AlertDialogContent className="max-w-sm">
        {state && (
          <>
            <DialogHeader>
              <AlertDialogTitle>{state.title}</AlertDialogTitle>
              {state.description && (
                <AlertDialogDescription>
                  {state.description}
                </AlertDialogDescription>
              )}
            </DialogHeader>
            <DialogFooter>
              <AlertDialogCancel asChild>
                <Button type="button" variant="ghost" disabled={busy}>
                  {state.cancelLabel}
                </Button>
              </AlertDialogCancel>
              {state.actions.map((action) => (
                <AlertDialogAction key={action.label} asChild>
                  <Button
                    type="button"
                    variant={action.variant ?? "primary"}
                    loading={action.loading}
                    disabled={action.disabled || busy}
                    onClick={async (event) => {
                      event.preventDefault();
                      if ((await action.onSelect()) !== false) onClose();
                    }}
                  >
                    {action.label}
                  </Button>
                </AlertDialogAction>
              ))}
            </DialogFooter>
          </>
        )}
      </AlertDialogContent>
    </AlertDialog>
  );
}
import type { ReactNode } from "react";
