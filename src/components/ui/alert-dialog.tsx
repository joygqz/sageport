import type * as React from "react";
import * as AlertDialogPrimitive from "@radix-ui/react-alert-dialog";

import { cn } from "@/lib/utils";
import { DIALOG_CONTENT_CLASS, DIALOG_OVERLAY_CLASS } from "./dialog";

function AlertDialog(
  props: React.ComponentProps<typeof AlertDialogPrimitive.Root>,
) {
  return <AlertDialogPrimitive.Root data-slot="alert-dialog" {...props} />;
}

function AlertDialogContent({
  className,
  ref,
  ...props
}: React.ComponentProps<typeof AlertDialogPrimitive.Content> & {
  ref?: React.Ref<React.ComponentRef<typeof AlertDialogPrimitive.Content>>;
}) {
  return (
    <AlertDialogPrimitive.Portal>
      <AlertDialogPrimitive.Overlay
        data-slot="alert-dialog-overlay"
        className={DIALOG_OVERLAY_CLASS}
      />
      <AlertDialogPrimitive.Content
        ref={ref}
        data-slot="alert-dialog-content"
        className={cn(
          DIALOG_CONTENT_CLASS,
          "-translate-x-1/2 -translate-y-1/2",
          className,
        )}
        {...props}
      />
    </AlertDialogPrimitive.Portal>
  );
}

function AlertDialogCancel(
  props: React.ComponentProps<typeof AlertDialogPrimitive.Cancel>,
) {
  return (
    <AlertDialogPrimitive.Cancel data-slot="alert-dialog-cancel" {...props} />
  );
}

function AlertDialogAction(
  props: React.ComponentProps<typeof AlertDialogPrimitive.Action>,
) {
  return (
    <AlertDialogPrimitive.Action data-slot="alert-dialog-action" {...props} />
  );
}

function AlertDialogTitle({
  className,
  ...props
}: React.ComponentProps<typeof AlertDialogPrimitive.Title>) {
  return (
    <AlertDialogPrimitive.Title
      data-slot="alert-dialog-title"
      className={cn("text-base font-semibold leading-none", className)}
      {...props}
    />
  );
}

function AlertDialogDescription({
  className,
  ...props
}: React.ComponentProps<typeof AlertDialogPrimitive.Description>) {
  return (
    <AlertDialogPrimitive.Description
      data-slot="alert-dialog-description"
      className={cn("text-sm text-muted-foreground", className)}
      {...props}
    />
  );
}

export {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogTitle,
};
