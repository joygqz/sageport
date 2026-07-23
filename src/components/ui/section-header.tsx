import type { ReactNode } from "react";

interface SectionHeaderProps {
  title: ReactNode;
  description?: ReactNode;
  actions?: ReactNode;
}

export function SectionHeader({
  title,
  description,
  actions,
}: SectionHeaderProps) {
  return (
    <div className="flex items-start justify-between gap-3">
      <div className="min-w-0">
        <h3 className="text-base font-semibold tracking-tight text-foreground">
          {title}
        </h3>
        {description && (
          <p className="mt-1.5 text-pretty text-xs leading-relaxed text-muted-foreground">
            {description}
          </p>
        )}
      </div>
      {actions && (
        <div className="flex shrink-0 items-center gap-1 text-muted-foreground">
          {actions}
        </div>
      )}
    </div>
  );
}
