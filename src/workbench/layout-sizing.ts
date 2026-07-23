export const SIDEBAR_MIN = 200;
export const PANEL_MIN = 180;
export const AUX_MIN = 260;

export const SIDEBAR_DEFAULT = 260;
export const PANEL_DEFAULT = 280;
export const AUX_DEFAULT = 320;

export const ACTIVITY_BAR_W = 48.75;
export const TITLE_BAR_H = 37.5;
export const STATUS_BAR_H = 22.5;

export const EDITOR_MIN_W = 320;
export const EDITOR_MIN_H = 180;

export interface SashLimits {
  min: number;
  max: number;
}

export function horizontalPanelLimits(
  minimum: number,
  otherPanelWidth: number,
  viewportWidth: number,
  scale: number,
): SashLimits {
  const min = minimum * scale;
  const roomMax =
    viewportWidth - (ACTIVITY_BAR_W + EDITOR_MIN_W) * scale - otherPanelWidth;
  return { min, max: Math.max(min, roomMax) };
}

export function bottomPanelLimits(
  viewportHeight: number,
  scale: number,
): SashLimits {
  const min = PANEL_MIN * scale;
  const roomMax =
    viewportHeight - (TITLE_BAR_H + STATUS_BAR_H + EDITOR_MIN_H) * scale;
  return { min, max: Math.max(min, roomMax) };
}
