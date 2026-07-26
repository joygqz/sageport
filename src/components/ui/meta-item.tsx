import type { LucideIcon } from "lucide-react";

import { cn } from "@/lib/utils";

export function MetaItem({
  icon: Icon,
  title,
  className,
  children,
}: {
  icon: LucideIcon;
  title?: string;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <span
      className={cn("flex min-w-0 items-center gap-1", className)}
      title={title}
    >
      <Icon className="size-3 shrink-0" />
      <span className="truncate">{children}</span>
    </span>
  );
}
