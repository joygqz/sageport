import { describe, expect, it } from "vitest";

import {
  DEFAULT_THEME_ID,
  getTheme,
  resolveTheme,
  THEME_FAMILIES,
  THEMES,
} from "./themes";

function relativeLuminance(hex: string): number {
  const channels = hex
    .slice(1)
    .match(/.{2}/g)!
    .map((value) => Number.parseInt(value, 16) / 255)
    .map((value) =>
      value <= 0.04045 ? value / 12.92 : Math.pow((value + 0.055) / 1.055, 2.4),
    );
  return channels[0] * 0.2126 + channels[1] * 0.7152 + channels[2] * 0.0722;
}

function contrast(a: string, b: string): number {
  const lighter = Math.max(relativeLuminance(a), relativeLuminance(b));
  const darker = Math.min(relativeLuminance(a), relativeLuminance(b));
  return (lighter + 0.05) / (darker + 0.05);
}

describe("themes", () => {
  it("provides three complete, paired theme families", () => {
    expect(THEME_FAMILIES).toHaveLength(3);
    expect(THEMES).toHaveLength(6);
    expect(new Set(THEMES.map((theme) => theme.id)).size).toBe(THEMES.length);
    expect(getTheme(DEFAULT_THEME_ID).id).toBe(DEFAULT_THEME_ID);

    for (const family of THEME_FAMILIES) {
      expect(family.themes.light.familyId).toBe(family.id);
      expect(family.themes.light.appearance).toBe("light");
      expect(family.themes.dark.familyId).toBe(family.id);
      expect(family.themes.dark.appearance).toBe("dark");
    }

    for (const theme of THEMES) {
      for (const value of [
        ...Object.values(theme.colors),
        ...Object.values(theme.terminal),
      ]) {
        expect(value, `${theme.id}: ${value}`).toMatch(/^#[0-9a-f]{6}$/i);
      }
    }
  });

  it("keeps essential text and controls at WCAG AA contrast", () => {
    for (const theme of THEMES) {
      const pairs = [
        [theme.colors.foreground, theme.colors.background, "foreground"],
        [
          theme.colors.mutedForeground,
          theme.colors.background,
          "muted foreground",
        ],
        [theme.colors.surfaceForeground, theme.colors.surface, "surface"],
        [theme.colors.popoverForeground, theme.colors.popover, "popover"],
        [theme.colors.cardForeground, theme.colors.card, "card"],
        [
          theme.colors.primaryForeground,
          theme.colors.primary,
          "primary control",
        ],
        [theme.colors.link, theme.colors.background, "link text"],
        [theme.colors.success, theme.colors.background, "success status"],
        [theme.colors.warning, theme.colors.background, "warning status"],
        [theme.colors.info, theme.colors.background, "info status"],
        [
          theme.colors.destructiveForeground,
          theme.colors.destructive,
          "destructive control",
        ],
        [theme.colors.danger, theme.colors.background, "danger text"],
        [
          theme.colors.listActiveForeground,
          theme.colors.listActive,
          "selected row",
        ],
        [theme.terminal.foreground, theme.terminal.background, "terminal"],
      ] as const;

      for (const [foreground, background, label] of pairs) {
        expect(
          contrast(foreground, background),
          `${theme.name} ${label}`,
        ).toBeGreaterThanOrEqual(4.5);
      }
    }
  });

  it("resolves system mode without changing the selected family", () => {
    expect(
      resolveTheme({ familyId: "midnight", mode: "system" }, "light").id,
    ).toBe("midnight-light");
    expect(
      resolveTheme({ familyId: "midnight", mode: "system" }, "dark").id,
    ).toBe("midnight-dark");
  });

  it("maps retired theme ids to the closest new family", () => {
    expect(getTheme("dark-modern").id).toBe("midnight-dark");
    expect(getTheme("one-dark").id).toBe("graphite-dark");
    expect(getTheme("light-modern").id).toBe("midnight-light");
    expect(getTheme("dracula").id).toBe("dracula-dark");
    expect(getTheme("solarized-light").id).toBe("dracula-light");
  });
});
