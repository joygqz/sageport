import { useMemo } from "react";

import { useI18n, type TKey } from "@/i18n";
import { useBroadcastStore } from "@/features/terminal/broadcast";
import { THEMES } from "@/themes";
import { useTheme } from "@/themes/useTheme";
import { useLayoutStore, type Activity } from "./layout";
import { useOverlayStore } from "./overlays";
import { useTabsStore } from "./tabs";

export interface WorkbenchCommand {
  id: string;

  categoryKey: TKey;
  label: string;

  shortcut?: string[];
  run: () => void;
}

function splitActivePane(direction: "right" | "down") {
  const state = useTabsStore.getState();
  const active = state.tabs.find((tab) => tab.id === state.activeId);
  if (active?.kind === "terminal") {
    state.splitPane(active.activePaneId, direction);
  }
}

function showActivity(activity: Activity) {
  const layout = useLayoutStore.getState();
  if (layout.activity !== activity || !layout.sidebarVisible) {
    layout.selectActivity(activity);
  }
}

export function useCommands(): WorkbenchCommand[] {
  const { t } = useI18n();
  const { setTheme } = useTheme();

  return useMemo(() => {
    const layout = useLayoutStore.getState;
    const overlays = useOverlayStore.getState;
    const tabs = useTabsStore.getState;

    const commands: WorkbenchCommand[] = [
      {
        id: "host.new",
        categoryKey: "commands.category.hosts",
        label: t("commands.host.new"),
        shortcut: ["mod", "N"],
        run: () => overlays().openHostForm(),
      },
      {
        id: "group.new",
        categoryKey: "commands.category.hosts",
        label: t("commands.group.new"),
        run: () => overlays().openGroupForm(),
      },
      {
        id: "terminal.newLocal",
        categoryKey: "commands.category.terminal",
        label: t("commands.terminal.newLocal"),
        shortcut: ["mod", "shift", "T"],
        run: () => tabs().openLocalTerminal(),
      },
      {
        id: "terminal.toggleBroadcast",
        categoryKey: "commands.category.terminal",
        label: t("commands.terminal.toggleBroadcast"),
        shortcut: ["mod", "shift", "B"],
        run: () => useBroadcastStore.getState().toggle(),
      },
      {
        id: "terminal.splitRight",
        categoryKey: "commands.category.terminal",
        label: t("commands.terminal.splitRight"),
        shortcut: ["mod", "\\"],
        run: () => splitActivePane("right"),
      },
      {
        id: "terminal.splitDown",
        categoryKey: "commands.category.terminal",
        label: t("commands.terminal.splitDown"),
        shortcut: ["mod", "shift", "\\"],
        run: () => splitActivePane("down"),
      },
      {
        id: "terminal.focusNextPane",
        categoryKey: "commands.category.terminal",
        label: t("commands.terminal.focusNextPane"),
        shortcut: ["mod", "]"],
        run: () => useTabsStore.getState().focusPaneNext(1),
      },
      {
        id: "view.toggleSidebar",
        categoryKey: "commands.category.view",
        label: t("commands.view.toggleSidebar"),
        shortcut: ["mod", "B"],
        run: () => layout().toggleSidebar(),
      },
      {
        id: "view.togglePanel",
        categoryKey: "commands.category.view",
        label: t("commands.view.togglePanel"),
        shortcut: ["mod", "J"],
        run: () => layout().togglePanel(),
      },
      {
        id: "view.toggleAssistant",
        categoryKey: "commands.category.view",
        label: t("commands.view.toggleAssistant"),
        shortcut: ["mod", "L"],
        run: () => layout().toggleAux(),
      },
      ...(
        [
          "hosts",
          "credentials",
          "snippets",
          "tasks",
          "forwards",
          "monitor",
        ] as const
      ).map((activity) => ({
        id: `view.${activity}`,
        categoryKey: "commands.category.view" as TKey,
        label: t(`activityBar.${activity}`),
        run: () => showActivity(activity),
      })),
      {
        id: "tab.close",
        categoryKey: "commands.category.view",
        label: t("commands.tab.close"),
        shortcut: ["mod", "W"],
        run: () => {
          const { activeId, close } = tabs();
          if (activeId) close(activeId);
        },
      },
      {
        id: "settings.open",
        categoryKey: "commands.category.preferences",
        label: t("commands.settings.open"),
        shortcut: ["mod", ","],
        run: () => overlays().openSettings(),
      },
      ...(["general", "ai", "sync", "about"] as const).map((section) => ({
        id: `settings.${section}`,
        categoryKey: "commands.category.preferences" as TKey,
        label: t(`settings.nav.${section}`),
        run: () => overlays().openSettings(section),
      })),
      ...THEMES.map((theme) => ({
        id: `theme.${theme.id}`,
        categoryKey: "commands.category.theme" as TKey,
        label: theme.name,
        run: () => setTheme(theme.id),
      })),
    ];
    return commands;
  }, [t, setTheme]);
}
