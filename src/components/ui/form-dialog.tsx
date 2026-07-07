import type { ReactNode } from "react";

import { useI18n } from "@/i18n";
import { cn } from "@/lib/utils";
import { Button } from "./button";
import { Dialog, DialogContent, DialogToolbar } from "./dialog";
import { Spinner } from "./spinner";

interface FormDialogProps {
  open: boolean;
  onClose: () => void;
  title: ReactNode;
  width?: string;
  children: ReactNode;
}

export function FormDialog({
  open,
  onClose,
  title,
  width = "w-[460px]",
  children,
}: FormDialogProps) {
  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent
        showClose={false}
        className={cn("flex max-w-[92vw] flex-col gap-0 p-0", width)}
      >
        <DialogToolbar>{title}</DialogToolbar>
        {open && children}
      </DialogContent>
    </Dialog>
  );
}

interface FormBodyProps {
  onClose: () => void;
  onSubmit: () => void | Promise<void>;
  submitLabel: ReactNode;
  pending?: boolean;
  footerStart?: ReactNode;
  children: ReactNode;
}

export function FormBody({
  onClose,
  onSubmit,
  submitLabel,
  pending,
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
      className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto p-5"
    >
      {children}
      <div className="mt-auto flex items-center justify-end gap-2 pt-2">
        {footerStart && <div className="mr-auto">{footerStart}</div>}
        <Button type="button" variant="ghost" onClick={onClose}>
          {t("common.cancel")}
        </Button>
        <Button type="submit" loading={pending}>
          {submitLabel}
        </Button>
      </div>
    </form>
  );
}

export function FormLoading() {
  return (
    <div className="flex min-h-48 flex-1 items-center justify-center">
      <Spinner />
    </div>
  );
}
