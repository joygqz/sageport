import { useMemo, useState, type FocusEventHandler } from "react";
import * as SelectPrimitive from "@radix-ui/react-select";
import { Check, ChevronDown, ChevronRight, ChevronUp } from "lucide-react";

import { cn } from "@/lib/utils";
import {
  CONTROL_BASE_CLASS,
  MENU_ITEM_CLASS,
  POPOVER_CONTENT_CLASS,
} from "./styles";
import {
  buildTreeSelectRows,
  type TreeSelectNode,
  type TreeSelectRootOption,
  type TreeSelectRow,
} from "./tree-select-model";

const EMPTY_VALUE = "__sageport_empty_tree_select_value__";

function encodeValue(value: string) {
  return value === "" ? EMPTY_VALUE : value;
}

function decodeValue(value: string) {
  return value === EMPTY_VALUE ? "" : value;
}

export function TreeSelect({
  nodes,
  rootOption,
  value,
  onValueChange,
  onBlur,
  disabled,
  className,
}: {
  nodes: readonly TreeSelectNode[];
  rootOption: TreeSelectRootOption;
  value: string;
  onValueChange: (value: string) => void;
  onBlur?: FocusEventHandler<HTMLButtonElement>;
  disabled?: boolean;
  className?: string;
}) {
  const [collapsed, setCollapsed] = useState<Set<string>>(() => new Set());
  const rows = useMemo(
    () => buildTreeSelectRows(nodes, collapsed),
    [collapsed, nodes],
  );
  const selectedLabel =
    value === rootOption.value
      ? rootOption.label
      : (nodes.find((node) => node.value === value)?.label ?? rootOption.label);

  const toggle = (nodeValue: string) => {
    setCollapsed((current) => {
      const next = new Set(current);
      if (next.has(nodeValue)) next.delete(nodeValue);
      else next.add(nodeValue);
      return next;
    });
  };

  const revealSelection = () => {
    if (!value) return;
    const byValue = new Map(nodes.map((node) => [node.value, node]));
    const ancestors = new Set<string>();
    let current = byValue.get(value);
    while (current?.parentValue && !ancestors.has(current.parentValue)) {
      ancestors.add(current.parentValue);
      current = byValue.get(current.parentValue);
    }
    if (ancestors.size === 0) return;
    setCollapsed((currentCollapsed) => {
      const next = new Set(currentCollapsed);
      let changed = false;
      for (const ancestor of ancestors)
        changed = next.delete(ancestor) || changed;
      return changed ? next : currentCollapsed;
    });
  };

  return (
    <SelectPrimitive.Root
      value={encodeValue(value)}
      onValueChange={(next) => onValueChange(decodeValue(next))}
      onOpenChange={(open) => {
        if (open) revealSelection();
      }}
      disabled={disabled}
    >
      <SelectPrimitive.Trigger
        onBlur={onBlur}
        className={cn(
          CONTROL_BASE_CLASS,
          "flex h-[var(--control-height)] items-center justify-between gap-2 px-3 text-sm",
          className,
        )}
      >
        <span className="min-w-0 truncate">{selectedLabel}</span>
        <SelectPrimitive.Icon asChild>
          <ChevronDown className="size-4 shrink-0 text-muted-foreground" />
        </SelectPrimitive.Icon>
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
          )}
        >
          <SelectPrimitive.ScrollUpButton className="flex h-6 cursor-default items-center justify-center text-muted-foreground">
            <ChevronUp className="size-4" />
          </SelectPrimitive.ScrollUpButton>
          <SelectPrimitive.Viewport className="p-1.5">
            <TreeSelectItem
              node={{
                ...rootOption,
                parentValue: null,
                depth: 0,
                hasChildren: false,
              }}
              collapsed={false}
              onToggle={toggle}
            />
            {rows.length > 0 && (
              <SelectPrimitive.Separator className="-mx-1 my-1 h-px bg-border" />
            )}
            {rows.map((row) => (
              <TreeSelectItem
                key={row.value}
                node={row}
                collapsed={collapsed.has(row.value)}
                onToggle={toggle}
              />
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

function TreeSelectItem({
  node,
  collapsed,
  onToggle,
}: {
  node: TreeSelectRow;
  collapsed: boolean;
  onToggle: (value: string) => void;
}) {
  return (
    <SelectPrimitive.Item
      value={encodeValue(node.value)}
      disabled={node.disabled}
      className={cn(MENU_ITEM_CLASS, "pr-8")}
      style={{ paddingLeft: `${8 + node.depth * 16}px` }}
      onKeyDown={(event) => {
        if (!node.hasChildren) return;
        if (event.key === "ArrowRight" && collapsed) {
          event.preventDefault();
          event.stopPropagation();
          onToggle(node.value);
        } else if (event.key === "ArrowLeft" && !collapsed) {
          event.preventDefault();
          event.stopPropagation();
          onToggle(node.value);
        }
      }}
    >
      {node.hasChildren ? (
        <span
          role="button"
          aria-label={node.label}
          aria-expanded={!collapsed}
          className="flex size-5 shrink-0 items-center justify-center rounded-sm text-muted-foreground hover:bg-accent"
          onPointerDown={(event) => {
            event.preventDefault();
            event.stopPropagation();
            onToggle(node.value);
          }}
          onPointerUp={(event) => {
            event.preventDefault();
            event.stopPropagation();
          }}
        >
          {collapsed ? (
            <ChevronRight aria-hidden="true" />
          ) : (
            <ChevronDown aria-hidden="true" />
          )}
        </span>
      ) : (
        <span className="size-5 shrink-0" />
      )}
      <SelectPrimitive.ItemText>{node.label}</SelectPrimitive.ItemText>
      <SelectPrimitive.ItemIndicator className="absolute right-2 flex size-4 items-center justify-center text-link">
        <Check className="size-4" />
      </SelectPrimitive.ItemIndicator>
    </SelectPrimitive.Item>
  );
}
