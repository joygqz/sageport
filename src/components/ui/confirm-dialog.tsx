import type { ButtonProps } from "./button";
import { Button } from "./button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "./dialog";

export interface ConfirmAction {
  label: string;
  variant?: ButtonProps["variant"];
  loading?: boolean;
  disabled?: boolean;
  onSelect: () => void | Promise<void>;
}

export interface ConfirmState {
  title: string;
  description?: string;
  cancelLabel: string;
  /** Rendered left-to-right after the cancel button; last one is typically the primary/destructive action. */
  actions: ConfirmAction[];
}

/** A themed stand-in for native confirm dialogs, supporting more than one action (e.g. destructive vs. non-destructive choices). */
export function ConfirmDialog({
  state,
  onClose,
}: {
  state: ConfirmState | null;
  onClose: () => void;
}) {
  const busy = state?.actions.some((action) => action.loading) ?? false;

  return (
    <Dialog open={!!state} onOpenChange={(open) => !open && !busy && onClose()}>
      <DialogContent className="max-w-sm">
        {state && (
          <>
            <DialogHeader>
              <DialogTitle>{state.title}</DialogTitle>
              {state.description && (
                <DialogDescription>{state.description}</DialogDescription>
              )}
            </DialogHeader>
            <DialogFooter>
              <Button variant="ghost" onClick={onClose} disabled={busy}>
                {state.cancelLabel}
              </Button>
              {state.actions.map((action) => (
                <Button
                  key={action.label}
                  variant={action.variant ?? "primary"}
                  loading={action.loading}
                  disabled={action.disabled || busy}
                  onClick={async () => {
                    await action.onSelect();
                    onClose();
                  }}
                >
                  {action.label}
                </Button>
              ))}
            </DialogFooter>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
