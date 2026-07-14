import { cloneElement, isValidElement, type ReactElement } from "react";
import type * as React from "react";
import * as TooltipPrimitive from "@radix-ui/react-tooltip";

import { cn } from "@/lib/utils";

function TooltipProvider(
  props: React.ComponentProps<typeof TooltipPrimitive.Provider>,
) {
  return <TooltipPrimitive.Provider data-slot="tooltip-provider" {...props} />;
}

function TooltipRoot(
  props: React.ComponentProps<typeof TooltipPrimitive.Root>,
) {
  return <TooltipPrimitive.Root data-slot="tooltip" {...props} />;
}

function TooltipTrigger(
  props: React.ComponentProps<typeof TooltipPrimitive.Trigger>,
) {
  return <TooltipPrimitive.Trigger data-slot="tooltip-trigger" {...props} />;
}

function TooltipContent({
  className,
  sideOffset = 6,
  ref,
  ...props
}: React.ComponentProps<typeof TooltipPrimitive.Content> & {
  ref?: React.Ref<React.ComponentRef<typeof TooltipPrimitive.Content>>;
}) {
  return (
    <TooltipPrimitive.Portal>
      <TooltipPrimitive.Content
        ref={ref}
        data-slot="tooltip-content"
        sideOffset={sideOffset}
        className={cn(
          "z-50 overflow-hidden rounded-md bg-foreground px-2.5 py-1.5 text-xs font-medium text-background shadow-sm",
          "data-[state=delayed-open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=delayed-open]:fade-in-0",
          className,
        )}
        {...props}
      />
    </TooltipPrimitive.Portal>
  );
}

function Tooltip({
  content,
  children,
  side = "top",
  delayDuration = 300,
  ...props
}: {
  content: React.ReactNode;
  children: React.ReactNode;
  side?: "top" | "right" | "bottom" | "left";
  delayDuration?: number;
} & React.ComponentProps<typeof TooltipPrimitive.Content>) {
  if (content == null) return <>{children}</>;

  const trigger =
    typeof content === "string" && isValidElement(children)
      ? cloneElement(children as ReactElement<{ "aria-label"?: string }>, {
          "aria-label":
            (children.props as { "aria-label"?: string })["aria-label"] ??
            content,
        })
      : children;

  return (
    <TooltipRoot delayDuration={delayDuration}>
      <TooltipTrigger
        asChild
        onFocus={(e) => {
          if (!e.currentTarget.matches(":focus-visible")) e.preventDefault();
        }}
      >
        {trigger}
      </TooltipTrigger>
      <TooltipContent side={side} {...props}>
        {content}
      </TooltipContent>
    </TooltipRoot>
  );
}

export {
  TooltipProvider,
  TooltipRoot,
  TooltipTrigger,
  TooltipContent,
  Tooltip,
};
