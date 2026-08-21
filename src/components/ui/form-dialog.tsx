import type { ReactNode } from "react";

import { useI18n } from "@/i18n";
import { cn } from "@/lib/utils";
import { Button } from "./button";
import { Dialog, DialogContent, DialogToolbar } from "./dialog";
import { useDialogSnapshot } from "./use-dialog-snapshot";
import { Spinner } from "./spinner";

interface FormDialogProps {
  open: boolean;
  onClose: () => void;
  title: ReactNode;
  leading?: ReactNode;
  width?: string;
  children: ReactNode;
}

export function FormDialog({
  open,
  onClose,
  title,
  leading,
  width = "w-[var(--dialog-width-md)]",
  children,
}: FormDialogProps) {
  const shownTitle = useDialogSnapshot(open, title);
  const shownLeading = useDialogSnapshot(open, leading);
  const shownChildren = useDialogSnapshot(open, children);

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent
        showClose={false}
        scrollMode="content"
        className={cn("flex max-w-[92vw] flex-col gap-0 p-0 sm:p-0", width)}
      >
        <DialogToolbar leading={shownLeading}>{shownTitle}</DialogToolbar>
        {shownChildren}
      </DialogContent>
    </Dialog>
  );
}

interface FormBodyProps {
  onClose: () => void;
  onSubmit: () => void | Promise<void>;
  submitLabel: ReactNode;
  pending?: boolean;
  submitDisabled?: boolean;
  footerStart?: ReactNode;
  children: ReactNode;
}

export function FormBody({
  onClose,
  onSubmit,
  submitLabel,
  pending,
  submitDisabled,
  footerStart,
  children,
}: FormBodyProps) {
  const { t } = useI18n();
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        void onSubmit();
      }}
      className="flex min-h-0 flex-1 flex-col overflow-hidden"
    >
      <div className="ui-dialog-body overflow-y-auto">{children}</div>
      <div className="ui-dialog-footer border-t border-border-subtle bg-surface-sunken">
        {footerStart && <div className="mr-auto">{footerStart}</div>}
        <Button type="button" variant="ghost" onClick={onClose}>
          {t("common.cancel")}
        </Button>
        <Button type="submit" loading={pending} disabled={submitDisabled}>
          {submitLabel}
        </Button>
      </div>
    </form>
  );
}

export function FormLoading() {
  const { t } = useI18n();
  return (
    <div className="flex min-h-48 flex-1 items-center justify-center">
      <Spinner label={t("common.loading")} />
    </div>
  );
}
