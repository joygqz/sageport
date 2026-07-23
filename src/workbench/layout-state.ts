import {
  ACTIVITY_BAR_W,
  AUX_DEFAULT,
  AUX_MIN,
  EDITOR_MIN_H,
  EDITOR_MIN_W,
  PANEL_DEFAULT,
  PANEL_MIN,
  SIDEBAR_DEFAULT,
  SIDEBAR_MIN,
  STATUS_BAR_H,
  TITLE_BAR_H,
} from "./layout-sizing";

const ACTIVITIES = [
  "hosts",
  "credentials",
  "snippets",
  "tasks",
  "forwards",
  "monitor",
] as const;

export type Activity = (typeof ACTIVITIES)[number];

export interface LayoutSnapshot {
  activity: Activity;
  sidebarVisible: boolean;
  sidebarWidth: number;
  panelVisible: boolean;
  panelHeight: number;
  auxVisible: boolean;
  auxWidth: number;
}

export interface LayoutEnvironment {
  viewportWidth: number;
  viewportHeight: number;
  scale: number;
}

export const DEFAULT_LAYOUT: LayoutSnapshot = {
  activity: "hosts",
  sidebarVisible: true,
  sidebarWidth: SIDEBAR_DEFAULT,
  panelVisible: false,
  panelHeight: PANEL_DEFAULT,
  auxVisible: false,
  auxWidth: AUX_DEFAULT,
};

const clamp = (value: number, min: number, max: number) =>
  Math.max(min, Math.min(value, max));

const finiteNumber = (value: unknown, fallback: number) =>
  typeof value === "number" && Number.isFinite(value) ? value : fallback;

const boolean = (value: unknown, fallback: boolean) =>
  typeof value === "boolean" ? value : fallback;

const activity = (value: unknown, fallback: Activity): Activity =>
  typeof value === "string" && (ACTIVITIES as readonly string[]).includes(value)
    ? (value as Activity)
    : fallback;

function record(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === "object"
    ? (value as Record<string, unknown>)
    : {};
}

export function normalizeLayoutSnapshot(
  value: unknown,
  environment: LayoutEnvironment,
  fallback: LayoutSnapshot = DEFAULT_LAYOUT,
): LayoutSnapshot {
  const input = record(value);
  const scale = Math.max(0.1, finiteNumber(environment.scale, 1));
  const viewportWidth = Math.max(0, finiteNumber(environment.viewportWidth, 0));
  const viewportHeight = Math.max(
    0,
    finiteNumber(environment.viewportHeight, 0),
  );

  const sidebarVisible = boolean(input.sidebarVisible, fallback.sidebarVisible);
  const panelVisible = boolean(input.panelVisible, fallback.panelVisible);
  const auxVisible = boolean(input.auxVisible, fallback.auxVisible);

  const sidebarMin = SIDEBAR_MIN * scale;
  const auxMin = AUX_MIN * scale;
  const horizontalRoom = Math.max(
    sidebarMin + auxMin,
    viewportWidth - (ACTIVITY_BAR_W + EDITOR_MIN_W) * scale,
  );
  const sidebarMax = Math.max(sidebarMin, horizontalRoom);
  const auxMax = Math.max(auxMin, horizontalRoom);

  let sidebarWidth = clamp(
    finiteNumber(input.sidebarWidth, fallback.sidebarWidth),
    sidebarMin,
    sidebarMax,
  );
  let auxWidth = clamp(
    finiteNumber(input.auxWidth, fallback.auxWidth),
    auxMin,
    auxMax,
  );

  if (
    sidebarVisible &&
    auxVisible &&
    sidebarWidth + auxWidth > horizontalRoom
  ) {
    const availableExtra = Math.max(0, horizontalRoom - sidebarMin - auxMin);
    const sidebarExtra = sidebarWidth - sidebarMin;
    const auxExtra = auxWidth - auxMin;
    const extra = sidebarExtra + auxExtra;
    const ratio = extra > 0 ? availableExtra / extra : 0;
    sidebarWidth = sidebarMin + sidebarExtra * ratio;
    auxWidth = auxMin + auxExtra * ratio;
  }

  const panelMin = PANEL_MIN * scale;
  const panelMax = Math.max(
    panelMin,
    viewportHeight - (TITLE_BAR_H + STATUS_BAR_H + EDITOR_MIN_H) * scale,
  );
  const panelHeight = clamp(
    finiteNumber(input.panelHeight, fallback.panelHeight),
    panelMin,
    panelMax,
  );

  return {
    activity: activity(input.activity, fallback.activity),
    sidebarVisible,
    sidebarWidth,
    panelVisible,
    panelHeight,
    auxVisible,
    auxWidth,
  };
}
