import type { ReactNode } from "react";

import { ScrollArea } from "@/components/ui";

export function SideBarView({
  title,
  actions,
  children,
}: {
  title: string;
  actions?: ReactNode;
  children: ReactNode;
}) {
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex h-9 shrink-0 items-center justify-between pl-4 pr-2">
        <h2 className="truncate text-2xs font-semibold uppercase tracking-wider text-muted-foreground">
          {title}
        </h2>
        {actions && <div className="flex items-center gap-0.5">{actions}</div>}
      </div>
      <ScrollArea className="min-h-0 flex-1">{children}</ScrollArea>
    </div>
  );
}
