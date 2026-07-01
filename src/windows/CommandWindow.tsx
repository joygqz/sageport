import { useEffect, useMemo, useState } from "react";
import { getCurrentWebviewWindow } from "@tauri-apps/api/webviewWindow";
import { Server } from "lucide-react";

import { Input } from "@/components/ui/input";
import { useI18n } from "@/i18n";
import { cn } from "@/lib/utils";
import { closeSelf, emitAction } from "@/lib/windows";
import type { Host } from "@/types/models";
import { useHosts } from "@/features/hosts/api";

export function CommandWindow() {
  const { t } = useI18n();
  const { data: hosts = [] } = useHosts();
  const [query, setQuery] = useState("");
  const [index, setIndex] = useState(0);

  // Dismiss the launcher when it loses focus (Spotlight-style).
  useEffect(() => {
    const win = getCurrentWebviewWindow();
    const unlisten = win.onFocusChanged(({ payload: focused }) => {
      if (!focused) void closeSelf();
    });
    return () => {
      void unlisten.then((un) => un());
    };
  }, []);

  const results = useMemo(() => {
    const q = query.trim().toLowerCase();
    const list = q
      ? hosts.filter(
          (h) =>
            h.label.toLowerCase().includes(q) ||
            h.address.toLowerCase().includes(q),
        )
      : hosts;
    return list.slice(0, 50);
  }, [hosts, query]);

  const choose = (host: Host) => {
    void emitAction({ type: "open-host", hostId: host.id });
    void closeSelf();
  };

  return (
    // Transparent inset so the rounded card floats clear of the window's
    // rectangular edge (which otherwise renders a faint hairline on macOS).
    <div className="h-full p-2.5">
      <div className="flex h-full flex-col overflow-hidden rounded-xl border border-border bg-popover shadow-2xl">
        <Input
          autoFocus
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
            setIndex(0);
          }}
          onKeyDown={(e) => {
            if (e.key === "ArrowDown") {
              e.preventDefault();
              setIndex((i) => Math.min(i + 1, results.length - 1));
            } else if (e.key === "ArrowUp") {
              e.preventDefault();
              setIndex((i) => Math.max(i - 1, 0));
            } else if (e.key === "Enter" && results[index]) {
              choose(results[index]);
            } else if (e.key === "Escape") {
              void closeSelf();
            }
          }}
          placeholder={t("commandPalette.searchPlaceholder")}
          className="h-12 rounded-none border-0 border-b border-border text-base shadow-none focus-visible:ring-0"
        />
        <div className="min-h-0 flex-1 overflow-y-auto p-1.5">
          {results.length === 0 ? (
            <p className="px-3 py-6 text-center text-sm text-muted-foreground">
              {t("commandPalette.noHosts")}
            </p>
          ) : (
            results.map((host, i) => (
              <button
                key={host.id}
                onMouseEnter={() => setIndex(i)}
                onClick={() => choose(host)}
                className={cn(
                  "flex w-full items-center gap-3 rounded-md px-3 py-2 text-left text-sm",
                  i === index
                    ? "bg-accent text-accent-foreground"
                    : "text-foreground",
                )}
              >
                <Server className="size-4 text-muted-foreground" />
                <span className="font-medium">{host.label}</span>
                <span className="ml-auto text-xs text-muted-foreground">
                  {host.username ? `${host.username}@` : ""}
                  {host.address}
                </span>
              </button>
            ))
          )}
        </div>
      </div>
    </div>
  );
}
