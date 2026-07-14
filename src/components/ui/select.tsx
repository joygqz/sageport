import type * as React from "react";
import * as SelectPrimitive from "@radix-ui/react-select";
import { Check, ChevronDown, ChevronUp } from "lucide-react";

import { cn } from "@/lib/utils";
import {
  CONTROL_BASE_CLASS,
  MENU_ITEM_CLASS,
  POPOVER_CONTENT_CLASS,
} from "./styles";

const EMPTY_VALUE = "__sageport_empty_select_value__";

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
  onBlur?: React.FocusEventHandler<HTMLButtonElement>;
  placeholder?: React.ReactNode;
  id?: string;
  title?: string;
  disabled?: boolean;
  required?: boolean;
  autoFocus?: boolean;
  showChevron?: boolean;
  className?: string;
  contentClassName?: string;
}

function encodeValue(value: string): string {
  return value === "" ? EMPTY_VALUE : value;
}

function decodeValue(value: string): string {
  return value === EMPTY_VALUE ? "" : value;
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
  contentClassName,
  ...ariaProps
}: SelectProps) {
  return (
    <SelectPrimitive.Root
      value={value === undefined ? undefined : encodeValue(value)}
      defaultValue={
        defaultValue === undefined ? undefined : encodeValue(defaultValue)
      }
      onValueChange={(next) => onValueChange?.(decodeValue(next))}
      disabled={disabled}
      required={required}
    >
      <SelectPrimitive.Trigger
        id={id}
        title={title}
        onBlur={onBlur}
        autoFocus={autoFocus}
        className={cn(
          CONTROL_BASE_CLASS,
          "flex h-[var(--control-height)] items-center justify-between gap-2 px-3 text-sm [&>span]:min-w-0 [&>span]:truncate",
          className,
        )}
        {...ariaProps}
      >
        <SelectPrimitive.Value placeholder={placeholder} />
        {showChevron && (
          <SelectPrimitive.Icon asChild>
            <ChevronDown className="size-4 shrink-0 text-muted-foreground" />
          </SelectPrimitive.Icon>
        )}
      </SelectPrimitive.Trigger>
      <SelectPrimitive.Portal>
        <SelectPrimitive.Content
          position="popper"
          align="start"
          sideOffset={4}
          collisionPadding={8}
          className={cn(
            POPOVER_CONTENT_CLASS,
            "max-h-[var(--radix-select-content-available-height)] min-w-[var(--radix-select-trigger-width)] max-w-[calc(100vw-1rem)] overflow-hidden",
            contentClassName,
          )}
        >
          <SelectPrimitive.ScrollUpButton className="flex h-6 cursor-default items-center justify-center text-muted-foreground">
            <ChevronUp className="size-4" />
          </SelectPrimitive.ScrollUpButton>
          <SelectPrimitive.Viewport className="p-1.5">
            {options.map((option) => (
              <SelectPrimitive.Item
                key={option.value}
                value={encodeValue(option.value)}
                disabled={option.disabled}
                className={cn(MENU_ITEM_CLASS, "pr-8")}
              >
                <SelectPrimitive.ItemText>
                  {option.label}
                </SelectPrimitive.ItemText>
                <SelectPrimitive.ItemIndicator className="absolute right-2 flex size-4 items-center justify-center text-link">
                  <Check className="size-4" />
                </SelectPrimitive.ItemIndicator>
              </SelectPrimitive.Item>
            ))}
          </SelectPrimitive.Viewport>
          <SelectPrimitive.ScrollDownButton className="flex h-6 cursor-default items-center justify-center text-muted-foreground">
            <ChevronDown className="size-4" />
          </SelectPrimitive.ScrollDownButton>
        </SelectPrimitive.Content>
      </SelectPrimitive.Portal>
    </SelectPrimitive.Root>
  );
}
