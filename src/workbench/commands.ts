import { useMemo } from "react";

import { useI18n, type TKey } from "@/i18n";
import { THEMES } from "@/themes";
import { useTheme } from "@/themes/useTheme";
import { useLayoutStore } from "./layout";
import { useOverlayStore } from "./overlays";
import { useTabsStore } from "./tabs";

export interface WorkbenchCommand {
  id: string;

  categoryKey: TKey;
  label: string;

  shortcut?: string[];
  run: () => void;
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
        run: () => tabs().openSettings(),
      },
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
