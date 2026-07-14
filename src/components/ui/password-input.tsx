import * as React from "react";
import { Eye, EyeOff } from "lucide-react";

import { useI18n } from "@/i18n";
import { cn } from "@/lib/utils";
import { Input, type InputProps } from "./input";

export type PasswordInputProps = Omit<InputProps, "type">;

export const PasswordInput = React.forwardRef<
  HTMLInputElement,
  PasswordInputProps
>(({ className, ...props }, ref) => {
  const { t } = useI18n();
  const [visible, setVisible] = React.useState(false);
  const Icon = visible ? EyeOff : Eye;

  return (
    <div className="relative">
      <Input
        ref={ref}
        type={visible ? "text" : "password"}
        className={cn("pr-9", className)}
        {...props}
      />
      <button
        type="button"
        onClick={() => setVisible((v) => !v)}
        aria-label={t(visible ? "common.hidePassword" : "common.showPassword")}
        aria-pressed={visible}
        className="absolute inset-y-px right-px flex w-9 items-center justify-center rounded-r-[calc(var(--radius)-1px)] text-muted-foreground outline-none transition-colors hover:text-foreground focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring/35"
      >
        <Icon className="size-4" />
      </button>
    </div>
  );
});
PasswordInput.displayName = "PasswordInput";
