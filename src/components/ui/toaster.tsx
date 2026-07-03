import { CheckCircle2, Info, X, XCircle } from "lucide-react";

import { cn } from "@/lib/utils";
import { useToastStore, type ToastKind } from "@/lib/toast";

const iconFor: Record<ToastKind, typeof Info> = {
  info: Info,
  success: CheckCircle2,
  error: XCircle,
};

const accentFor: Record<ToastKind, string> = {
  info: "text-info",
  success: "text-success",
  error: "text-destructive",
};

export function Toaster() {
  const { toasts, dismiss } = useToastStore();

  return (
    <div className="pointer-events-none fixed bottom-4 right-4 z-[100] flex w-80 flex-col gap-2">
      {toasts.map((t) => {
        const Icon = iconFor[t.kind];
        return (
          <div
            key={t.id}
            className="pointer-events-auto flex items-start gap-3 rounded-md border border-border bg-popover p-3 shadow-md animate-in fade-in"
          >
            <Icon className={cn("mt-0.5 size-4 shrink-0", accentFor[t.kind])} />
            <div className="min-w-0 flex-1">
              <p className="text-sm font-medium text-foreground">{t.title}</p>
              {t.description && (
                <p className="mt-0.5 select-text break-words text-xs text-muted-foreground">
                  {t.description}
                </p>
              )}
            </div>
            <button
              onClick={() => dismiss(t.id)}
              className="text-muted-foreground transition-colors hover:text-foreground"
            >
              <X className="size-4" />
            </button>
          </div>
        );
      })}
    </div>
  );
}
