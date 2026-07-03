import { KeyRound, Server, Settings, SquareTerminal } from "lucide-react";
import type { LucideIcon } from "lucide-react";

import { Tooltip } from "@/components/ui";
import { useI18n, type TKey } from "@/i18n";
import { cn } from "@/lib/utils";
import { useLayoutStore, type Activity } from "./layout";
import { useTabsStore } from "./tabs";

const ACTIVITIES: { id: Activity; icon: LucideIcon; labelKey: TKey }[] = [
  { id: "hosts", icon: Server, labelKey: "activityBar.hosts" },
  { id: "credentials", icon: KeyRound, labelKey: "activityBar.credentials" },
  { id: "snippets", icon: SquareTerminal, labelKey: "activityBar.snippets" },
];

/**
 * The icon rail on the far left. Selecting an activity switches the side
 * bar's view; reselecting the current one collapses the side bar, exactly
 * like VSCode. The gear at the bottom opens the settings tab.
 */
export function ActivityBar() {
  const { t } = useI18n();
  const activity = useLayoutStore((s) => s.activity);
  const sidebarVisible = useLayoutStore((s) => s.sidebarVisible);
  const selectActivity = useLayoutStore((s) => s.selectActivity);
  const openSettings = useTabsStore((s) => s.openSettings);
  const settingsActive = useTabsStore(
    (s) => s.activeId === "settings" && s.tabs.some((x) => x.id === "settings"),
  );

  return (
    <nav className="flex w-12 shrink-0 flex-col items-center justify-between border-r border-border bg-surface py-1">
      <div className="flex flex-col items-center gap-1">
        {ACTIVITIES.map((item) => {
          const Icon = item.icon;
          const active = sidebarVisible && activity === item.id;
          return (
            <Tooltip key={item.id} content={t(item.labelKey)} side="right">
              <button
                onClick={() => selectActivity(item.id)}
                aria-pressed={active}
                className={cn(
                  "relative flex size-10 items-center justify-center rounded-md transition-colors",
                  active
                    ? "text-foreground"
                    : "text-muted-foreground/75 hover:text-foreground",
                )}
              >
                {/* VSCode-style active indicator: a bar on the rail edge. */}
                <span
                  className={cn(
                    "absolute inset-y-1.5 -left-1 w-[3px] bg-primary transition-opacity",
                    active ? "opacity-100" : "opacity-0",
                  )}
                />
                <Icon className="size-6" strokeWidth={1.5} />
              </button>
            </Tooltip>
          );
        })}
      </div>

      <Tooltip content={t("activityBar.settings")} side="right">
        <button
          onClick={() => openSettings()}
          className={cn(
            "flex size-10 items-center justify-center rounded-md transition-colors",
            settingsActive
              ? "text-foreground"
              : "text-muted-foreground/75 hover:text-foreground",
          )}
        >
          <Settings className="size-6" strokeWidth={1.5} />
        </button>
      </Tooltip>
    </nav>
  );
}
