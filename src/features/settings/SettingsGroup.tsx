import type { ReactNode } from "react";

import { SectionHeader } from "@/components/ui";
import { cn } from "@/lib/utils";

export const SETTINGS_GROUP_STACK_CLASS = "ui-section-stack";

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
    <section className={cn("flex flex-col gap-[var(--field-gap)]", className)}>
      <SectionHeader
        title={title}
        description={description}
        actions={actions}
      />
      <div
        className={cn("flex flex-col gap-[var(--field-gap)]", contentClassName)}
      >
        {children}
      </div>
    </section>
  );
}
