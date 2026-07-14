import type * as React from "react";
import type { ComponentType } from "react";
import type { LucideProps } from "lucide-react";

import { cn } from "@/lib/utils";
import { Button } from "./button";
import { Input, type InputProps } from "./input";

const findButtonClass = "size-6 shrink-0 rounded-lg [&_svg]:size-3.5";

export function FindBar({
  label,
  onDismiss,
  className,
  children,
}: {
  label: string;
  onDismiss: () => void;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <div
      role="dialog"
      aria-label={label}
      onKeyDown={(event) => {
        if (event.key !== "Escape") return;
        event.preventDefault();
        event.stopPropagation();
        onDismiss();
      }}
      className={cn(
        "absolute right-3 top-2 z-30 rounded-lg border border-border bg-popover p-1",
        className,
      )}
    >
      {children}
    </div>
  );
}

export function FindInput({
  className,
  ref,
  ...props
}: InputProps & { ref?: React.Ref<HTMLInputElement> }) {
  return (
    <Input
      ref={ref}
      autoComplete="off"
      spellCheck={false}
      className={cn("h-7 rounded-lg px-2 py-0 text-xs", className)}
      {...props}
    />
  );
}

export function FindActionButton({
  label,
  icon: Icon,
  className,
  ...props
}: {
  label: string;
  icon: ComponentType<LucideProps>;
} & React.ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <Button
      type="button"
      size="icon"
      variant="ghost"
      className={cn(findButtonClass, className)}
      aria-label={label}
      {...props}
    >
      <Icon />
    </Button>
  );
}

export function FindToggleButton({
  active,
  label,
  icon: Icon,
  onClick,
}: {
  active: boolean;
  label: string;
  icon: ComponentType<LucideProps>;
  onClick: () => void;
}) {
  return (
    <Button
      type="button"
      size="icon"
      variant="ghost"
      className={cn(
        findButtonClass,
        active && "bg-list-active text-list-active-foreground",
      )}
      aria-label={label}
      aria-pressed={active}
      onClick={onClick}
    >
      <Icon />
    </Button>
  );
}

export function FindCount({
  danger,
  className,
  ...props
}: { danger?: boolean } & React.HTMLAttributes<HTMLSpanElement>) {
  return (
    <span
      aria-live="polite"
      className={cn(
        "shrink-0 whitespace-nowrap px-1 text-2xs tabular-nums text-muted-foreground",
        danger && "text-danger",
        className,
      )}
      {...props}
    />
  );
}
