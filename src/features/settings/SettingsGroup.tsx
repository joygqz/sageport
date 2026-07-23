import type { ReactNode } from "react";

import { SectionHeader } from "@/components/ui";
import { cn } from "@/lib/utils";

export const SETTINGS_GROUP_STACK_CLASS = "flex flex-col gap-8";

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
    <section className={cn("flex flex-col gap-4", className)}>
      <SectionHeader
        title={title}
        description={description}
        actions={actions}
      />
      <div className={cn("flex flex-col gap-4", contentClassName)}>
        {children}
      </div>
    </section>
  );
}
