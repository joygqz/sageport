import type { ReactNode } from "react";

import { cn } from "@/lib/utils";

interface SegmentedControlProps<T extends string> {
  value: T;
  onChange: (value: T) => void;
  options: { value: T; label: ReactNode }[];
  className?: string;
}

export function SegmentedControl<T extends string>({
  value,
  onChange,
  options,
  className,
}: SegmentedControlProps<T>) {
  return (
    <div
      className={cn(
        "grid auto-cols-fr grid-flow-col gap-1 rounded-lg border border-border bg-muted/65 p-1",
        className,
      )}
    >
      {options.map((option) => (
        <button
          key={option.value}
          type="button"
          onClick={() => onChange(option.value)}
          className={cn(
            "min-h-8 rounded-md px-3 py-1.5 text-sm outline-none transition-[background-color,color,box-shadow] focus-visible:ring-2 focus-visible:ring-ring/35",
            value === option.value
              ? "bg-card text-card-foreground shadow-sm"
              : "text-muted-foreground hover:bg-card/50 hover:text-foreground",
          )}
        >
          {option.label}
        </button>
      ))}
    </div>
  );
}
