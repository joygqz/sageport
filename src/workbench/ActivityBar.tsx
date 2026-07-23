import {
  Gauge,
  KeyRound,
  Network,
  Server,
  Settings,
  SquareTerminal,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { memo } from "react";

import { Tooltip } from "@/components/ui/tooltip";
import { useI18n, type TKey } from "@/i18n";
import { cn } from "@/lib/utils";
import { useLayoutStore, type Activity } from "./layout";
import { useOverlayStore } from "./overlays";
import {
  WORKBENCH_ITEM_ACTIVE_CLASS,
  WORKBENCH_ITEM_INACTIVE_CLASS,
} from "./tab-styles";

const ACTIVITIES: { id: Activity; icon: LucideIcon; labelKey: TKey }[] = [
  { id: "hosts", icon: Server, labelKey: "activityBar.hosts" },
  { id: "credentials", icon: KeyRound, labelKey: "activityBar.credentials" },
  { id: "snippets", icon: SquareTerminal, labelKey: "activityBar.snippets" },
  { id: "forwards", icon: Network, labelKey: "activityBar.forwards" },
  { id: "monitor", icon: Gauge, labelKey: "activityBar.monitor" },
];

const ACTIVITY_BUTTON_CLASS =
  "flex size-9 items-center justify-center rounded-lg outline-none transition-[background-color,color,box-shadow] focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring/60";

export const ActivityBar = memo(function ActivityBar() {
  const { t } = useI18n();
  const activity = useLayoutStore((s) => s.activity);
  const sidebarVisible = useLayoutStore((s) => s.sidebarVisible);
  const selectActivity = useLayoutStore((s) => s.selectActivity);
  const openSettings = useOverlayStore((s) => s.openSettings);

  return (
    <nav className="flex w-[var(--activitybar-width)] shrink-0 flex-col items-center justify-between border-r border-border bg-surface/95 py-2">
      <div className="flex flex-col items-center gap-1.5">
        {ACTIVITIES.map((item) => {
          const Icon = item.icon;
          const active = sidebarVisible && activity === item.id;
          return (
            <Tooltip key={item.id} content={t(item.labelKey)} side="right">
              <button
                type="button"
                onClick={() => selectActivity(item.id)}
                aria-label={t(item.labelKey)}
                aria-pressed={active}
                className={cn(
                  ACTIVITY_BUTTON_CLASS,
                  "relative",
                  active
                    ? WORKBENCH_ITEM_ACTIVE_CLASS
                    : WORKBENCH_ITEM_INACTIVE_CLASS,
                )}
              >
                <Icon className="size-5" strokeWidth={1.75} />
              </button>
            </Tooltip>
          );
        })}
      </div>

      <Tooltip content={t("activityBar.settings")} side="right">
        <button
          type="button"
          onClick={() => openSettings()}
          aria-label={t("activityBar.settings")}
          aria-haspopup="dialog"
          className={cn(ACTIVITY_BUTTON_CLASS, WORKBENCH_ITEM_INACTIVE_CLASS)}
        >
          <Settings className="size-5" strokeWidth={1.75} />
        </button>
      </Tooltip>
    </nav>
  );
});
