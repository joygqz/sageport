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
    <div>
      <div className="flex items-center gap-1.5">
        <h3 className="text-sm font-medium leading-none text-foreground">
          {title}
        </h3>
        {actions}
      </div>
      {description && (
        <p className="mt-1.5 text-xs leading-relaxed text-muted-foreground">
          {description}
        </p>
      )}
    </div>
  );
}
