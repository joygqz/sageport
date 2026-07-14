import * as ToastPrimitive from "@radix-ui/react-toast";
import { AlertTriangle, CheckCircle2, Info, X, XCircle } from "lucide-react";

import { cn } from "@/lib/utils";
import { TOAST_DURATION, useToastStore, type ToastKind } from "@/lib/toast";
import { useI18n } from "@/i18n";
import { Button } from "./button";

const iconFor: Record<ToastKind, typeof Info> = {
  info: Info,
  success: CheckCircle2,
  warning: AlertTriangle,
  error: XCircle,
};

const accentFor: Record<ToastKind, string> = {
  info: "text-info",
  success: "text-success",
  warning: "text-warning",
  error: "text-danger",
};

export function Toaster() {
  const { t: translate } = useI18n();
  const { toasts, dismiss } = useToastStore();

  return (
    <ToastPrimitive.Provider
      duration={TOAST_DURATION}
      label={translate("common.notification")}
      swipeDirection="right"
    >
      {toasts.map((t) => {
        const Icon = iconFor[t.kind];
        const hasDetails = Boolean(t.description || t.actions?.length);
        return (
          <ToastPrimitive.Root
            key={t.id}
            open
            type={t.kind === "error" ? "foreground" : "background"}
            duration={t.persistent ? 2_147_483_647 : undefined}
            onOpenChange={(open) => {
              if (!open) dismiss(t.id);
            }}
            className={cn(
              "pointer-events-auto flex gap-3 rounded-lg border border-border/90 bg-popover p-3 shadow-md",
              hasDetails ? "items-start" : "items-center",
              "data-[state=open]:animate-in data-[state=open]:fade-in data-[state=open]:slide-in-from-right-2 data-[state=closed]:animate-out data-[state=closed]:fade-out data-[state=closed]:slide-out-to-right-2",
              "data-[swipe=move]:translate-x-[var(--radix-toast-swipe-move-x)] data-[swipe=cancel]:translate-x-0 data-[swipe=cancel]:transition-transform data-[swipe=end]:animate-out data-[swipe=end]:slide-out-to-right-full",
            )}
          >
            <Icon
              aria-hidden="true"
              className={cn(
                "size-4 shrink-0",
                hasDetails && "mt-0.5",
                accentFor[t.kind],
              )}
            />
            <div className="min-w-0 flex-1">
              <ToastPrimitive.Title className="text-sm font-medium text-foreground">
                {t.title}
              </ToastPrimitive.Title>
              {t.description && (
                <ToastPrimitive.Description className="mt-0.5 select-text break-words text-xs text-muted-foreground">
                  {t.description}
                </ToastPrimitive.Description>
              )}
              {t.actions && t.actions.length > 0 && (
                <div className="mt-2.5 flex gap-2">
                  {t.actions.map((action, i) => (
                    <ToastPrimitive.Action
                      key={action.label}
                      altText={action.label}
                      asChild
                    >
                      <Button
                        size="sm"
                        variant={i === 0 ? "primary" : "secondary"}
                        onClick={action.onClick}
                      >
                        {action.label}
                      </Button>
                    </ToastPrimitive.Action>
                  ))}
                </div>
              )}
            </div>
            <ToastPrimitive.Close asChild>
              <button
                type="button"
                aria-label={translate("common.close")}
                className={cn(
                  "-mr-1 flex size-7 shrink-0 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-accent hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/35",
                  hasDetails && "-mt-1",
                )}
              >
                <X className="size-4" />
              </button>
            </ToastPrimitive.Close>
          </ToastPrimitive.Root>
        );
      })}
      <ToastPrimitive.Viewport
        label={translate("common.notifications")}
        className="pointer-events-none fixed bottom-[calc(var(--statusbar-height)+0.75rem)] left-3 right-3 z-[100] flex w-auto flex-col gap-2 outline-none sm:bottom-[calc(var(--statusbar-height)+1rem)] sm:left-auto sm:right-4 sm:w-80"
      />
    </ToastPrimitive.Provider>
  );
}
