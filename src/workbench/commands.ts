import { useMemo } from "react";

import { useI18n, type TKey } from "@/i18n";
import { THEMES } from "@/themes";
import { useTheme } from "@/themes/useTheme";
import { useLayoutStore } from "./layout";
import { useOverlayStore } from "./overlays";
import { useTabsStore } from "./tabs";

/**
 * The command registry behind the command palette. Every entry is also
 * reachable through menus or shortcuts; the palette is an accelerator,
 * never the only path to a feature.
 */

export interface WorkbenchCommand {
  id: string;
  /** Category prefix, rendered as "Category: label" like VSCode. */
  categoryKey: TKey;
  label: string;
  /** Display-only shortcut hint, e.g. ["mod", "N"]. */
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
