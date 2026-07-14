import { AlertTriangle, CheckCircle2, Info, X, XCircle } from "lucide-react";

import { cn } from "@/lib/utils";
import { useToastStore, type ToastKind } from "@/lib/toast";
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
  const { toasts, dismiss, pause, resume } = useToastStore();

  return (
    <div
      aria-live="polite"
      aria-relevant="additions"
      className="pointer-events-none fixed bottom-[calc(var(--statusbar-height)+0.75rem)] left-3 right-3 z-[100] flex w-auto flex-col gap-2 sm:bottom-[calc(var(--statusbar-height)+1rem)] sm:left-auto sm:right-4 sm:w-80"
    >
      {toasts.map((t) => {
        const Icon = iconFor[t.kind];
        return (
          <div
            key={t.id}
            onMouseEnter={() => pause(t.id)}
            onMouseLeave={() => resume(t.id)}
            className="pointer-events-auto flex items-start gap-3 rounded-lg border border-border/90 bg-popover p-3 shadow-md animate-in fade-in slide-in-from-right-2"
          >
            <Icon className={cn("mt-0.5 size-4 shrink-0", accentFor[t.kind])} />
            <div className="min-w-0 flex-1">
              <p className="text-sm font-medium text-foreground">{t.title}</p>
              {t.description && (
                <p className="mt-0.5 select-text break-words text-xs text-muted-foreground">
                  {t.description}
                </p>
              )}
              {t.actions && t.actions.length > 0 && (
                <div className="mt-2.5 flex gap-2">
                  {t.actions.map((action, i) => (
                    <Button
                      key={action.label}
                      size="sm"
                      variant={i === 0 ? "primary" : "secondary"}
                      onClick={() => {
                        dismiss(t.id);
                        action.onClick();
                      }}
                    >
                      {action.label}
                    </Button>
                  ))}
                </div>
              )}
            </div>
            <button
              type="button"
              aria-label={translate("common.close")}
              onClick={() => dismiss(t.id)}
              className="-mr-1 -mt-1 flex size-7 shrink-0 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-accent hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/35"
            >
              <X className="size-4" />
            </button>
          </div>
        );
      })}
    </div>
  );
}
