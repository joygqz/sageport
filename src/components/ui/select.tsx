import type * as React from "react";
import { ChevronDown } from "lucide-react";

import { cn } from "@/lib/utils";
import { CONTROL_BASE_CLASS } from "./styles";

export interface SelectOption {
  value: string;
  label: React.ReactNode;
  disabled?: boolean;
}

export interface SelectProps extends React.AriaAttributes {
  options: readonly SelectOption[];
  value?: string;
  defaultValue?: string;
  onValueChange?: (value: string) => void;
  onBlur?: React.FocusEventHandler<HTMLSelectElement>;
  placeholder?: React.ReactNode;
  id?: string;
  title?: string;
  disabled?: boolean;
  required?: boolean;
  autoFocus?: boolean;
  showChevron?: boolean;
  className?: string;
}

export function Select({
  options,
  value,
  defaultValue,
  onValueChange,
  onBlur,
  placeholder,
  id,
  title,
  disabled,
  required,
  autoFocus,
  showChevron = true,
  className,
  ...ariaProps
}: SelectProps) {
  const showPlaceholder =
    placeholder !== undefined && !options.some((option) => option.value === "");

  return (
    <div className="relative w-full">
      <select
        id={id}
        title={title}
        value={value}
        defaultValue={defaultValue}
        onChange={(event) => onValueChange?.(event.target.value)}
        onBlur={onBlur}
        disabled={disabled}
        required={required}
        autoFocus={autoFocus}
        className={cn(
          CONTROL_BASE_CLASS,
          "flex h-[var(--control-height)] appearance-none px-3 text-sm",
          showChevron && "pr-8",
          className,
        )}
        {...ariaProps}
      >
        {showPlaceholder && (
          <option value="" disabled>
            {placeholder}
          </option>
        )}
        {options.map((option) => (
          <option
            key={option.value}
            value={option.value}
            disabled={option.disabled}
          >
            {option.label}
          </option>
        ))}
      </select>
      {showChevron && (
        <ChevronDown className="pointer-events-none absolute right-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
      )}
    </div>
  );
}
