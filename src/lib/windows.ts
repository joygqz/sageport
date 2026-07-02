import {
  getCurrentWebviewWindow,
  WebviewWindow,
} from "@tauri-apps/api/webviewWindow";
import { LogicalPosition, type TitleBarStyle } from "@tauri-apps/api/window";
import { emit } from "@tauri-apps/api/event";

import { detectLocale } from "@/i18n/config";
import { translate, type TKey } from "@/i18n/translate";

/**
 * Multi-window helpers. Every "dialog" in the app is a real OS window that
 * loads the same bundle with a `#/<view>` hash. Windows talk to each other over
 * two Tauri events: `REFRESH_EVENT` (invalidate cached queries everywhere) and
 * `ACTION_EVENT` (ask the main window to do something stateful).
 */

export const REFRESH_EVENT = "sageport://refresh";
export const ACTION_EVENT = "sageport://action";
export const THEME_EVENT = "sageport://theme";
export const LOCALE_EVENT = "sageport://locale";

/** Matches the `h-9` custom title bar height used by overlay windows. */
const TRAFFIC_LIGHT_POSITION = new LogicalPosition(20, 20);

/** Translate an OS window title using the persisted locale (no React here). */
function title(key: TKey): string {
  return translate(detectLocale(), key);
}

export type WindowAction = { type: "run-command"; command: string };

interface OpenOptions {
  label: string;
  view: string;
  id?: string;
  title: string;
  width: number;
  height: number;
  resizable?: boolean;
  decorations?: boolean;
  alwaysOnTop?: boolean;
  transparent?: boolean;
  shadow?: boolean;
  titleBarStyle?: TitleBarStyle;
  hiddenTitle?: boolean;
}

async function openWindow(opts: OpenOptions) {
  const existing = await WebviewWindow.getByLabel(opts.label);
  if (existing) {
    if (await existing.isMinimized()) {
      await existing.unminimize();
    }
    await existing.show();
    await existing.setFocus();
    return;
  }
  const hash = `#/${opts.view}${opts.id ? `?id=${encodeURIComponent(opts.id)}` : ""}`;
  const win = new WebviewWindow(opts.label, {
    url: `index.html${hash}`,
    title: opts.title,
    width: opts.width,
    height: opts.height,
    minWidth: 360,
    minHeight: opts.height < 320 ? opts.height : 320,
    resizable: opts.resizable ?? true,
    decorations: opts.decorations ?? true,
    alwaysOnTop: opts.alwaysOnTop ?? false,
    transparent: opts.transparent ?? false,
    shadow: opts.shadow ?? true,
    titleBarStyle: opts.titleBarStyle,
    hiddenTitle: opts.hiddenTitle,
    trafficLightPosition:
      opts.titleBarStyle === "overlay" ? TRAFFIC_LIGHT_POSITION : undefined,
    center: true,
    focus: true,
  });
  win.once("tauri://error", (e) => console.error("window error", e));
}

export function openSettingsWindow() {
  return openWindow({
    label: "settings",
    view: "settings",
    title: title("windowTitles.settings"),
    width: 760,
    height: 580,
    titleBarStyle: "overlay",
    hiddenTitle: true,
  });
}

export function openHostWindow(hostId?: string) {
  return openWindow({
    label: hostId ? `host-${hostId}` : "host-new",
    view: "host",
    id: hostId,
    title: hostId ? title("windowTitles.editHost") : title("windowTitles.newHost"),
    width: 560,
    height: 620,
  });
}

export function openGroupsWindow(groupId?: string) {
  return openWindow({
    label: groupId ? `group-${groupId}` : "group-new",
    view: "groups",
    id: groupId,
    title: groupId
      ? title("windowTitles.editGroup")
      : title("windowTitles.newGroup"),
    width: 420,
    height: 220,
    resizable: false,
  });
}

/** Tell every window to refetch its data (call after a mutation). */
export function emitRefresh() {
  return emit(REFRESH_EVENT);
}

/** Ask the main window to perform a stateful action. */
export function emitAction(action: WindowAction) {
  return emit(ACTION_EVENT, action);
}

/** Close the window this code is running in. */
export function closeSelf() {
  return getCurrentWebviewWindow().close();
}
