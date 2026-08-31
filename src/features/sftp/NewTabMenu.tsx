import { useRef, useState, type ReactNode } from "react";
import { HardDrive, Search, Server } from "lucide-react";

import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
  Input,
  Tooltip,
} from "@/components/ui";
import { useHosts } from "@/features/hosts/api";
import { useI18n } from "@/i18n";
import { filterHosts } from "./host-search";
import { useSftpStore, type PaneSide } from "./store";

export function NewTabMenu({
  side,
  children,
  align = "start",
  tooltip,
}: {
  side: PaneSide;
  children: ReactNode;
  align?: "start" | "center" | "end";
  tooltip?: string;
}) {
  const { t } = useI18n();
  const { data: hosts = [] } = useHosts();
  const addLocalTab = useSftpStore((state) => state.addLocalTab);
  const addRemoteTab = useSftpStore((state) => state.addRemoteTab);
  const inputRef = useRef<HTMLInputElement>(null);
  const [query, setQuery] = useState("");
  const filteredHosts = filterHosts(hosts, query);

  return (
    <DropdownMenu
      onOpenChange={(open) => {
        if (open) requestAnimationFrame(() => inputRef.current?.focus());
        else setQuery("");
      }}
    >
      {tooltip ? (
        <Tooltip content={tooltip}>
          <DropdownMenuTrigger asChild>{children}</DropdownMenuTrigger>
        </Tooltip>
      ) : (
        <DropdownMenuTrigger asChild>{children}</DropdownMenuTrigger>
      )}
      <DropdownMenuContent align={align} className="w-64 overflow-hidden">
        <div
          className="relative mb-1"
          onKeyDown={(event) => event.stopPropagation()}
        >
          <Search className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
          <Input
            ref={inputRef}
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder={t("sftp.hostSearchPlaceholder")}
            aria-label={t("sftp.hostSearchPlaceholder")}
            className="h-[var(--control-height-sm)] pl-8 text-xs"
          />
        </div>
        <div className="max-h-72 overflow-y-auto">
          <DropdownMenuItem onSelect={() => void addLocalTab(side)}>
            <HardDrive /> {t("sftp.local")}
          </DropdownMenuItem>
          {hosts.length > 0 && <DropdownMenuSeparator />}
          {filteredHosts.map((host) => (
            <DropdownMenuItem
              key={host.id}
              onSelect={() => addRemoteTab(side, host)}
            >
              <Server />
              <span className="min-w-0 truncate">{host.label}</span>
            </DropdownMenuItem>
          ))}
          {hosts.length > 0 && filteredHosts.length === 0 && (
            <p className="px-2 py-3 text-center text-xs text-muted-foreground">
              {t("sftp.noMatchingHosts")}
            </p>
          )}
        </div>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
