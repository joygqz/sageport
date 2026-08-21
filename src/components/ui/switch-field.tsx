import * as React from "react";

import { cn } from "@/lib/utils";
import { Field } from "./field";
import { Label } from "./label";
import { Switch } from "./switch";

export interface SwitchFieldProps extends Omit<
  React.ComponentPropsWithoutRef<typeof Switch>,
  "className"
> {
  label: React.ReactNode;
  fieldLabel?: React.ReactNode;
  hint?: React.ReactNode;
  description?: React.ReactNode;
  className?: string;
  controlClassName?: string;
  descriptionClassName?: string;
  switchClassName?: string;
}

export const SwitchField = React.forwardRef<
  React.ComponentRef<typeof Switch>,
  SwitchFieldProps
>(
  (
    {
      label,
      fieldLabel,
      hint,
      description,
      className,
      controlClassName,
      descriptionClassName,
      switchClassName,
      id,
      "aria-labelledby": ariaLabelledBy,
      "aria-describedby": ariaDescribedBy,
      disabled,
      ...props
    },
    ref,
  ) => {
    const generatedId = React.useId();
    const switchRef = React.useRef<React.ComponentRef<typeof Switch>>(null);
    const controlId = id ?? `${generatedId}-control`;
    const labelId = `${generatedId}-label`;
    const descriptionId = `${generatedId}-description`;
    const describedBy = [
      ariaDescribedBy,
      description ? descriptionId : undefined,
    ]
      .filter(Boolean)
      .join(" ");
    const mergedRef = React.useCallback(
      (node: React.ComponentRef<typeof Switch> | null) => {
        switchRef.current = node;
        if (typeof ref === "function") ref(node);
        else if (ref) ref.current = node;
      },
      [ref],
    );

    const toggleFromCard = (event: React.MouseEvent<HTMLDivElement>) => {
      if (disabled) return;
      const target = event.target as Element;
      if (
        target.closest(
          "button, a, input, select, textarea, [role='button'], [role='link']",
        )
      ) {
        return;
      }

      event.preventDefault();
      switchRef.current?.click();
    };

    return (
      <Field
        label={fieldLabel}
        htmlFor={controlId}
        hint={hint}
        className={className}
      >
        <div
          onClick={toggleFromCard}
          className={cn(
            "flex min-h-[var(--control-height)] items-center justify-between gap-[var(--content-gap)] rounded-md border border-border-subtle bg-surface-raised px-3 text-foreground transition-colors focus-within:border-ring focus-within:ring-2 focus-within:ring-inset focus-within:ring-ring/35 hover:bg-accent",
            description ? "py-2.5" : "h-[var(--control-height)]",
            disabled ? "cursor-not-allowed opacity-50" : "cursor-pointer",
            controlClassName,
          )}
        >
          <div className="min-w-0">
            <Label
              id={labelId}
              htmlFor={controlId}
              className={cn(
                "block text-sm",
                disabled ? "cursor-not-allowed" : "cursor-pointer",
              )}
            >
              {label}
            </Label>
            {description && (
              <p
                id={descriptionId}
                className={cn(
                  "mt-0.5 text-xs text-muted-foreground",
                  descriptionClassName,
                )}
              >
                {description}
              </p>
            )}
          </div>
          <Switch
            ref={mergedRef}
            id={controlId}
            disabled={disabled}
            aria-labelledby={ariaLabelledBy ?? labelId}
            aria-describedby={describedBy || undefined}
            className={switchClassName}
            {...props}
          />
        </div>
      </Field>
    );
  },
);
SwitchField.displayName = "SwitchField";
