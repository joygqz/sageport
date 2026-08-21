import type * as React from "react";
import * as RadioGroupPrimitive from "@radix-ui/react-radio-group";

import { cn } from "@/lib/utils";
import { INTERACTIVE_FOCUS_CLASS } from "./styles";

type SegmentedControlProps<T extends string> = Omit<
  React.ComponentProps<typeof RadioGroupPrimitive.Root>,
  "value" | "defaultValue" | "onChange" | "onValueChange" | "children"
> & {
  value: T;
  onChange: (value: T) => void;
  options: { value: T; label: React.ReactNode }[];
};

export function SegmentedControl<T extends string>({
  value,
  onChange,
  options,
  className,
  ...props
}: SegmentedControlProps<T>) {
  return (
    <RadioGroupPrimitive.Root
      value={value}
      onValueChange={(next) => onChange(next as T)}
      className={cn(
        "grid w-full auto-cols-fr grid-flow-col gap-0.5 rounded-md border border-border-subtle bg-surface-sunken p-0.5",
        className,
      )}
      {...props}
    >
      {options.map((option) => (
        <RadioGroupPrimitive.Item
          key={option.value}
          value={option.value}
          className={cn(
            "min-h-[var(--toolbar-control-size)] rounded-sm px-3 py-1 text-sm transition-colors",
            INTERACTIVE_FOCUS_CLASS,
            "text-muted-foreground hover:bg-list-hover hover:text-foreground",
            "data-[state=checked]:bg-surface-raised data-[state=checked]:font-medium data-[state=checked]:text-foreground",
          )}
        >
          {option.label}
        </RadioGroupPrimitive.Item>
      ))}
    </RadioGroupPrimitive.Root>
  );
}
