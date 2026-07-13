import { Search } from "lucide-react";

import { Input } from "@/components/ui";
import { shouldShowSideBarFilter } from "./side-bar-filter";

export function SideBarFilter({
  itemCount,
  value,
  onChange,
  placeholder,
  threshold,
}: {
  itemCount: number;
  value: string;
  onChange: (value: string) => void;
  placeholder: string;
  threshold?: number;
}) {
  if (!shouldShowSideBarFilter(itemCount, value, threshold)) return null;

  return (
    <div className="relative z-10 px-[var(--panel-gutter)] pt-[var(--panel-gutter)]">
      <div className="relative">
        <Search className="pointer-events-none absolute left-3 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
        <Input
          type="search"
          value={value}
          onChange={(event) => onChange(event.target.value)}
          placeholder={placeholder}
          aria-label={placeholder}
          className="h-8 bg-background/70 pl-8 text-xs"
        />
      </div>
    </div>
  );
}
