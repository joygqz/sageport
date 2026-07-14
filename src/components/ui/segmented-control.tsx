import type { HTMLAttributes, ReactNode } from "react";

import { cn } from "@/lib/utils";

type SegmentedControlProps<T extends string> = Omit<
  HTMLAttributes<HTMLDivElement>,
  "onChange"
> & {
  value: T;
  onChange: (value: T) => void;
  options: { value: T; label: ReactNode }[];
};

export function SegmentedControl<T extends string>({
  value,
  onChange,
  options,
  className,
  ...props
}: SegmentedControlProps<T>) {
  return (
    <div
      role="radiogroup"
      className={cn(
        "grid auto-cols-fr grid-flow-col gap-1 rounded-lg border border-border bg-muted/65 p-1",
        className,
      )}
      {...props}
    >
      {options.map((option) => (
        <button
          key={option.value}
          type="button"
          role="radio"
          aria-checked={value === option.value}
          onClick={() => onChange(option.value)}
          className={cn(
            "min-h-8 rounded-md px-3 py-1.5 text-sm outline-none transition-[background-color,color,box-shadow] focus-visible:ring-2 focus-visible:ring-ring/35",
            value === option.value
              ? "bg-list-active font-medium text-list-active-foreground"
              : "text-muted-foreground hover:bg-list-hover hover:text-foreground",
          )}
        >
          {option.label}
        </button>
      ))}
    </div>
  );
}
