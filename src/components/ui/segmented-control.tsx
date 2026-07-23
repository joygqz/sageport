import type * as React from "react";
import * as RadioGroupPrimitive from "@radix-ui/react-radio-group";

import { cn } from "@/lib/utils";
import { CONTROL_BORDER_CLASS } from "./styles";

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
        "grid auto-cols-fr grid-flow-col gap-1 rounded-lg border bg-muted/65 p-1",
        CONTROL_BORDER_CLASS,
        className,
      )}
      {...props}
    >
      {options.map((option) => (
        <RadioGroupPrimitive.Item
          key={option.value}
          value={option.value}
          className={cn(
            "min-h-8 rounded-md px-3 py-1.5 text-sm outline-none transition-[background-color,color,box-shadow] focus-visible:ring-2 focus-visible:ring-ring/60",
            "text-muted-foreground hover:bg-list-hover hover:text-foreground",
            "data-[state=checked]:bg-list-active data-[state=checked]:font-medium data-[state=checked]:text-list-active-foreground",
          )}
        >
          {option.label}
        </RadioGroupPrimitive.Item>
      ))}
    </RadioGroupPrimitive.Root>
  );
}
