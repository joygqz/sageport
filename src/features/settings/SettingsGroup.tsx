import type { ReactNode } from "react";

import { SectionHeader } from "@/components/ui";
import { cn } from "@/lib/utils";

export const SETTINGS_GROUP_STACK_CLASS = "flex flex-col gap-7";

export function SettingsGroup({
  title,
  description,
  actions,
  children,
  className,
  contentClassName,
}: {
  title: ReactNode;
  description?: ReactNode;
  actions?: ReactNode;
  children: ReactNode;
  className?: string;
  contentClassName?: string;
}) {
  return (
    <section className={cn("flex flex-col gap-3", className)}>
      <SectionHeader
        title={title}
        description={description}
        actions={actions}
      />
      <div className={cn("flex flex-col gap-3", contentClassName)}>
        {children}
      </div>
    </section>
  );
}
