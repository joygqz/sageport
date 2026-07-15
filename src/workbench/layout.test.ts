import { describe, expect, it } from "vitest";

import macConfig from "../../src-tauri/tauri.macos.conf.json";
import baseConfig from "../../src-tauri/tauri.conf.json";
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
  bottomPanelLimits,
  horizontalPanelLimits,
} from "./layout-sizing";
import { DEFAULT_LAYOUT, normalizeLayoutSnapshot } from "./layout-state";

const DEFAULT_WINDOW = { width: 1280, height: 800 };
const MIN_WINDOW = { width: 960, height: 600 };

describe("workbench layout sizing", () => {
  it("uses the same practical window dimensions on every platform", () => {
    for (const config of [baseConfig, macConfig]) {
      const window = config.app.windows[0];
      expect({ width: window.width, height: window.height }).toEqual(
        DEFAULT_WINDOW,
      );
      expect({ width: window.minWidth, height: window.minHeight }).toEqual(
        MIN_WINDOW,
      );
    }
  });

  it("recovers malformed persisted layout values", () => {
    const normalized = normalizeLayoutSnapshot(
      {
        activity: "missing",
        sidebarVisible: "yes",
        sidebarWidth: Number.NaN,
        panelVisible: 1,
        panelHeight: Number.POSITIVE_INFINITY,
        auxVisible: null,
        auxWidth: -500,
      },
      { viewportWidth: 1280, viewportHeight: 800, scale: 1 },
    );

    expect(normalized).toEqual({
      ...DEFAULT_LAYOUT,
      auxWidth: AUX_MIN,
    });
  });

  it("reclaims editor room when independently enlarged side panes are shown", () => {
    const normalized = normalizeLayoutSnapshot(
      {
        ...DEFAULT_LAYOUT,
        sidebarVisible: true,
        sidebarWidth: 800,
        auxVisible: true,
        auxWidth: 800,
      },
      { viewportWidth: 1280, viewportHeight: 800, scale: 1 },
    );

    expect(
      1280 - ACTIVITY_BAR_W - normalized.sidebarWidth - normalized.auxWidth,
    ).toBeGreaterThanOrEqual(EDITOR_MIN_W);
    expect(normalized.sidebarWidth).toBeGreaterThanOrEqual(SIDEBAR_MIN);
    expect(normalized.auxWidth).toBeGreaterThanOrEqual(AUX_MIN);
  });

  it("clamps restored panel heights at the current zoom and viewport", () => {
    const scale = 1.5;
    const normalized = normalizeLayoutSnapshot(
      { ...DEFAULT_LAYOUT, panelVisible: true, panelHeight: 10_000 },
      { viewportWidth: 1280, viewportHeight: 800, scale },
    );

    expect(
      800 - (TITLE_BAR_H + STATUS_BAR_H) * scale - normalized.panelHeight,
    ).toBeGreaterThanOrEqual(EDITOR_MIN_H * scale);
  });

  it("keeps every default pane usable when all panes are visible", () => {
    const editorWidth =
      DEFAULT_WINDOW.width - ACTIVITY_BAR_W - SIDEBAR_DEFAULT - AUX_DEFAULT;
    const editorHeight =
      DEFAULT_WINDOW.height - TITLE_BAR_H - STATUS_BAR_H - PANEL_DEFAULT;

    expect(editorWidth).toBeGreaterThanOrEqual(EDITOR_MIN_W);
    expect(editorHeight).toBeGreaterThanOrEqual(EDITOR_MIN_H);
  });

  it("preserves scaled editor minimums in the default window at 150% zoom", () => {
    const scale = 1.5;
    const editorWidth =
      DEFAULT_WINDOW.width - (ACTIVITY_BAR_W + SIDEBAR_MIN + AUX_MIN) * scale;
    const editorHeight =
      DEFAULT_WINDOW.height - (TITLE_BAR_H + STATUS_BAR_H + PANEL_MIN) * scale;

    expect(editorWidth).toBeGreaterThanOrEqual(EDITOR_MIN_W * scale);
    expect(editorHeight).toBeGreaterThanOrEqual(EDITOR_MIN_H * scale);
  });

  it("allows the default pane sizes at the minimum window size", () => {
    const sidebar = horizontalPanelLimits(
      SIDEBAR_MIN,
      AUX_DEFAULT,
      MIN_WINDOW.width,
      1,
    );
    const aux = horizontalPanelLimits(
      AUX_MIN,
      SIDEBAR_DEFAULT,
      MIN_WINDOW.width,
      1,
    );
    const panel = bottomPanelLimits(MIN_WINDOW.height, 1);

    expect(sidebar.max).toBeGreaterThanOrEqual(SIDEBAR_DEFAULT);
    expect(aux.max).toBeGreaterThanOrEqual(AUX_DEFAULT);
    expect(panel.max).toBeGreaterThanOrEqual(PANEL_DEFAULT);
  });

  it("uses practical minimums and preserves an editor work area", () => {
    expect(SIDEBAR_MIN).toBeGreaterThanOrEqual(200);
    expect(AUX_MIN).toBeGreaterThanOrEqual(260);
    expect(PANEL_MIN).toBeGreaterThanOrEqual(180);

    expect(
      MIN_WINDOW.width - ACTIVITY_BAR_W - SIDEBAR_MIN - AUX_MIN,
    ).toBeGreaterThanOrEqual(EDITOR_MIN_W);
    expect(
      MIN_WINDOW.height - TITLE_BAR_H - STATUS_BAR_H - PANEL_MIN,
    ).toBeGreaterThanOrEqual(EDITOR_MIN_H);
  });
});
