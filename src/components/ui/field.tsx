import * as React from "react";

import { cn } from "@/lib/utils";
import { Label } from "./label";

interface FieldProps {
  label?: React.ReactNode;
  htmlFor?: string;
  error?: string;
  hint?: React.ReactNode;
  required?: boolean;
  className?: string;
  children: React.ReactNode;
}

type FieldElement = React.ReactElement<Record<string, unknown>>;

const NATIVE_FIELD_CONTROLS = new Set(["input", "select", "textarea"]);

function isFieldControl(element: FieldElement): boolean {
  if (typeof element.type === "string") {
    return NATIVE_FIELD_CONTROLS.has(element.type);
  }

  const type = element.type as { displayName?: string; name?: string };
  const name = type.displayName ?? type.name ?? "";
  return /(Input|Select|Textarea|Switch|SegmentedControl)$/.test(name);
}

function findFieldControl(node: React.ReactNode): FieldElement | null {
  if (!React.isValidElement(node)) return null;
  const element = node as FieldElement;
  if (isFieldControl(element)) return element;

  let match: FieldElement | null = null;
  React.Children.forEach(element.props.children as React.ReactNode, (child) => {
    if (!match) match = findFieldControl(child);
  });
  return match;
}

function enhanceFieldControl(
  node: React.ReactNode,
  target: FieldElement,
  props: Record<string, unknown>,
): React.ReactNode {
  if (!React.isValidElement(node)) return node;
  const element = node as FieldElement;
  if (element === target) return React.cloneElement(element, props);
  if (element.props.children == null) return node;

  return React.cloneElement(
    element,
    undefined,
    React.Children.map(element.props.children as React.ReactNode, (child) =>
      enhanceFieldControl(child, target, props),
    ),
  );
}

export function Field({
  label,
  htmlFor,
  error,
  hint,
  required,
  className,
  children,
}: FieldProps) {
  const generatedId = React.useId();
  const rootChild = React.isValidElement(children)
    ? (children as React.ReactElement<Record<string, unknown>>)
    : null;
  const child = findFieldControl(children) ?? rootChild;
  const childId = typeof child?.props.id === "string" ? child.props.id : null;
  const controlId = htmlFor ?? childId ?? `${generatedId}-control`;
  const labelId = `${generatedId}-label`;
  const messageId = `${generatedId}-${error ? "error" : "hint"}`;
  const existingDescription =
    typeof child?.props["aria-describedby"] === "string"
      ? child.props["aria-describedby"]
      : null;
  const describedBy =
    error || hint
      ? [existingDescription, messageId].filter(Boolean).join(" ")
      : existingDescription;
  const control = child
    ? enhanceFieldControl(children, child, {
        id: controlId,
        "aria-labelledby":
          child.props["aria-labelledby"] ?? (label ? labelId : undefined),
        "aria-describedby": describedBy || undefined,
        "aria-invalid": error ? true : child.props["aria-invalid"],
        "aria-required": required || child.props["aria-required"] || undefined,
      })
    : children;

  return (
    <div className={cn("flex flex-col gap-1.5", className)}>
      {label && (
        <Label id={labelId} htmlFor={controlId}>
          {label}
          {required && (
            <span aria-hidden="true" className="ml-0.5 text-danger">
              *
            </span>
          )}
        </Label>
      )}
      {control}
      {error ? (
        <p id={messageId} role="alert" className="text-xs text-danger">
          {error}
        </p>
      ) : hint ? (
        <p id={messageId} className="text-xs text-muted-foreground">
          {hint}
        </p>
      ) : null}
    </div>
  );
}
