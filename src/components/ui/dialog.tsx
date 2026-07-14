import * as React from "react";
import * as DialogPrimitive from "@radix-ui/react-dialog";
import { X } from "lucide-react";

import { useI18n } from "@/i18n";
import { cn } from "@/lib/utils";

function Dialog(props: React.ComponentProps<typeof DialogPrimitive.Root>) {
  return <DialogPrimitive.Root data-slot="dialog" {...props} />;
}

function DialogTrigger(
  props: React.ComponentProps<typeof DialogPrimitive.Trigger>,
) {
  return <DialogPrimitive.Trigger data-slot="dialog-trigger" {...props} />;
}

function DialogClose(
  props: React.ComponentProps<typeof DialogPrimitive.Close>,
) {
  return <DialogPrimitive.Close data-slot="dialog-close" {...props} />;
}

function DialogPortal(
  props: React.ComponentProps<typeof DialogPrimitive.Portal>,
) {
  return <DialogPrimitive.Portal data-slot="dialog-portal" {...props} />;
}

function DialogOverlay({
  className,
  ref,
  ...props
}: React.ComponentProps<typeof DialogPrimitive.Overlay> & {
  ref?: React.Ref<React.ComponentRef<typeof DialogPrimitive.Overlay>>;
}) {
  return (
    <DialogPrimitive.Overlay
      ref={ref}
      data-slot="dialog-overlay"
      className={cn(
        "fixed inset-0 z-50 bg-black/40 backdrop-blur-[2px] dark:bg-black/60",
        "data-[state=open]:animate-in data-[state=open]:fade-in-0 data-[state=closed]:animate-out data-[state=closed]:fade-out-0",
        className,
      )}
      {...props}
    />
  );
}

const DRAG_MARGIN = 8;

function DialogContent({
  className,
  children,
  showClose = true,
  ref,
  ...props
}: React.ComponentProps<typeof DialogPrimitive.Content> & {
  showClose?: boolean;
  ref?: React.Ref<React.ComponentRef<typeof DialogPrimitive.Content>>;
}) {
  const { t } = useI18n();
  const contentRef = React.useRef<HTMLDivElement | null>(null);

  const [offset, setOffset] = React.useState({ x: 0, y: 0 });

  const setRefs = (node: HTMLDivElement | null) => {
    contentRef.current = node;
    if (typeof ref === "function") ref(node);
    else if (ref) ref.current = node;
  };

  const onPointerDown = (e: React.PointerEvent) => {
    if (e.button !== 0) return;
    const target = e.target as HTMLElement;
    if (
      !target.closest(
        '[data-slot="dialog-header"], [data-slot="dialog-toolbar"]',
      ) ||
      target.closest("button, input, textarea, select, a, [role='combobox']")
    ) {
      return;
    }
    const el = contentRef.current;
    if (!el) return;
    e.preventDefault();

    const rect = el.getBoundingClientRect();

    const base = offset;
    const startX = e.clientX;
    const startY = e.clientY;
    const clampMove = (value: number, lo: number, hi: number) =>
      Math.min(Math.max(value, lo), Math.max(lo, hi));

    const onMove = (ev: PointerEvent) => {
      const mx = clampMove(
        ev.clientX - startX,
        DRAG_MARGIN - rect.left,
        window.innerWidth - DRAG_MARGIN - rect.right,
      );
      const my = clampMove(
        ev.clientY - startY,
        DRAG_MARGIN - rect.top,
        window.innerHeight - DRAG_MARGIN - rect.bottom,
      );
      setOffset({ x: base.x + mx, y: base.y + my });
    };
    const onUp = () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      window.removeEventListener("pointercancel", onUp);
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    window.addEventListener("pointercancel", onUp);
  };

  return (
    <DialogPortal>
      <DialogOverlay />
      <DialogPrimitive.Content
        ref={setRefs}
        data-slot="dialog-content"
        onPointerDown={onPointerDown}

        style={{
          translate: `calc(-50% + ${offset.x}px) calc(-50% + ${offset.y}px)`,
        }}
        className={cn(
          "fixed left-1/2 top-1/2 z-50 grid max-h-[calc(100dvh-2rem)] w-[calc(100%-2rem)] max-w-lg gap-4 overflow-y-auto",
          "rounded-xl border border-border bg-popover p-5 text-popover-foreground shadow-md sm:p-6",
          "data-[state=open]:animate-in data-[state=open]:fade-in-0 data-[state=open]:zoom-in-95",
          "data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=closed]:zoom-out-95",
          className,
        )}
        {...props}
      >
        {children}
        {showClose && (
          <DialogPrimitive.Close className="absolute right-3 top-3 flex size-8 items-center justify-center rounded-lg text-muted-foreground opacity-70 transition-[background-color,opacity] hover:bg-accent hover:opacity-100 focus:outline-none focus-visible:ring-2 focus-visible:ring-ring/35">
            <X className="size-4" />
            <span className="sr-only">{t("common.close")}</span>
          </DialogPrimitive.Close>
        )}
      </DialogPrimitive.Content>
    </DialogPortal>
  );
}

function DialogHeader({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="dialog-header"
      className={cn("flex flex-col gap-1.5 text-left", className)}
      {...props}
    />
  );
}

function DialogToolbar({
  className,
  children,
  ...props
}: React.ComponentProps<"div">) {
  const { t } = useI18n();
  return (
    <div
      data-slot="dialog-toolbar"
      className={cn(
        "flex h-[var(--workbench-bar-height)] shrink-0 items-center justify-between gap-2 border-b border-border bg-surface/45 pl-4 pr-2",
        className,
      )}
      {...props}
    >
      <DialogTitle className="truncate">{children}</DialogTitle>
      <DialogPrimitive.Close className="flex size-[var(--toolbar-control-size)] shrink-0 items-center justify-center rounded-lg text-muted-foreground opacity-70 transition-[background-color,opacity] hover:bg-accent hover:opacity-100 focus:outline-none focus-visible:ring-2 focus-visible:ring-ring/35">
        <X className="size-4" />
        <span className="sr-only">{t("common.close")}</span>
      </DialogPrimitive.Close>
    </div>
  );
}

function DialogFooter({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="dialog-footer"
      className={cn(
        "flex flex-col-reverse gap-2 sm:flex-row sm:justify-end",
        className,
      )}
      {...props}
    />
  );
}

function DialogTitle({
  className,
  ref,
  ...props
}: React.ComponentProps<typeof DialogPrimitive.Title> & {
  ref?: React.Ref<React.ComponentRef<typeof DialogPrimitive.Title>>;
}) {
  return (
    <DialogPrimitive.Title
      ref={ref}
      data-slot="dialog-title"
      className={cn("text-base font-semibold leading-none", className)}
      {...props}
    />
  );
}

function DialogDescription({
  className,
  ref,
  ...props
}: React.ComponentProps<typeof DialogPrimitive.Description> & {
  ref?: React.Ref<React.ComponentRef<typeof DialogPrimitive.Description>>;
}) {
  return (
    <DialogPrimitive.Description
      ref={ref}
      data-slot="dialog-description"
      className={cn("text-sm text-muted-foreground", className)}
      {...props}
    />
  );
}

export {
  Dialog,
  DialogTrigger,
  DialogClose,
  DialogPortal,
  DialogOverlay,
  DialogContent,
  DialogHeader,
  DialogToolbar,
  DialogFooter,
  DialogTitle,
  DialogDescription,
};
