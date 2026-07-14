import type { ReactNode } from "react";

import { ScrollArea } from "@/components/ui";
import { PanelHeader } from "./PanelHeader";

export function SideBarView({
  title,
  actions,
  topContent,
  children,
}: {
  title: string;
  actions?: ReactNode;
  topContent?: ReactNode;
  children: ReactNode;
}) {
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <PanelHeader title={title} actions={actions} />
      {topContent}
      <ScrollArea className="min-h-0 flex-1">
        <div className="flex h-full flex-col">{children}</div>
      </ScrollArea>
    </div>
  );
}
