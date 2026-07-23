import * as React from "react";
import { Eye, EyeOff, Loader2 } from "lucide-react";

import { useI18n } from "@/i18n";
import { cn } from "@/lib/utils";
import { Input, type InputProps } from "./input";

export type PasswordInputProps = Omit<InputProps, "type"> & {
  /** Called before changing from hidden to visible. Return false to stay hidden. */
  onBeforeReveal?: () => boolean | Promise<boolean>;
};

export const PasswordInput = React.forwardRef<
  HTMLInputElement,
  PasswordInputProps
>(({ className, onBeforeReveal, disabled, ...props }, ref) => {
  const { t } = useI18n();
  const [visible, setVisible] = React.useState(false);
  const [revealing, setRevealing] = React.useState(false);
  const Icon = visible ? EyeOff : Eye;

  const toggleVisibility = async () => {
    if (!visible && onBeforeReveal) {
      setRevealing(true);
      try {
        if (!(await onBeforeReveal())) return;
      } catch {
        return;
      } finally {
        setRevealing(false);
      }
    }
    setVisible((value) => !value);
  };

  return (
    <div className="relative">
      <Input
        ref={ref}
        type={visible ? "text" : "password"}
        className={cn("pr-9", className)}
        disabled={disabled}
        {...props}
      />
      <button
        type="button"
        onClick={() => void toggleVisibility()}
        disabled={disabled || revealing}
        aria-label={t(visible ? "common.hidePassword" : "common.showPassword")}
        aria-pressed={visible}
        className="absolute inset-y-px right-px flex w-9 items-center justify-center rounded-r-[calc(var(--radius)-1px)] text-muted-foreground outline-none transition-colors hover:text-foreground focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring/60"
      >
        {revealing ? (
          <Loader2 className="size-4 animate-spin" />
        ) : (
          <Icon className="size-4" />
        )}
      </button>
    </div>
  );
});
PasswordInput.displayName = "PasswordInput";
