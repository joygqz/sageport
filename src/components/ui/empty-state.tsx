import { CircleAlert, type LucideIcon } from "lucide-react";

import { cn } from "@/lib/utils";
import { Button } from "./button";
import { Spinner } from "./spinner";

export function EmptyState({
  icon: Icon,
  title,
  description,
  action,
  fill = false,
  iconClassName,
  className,
}: {
  icon?: LucideIcon;
  title: string;
  description?: string;
  action?: React.ReactNode;
  fill?: boolean;
  iconClassName?: string;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "flex flex-col items-center justify-center gap-3 px-6 py-12 text-center",
        fill && "flex-1",
        className,
      )}
    >
      {Icon && (
        <div
          className={cn(
            "flex size-12 items-center justify-center rounded-lg border border-primary/15 bg-primary/10 text-link shadow-sm",
            iconClassName,
          )}
        >
          <Icon className="size-5.5" strokeWidth={1.7} />
        </div>
      )}
      <div className="space-y-1">
        <p className="text-sm font-semibold text-foreground">{title}</p>
        {description && (
          <p className="mx-auto max-w-xs text-xs leading-relaxed text-muted-foreground">
            {description}
          </p>
        )}
      </div>
      {action}
    </div>
  );
}

export function LoadingState({
  label,
  fill = false,
  className,
}: {
  label: string;
  fill?: boolean;
  className?: string;
}) {
  return (
    <div
      role="status"
      className={cn(
        "flex items-center justify-center gap-2 px-6 py-12 text-sm text-muted-foreground",
        fill && "flex-1",
        className,
      )}
    >
      <Spinner />
      <span>{label}</span>
    </div>
  );
}

export function ErrorState({
  title,
  retryLabel,
  onRetry,
  fill = false,
  className,
}: {
  title: string;
  retryLabel: string;
  onRetry: () => void;
  fill?: boolean;
  className?: string;
}) {
  return (
    <EmptyState
      icon={CircleAlert}
      title={title}
      fill={fill}
      iconClassName="border-danger/15 bg-danger/10 text-danger"
      className={className}
      action={
        <Button size="sm" variant="secondary" onClick={onRetry}>
          {retryLabel}
        </Button>
      }
    />
  );
}
