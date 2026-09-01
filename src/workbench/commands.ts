import { useMemo } from "react";

import { writeText } from "@tauri-apps/plugin-clipboard-manager";

import { useI18n, type TKey } from "@/i18n";
import { useBroadcastStore } from "@/features/terminal/broadcast";
import { pasteIntoTerminal } from "@/features/terminal/paste";
import { getSession } from "@/features/terminal/sessions";
import { IS_MACOS } from "@/lib/platform";
import { THEMES } from "@/themes";
import { useTheme } from "@/themes/useTheme";
import { useLayoutStore, type Activity } from "./layout";
import {
  keybindingDisplayKeys,
  type KeybindingId,
  type KeybindingOverrides,
} from "./keybinding-registry";
import { useKeybindingStore } from "./keybinding-store";
import { useOverlayStore } from "./overlays";
import { activePane, useTabsStore, type TerminalPane } from "./tabs";

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

function activeTerminalPane(): TerminalPane | undefined {
  const state = useTabsStore.getState();
  const active = state.tabs.find((tab) => tab.id === state.activeId);
  if (active?.kind !== "terminal") return;
  return activePane(active);
}

export function copyActivePane(): void {
  const pane = activeTerminalPane();
  if (!pane) return;
  const term = getSession(pane.id)?.term;
  if (!term?.hasSelection()) return;
  void writeText(term.getSelection());
}

export function pasteActivePane(): void {
  const pane = activeTerminalPane();
  if (!pane) return;
  const session = getSession(pane.id);
  if (!session) return;
  void pasteIntoTerminal(session.term, { images: pane.target === "local" });
}

function commandShortcut(
  id: KeybindingId,
  overrides: KeybindingOverrides,
): string[] | undefined {
  return keybindingDisplayKeys(id, overrides, IS_MACOS);
}

export function useCommands(): WorkbenchCommand[] {
  const { t } = useI18n();
  const { setTheme } = useTheme();
  const keybindingOverrides = useKeybindingStore((state) => state.overrides);

  return useMemo(() => {
    const layout = useLayoutStore.getState;
    const overlays = useOverlayStore.getState;
    const tabs = useTabsStore.getState;

    const commands: WorkbenchCommand[] = [
      {
        id: "host.new",
        categoryKey: "commands.category.hosts",
        label: t("commands.host.new"),
        shortcut: commandShortcut("host.new", keybindingOverrides),
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
        shortcut: commandShortcut("terminal.newLocal", keybindingOverrides),
        run: () => tabs().openLocalTerminal(),
      },
      {
        id: "terminal.toggleBroadcast",
        categoryKey: "commands.category.terminal",
        label: t("commands.terminal.toggleBroadcast"),
        shortcut: commandShortcut(
          "terminal.toggleBroadcast",
          keybindingOverrides,
        ),
        run: () => useBroadcastStore.getState().toggle(),
      },
      {
        id: "terminal.splitRight",
        categoryKey: "commands.category.terminal",
        label: t("commands.terminal.splitRight"),
        shortcut: commandShortcut("terminal.splitRight", keybindingOverrides),
        run: () => splitActivePane("right"),
      },
      {
        id: "terminal.splitDown",
        categoryKey: "commands.category.terminal",
        label: t("commands.terminal.splitDown"),
        shortcut: commandShortcut("terminal.splitDown", keybindingOverrides),
        run: () => splitActivePane("down"),
      },
      {
        id: "terminal.focusNextPane",
        categoryKey: "commands.category.terminal",
        label: t("commands.terminal.focusNextPane"),
        shortcut: commandShortcut(
          "terminal.focusNextPane",
          keybindingOverrides,
        ),
        run: () => useTabsStore.getState().focusPaneNext(1),
      },
      {
        id: "terminal.copy",
        categoryKey: "commands.category.terminal",
        label: t("commands.terminal.copy"),
        shortcut: commandShortcut("terminal.copy", keybindingOverrides),
        run: () => copyActivePane(),
      },
      {
        id: "terminal.paste",
        categoryKey: "commands.category.terminal",
        label: t("commands.terminal.paste"),
        shortcut: commandShortcut("terminal.paste", keybindingOverrides),
        run: () => pasteActivePane(),
      },
      {
        id: "view.toggleSidebar",
        categoryKey: "commands.category.view",
        label: t("commands.view.toggleSidebar"),
        shortcut: commandShortcut("view.toggleSidebar", keybindingOverrides),
        run: () => layout().toggleSidebar(),
      },
      {
        id: "view.togglePanel",
        categoryKey: "commands.category.view",
        label: t("commands.view.togglePanel"),
        shortcut: commandShortcut("view.togglePanel", keybindingOverrides),
        run: () => layout().togglePanel(),
      },
      {
        id: "view.toggleAssistant",
        categoryKey: "commands.category.view",
        label: t("commands.view.toggleAssistant"),
        shortcut: commandShortcut("view.toggleAssistant", keybindingOverrides),
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
        shortcut: commandShortcut("tab.close", keybindingOverrides),
        run: () => {
          const { activeId, close } = tabs();
          if (activeId) close(activeId);
        },
      },
      {
        id: "settings.open",
        categoryKey: "commands.category.preferences",
        label: t("commands.settings.open"),
        shortcut: commandShortcut("settings.open", keybindingOverrides),
        run: () => overlays().openSettings(),
      },
      ...(
        ["general", "network", "keybindings", "ai", "sync", "about"] as const
      ).map((section) => ({
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
  }, [t, setTheme, keybindingOverrides]);
}
