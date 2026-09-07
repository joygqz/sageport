import {
  Gauge,
  KeyRound,
  Network,
  Server,
  Settings,
  SquareTerminal,
  Workflow,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { memo } from "react";

import { Tooltip } from "@/components/ui/tooltip";
import { INTERACTIVE_FOCUS_CLASS } from "@/components/ui/styles";
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
  { id: "tasks", icon: Workflow, labelKey: "activityBar.tasks" },
  { id: "forwards", icon: Network, labelKey: "activityBar.forwards" },
  { id: "monitor", icon: Gauge, labelKey: "activityBar.monitor" },
];

const ACTIVITY_BUTTON_CLASS = cn(
  "flex w-full items-center justify-center px-0.5 py-3.5 transition-colors",
  INTERACTIVE_FOCUS_CLASS,
);

export const ActivityBar = memo(function ActivityBar() {
  const { t } = useI18n();
  const activity = useLayoutStore((s) => s.activity);
  const sidebarVisible = useLayoutStore((s) => s.sidebarVisible);
  const selectActivity = useLayoutStore((s) => s.selectActivity);
  const openSettings = useOverlayStore((s) => s.openSettings);

  return (
    <nav
      aria-label={t("activityBar.navigation")}
      className="activity-rail flex w-[var(--activitybar-width)] shrink-0 flex-col items-center justify-between gap-3 overflow-y-auto border-r border-border-subtle bg-surface-sunken"
    >
      <div className="flex w-full flex-col items-center">
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
