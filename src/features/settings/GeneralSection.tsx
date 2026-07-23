import { Check, Laptop, Minus, Moon, Plus, Sun } from "lucide-react";

import {
  Button,
  CONTROL_BORDER_CLASS,
  CONTROL_FOCUS_CLASS,
  Field,
  Kbd,
  RadioGroup,
  RadioGroupItem,
  SegmentedControl,
  Select,
  Tooltip,
} from "@/components/ui";
import { LOCALE_LABELS, LOCALES, useI18n, type TKey } from "@/i18n";
import { cn } from "@/lib/utils";
import {
  THEME_FAMILIES,
  useTheme,
  type ThemeAppearance,
  type ThemeFamilyDefinition,
  type ThemeMode,
} from "@/themes";
import { useFontStore } from "@/workbench/font";
import {
  useZoomStore,
  zoomFactor,
  ZOOM_LEVEL_MAX,
  ZOOM_LEVEL_MIN,
} from "@/workbench/zoom";
import { AutostartSetting } from "./AutostartSetting";
import { DraftInput } from "./DraftInput";
import { SettingsGroup, SETTINGS_GROUP_STACK_CLASS } from "./SettingsGroup";

const THEME_DESCRIPTION_KEYS: Record<string, TKey> = {
  midnight: "settings.general.theme.familyMidnight",
  graphite: "settings.general.theme.familyGraphite",
  dracula: "settings.general.theme.familyDracula",
};

export function GeneralSection() {
  return (
    <div className={SETTINGS_GROUP_STACK_CLASS}>
      <ThemeSettings />
      <DisplaySettings />
      <AutostartSetting />
    </div>
  );
}

function ThemeSettings() {
  const { t } = useI18n();
  const { preference, setFamily, setMode } = useTheme();
  const modes: { value: ThemeMode; label: React.ReactNode }[] = [
    {
      value: "system",
      label: (
        <span className="flex items-center justify-center gap-2">
          <Laptop className="size-3.5" />
          {t("settings.general.theme.modeSystem")}
        </span>
      ),
    },
    {
      value: "light",
      label: (
        <span className="flex items-center justify-center gap-2">
          <Sun className="size-3.5" />
          {t("settings.general.theme.modeLight")}
        </span>
      ),
    },
    {
      value: "dark",
      label: (
        <span className="flex items-center justify-center gap-2">
          <Moon className="size-3.5" />
          {t("settings.general.theme.modeDark")}
        </span>
      ),
    },
  ];

  return (
    <SettingsGroup title={t("settings.general.theme.title")}>
      <Field label={t("settings.general.theme.colorMode")}>
        <SegmentedControl
          value={preference.mode}
          onChange={setMode}
          options={modes}
        />
      </Field>

      <Field label={t("settings.general.theme.family")}>
        <RadioGroup
          value={preference.familyId}
          onValueChange={setFamily}
          className="grid w-full grid-cols-[repeat(auto-fill,minmax(min(100%,12rem),1fr))] gap-3"
        >
          {THEME_FAMILIES.map((family) => (
            <ThemeFamilyCard
              key={family.id}
              family={family}
              active={family.id === preference.familyId}
              description={t(THEME_DESCRIPTION_KEYS[family.id])}
            />
          ))}
        </RadioGroup>
      </Field>
    </SettingsGroup>
  );
}

function DisplaySettings() {
  const { t, locale, setLocale } = useI18n();

  return (
    <SettingsGroup title={t("settings.general.display.title")}>
      <Field label={t("settings.general.display.language")}>
        <Select
          value={locale}
          onValueChange={(value) =>
            setLocale(value as (typeof LOCALES)[number])
          }
          options={LOCALES.map((code) => ({
            value: code,
            label: LOCALE_LABELS[code],
          }))}
        />
      </Field>

      <FontField />
      <ZoomField />
    </SettingsGroup>
  );
}

function FontField() {
  const { t } = useI18n();
  const family = useFontStore((state) => state.family);
  const setFamily = useFontStore((state) => state.setFamily);

  return (
    <Field
      label={t("settings.general.display.fontFamily")}
      hint={t("settings.general.display.fontFamilyHint")}
    >
      <DraftInput
        value={family}
        onCommit={setFamily}
        maxLength={1024}
        placeholder='"JetBrains Mono Variable"'
        autoComplete="off"
        spellCheck={false}
      />
    </Field>
  );
}

function ZoomField() {
  const { t } = useI18n();
  const level = useZoomStore((state) => state.level);
  const zoomIn = useZoomStore((state) => state.zoomIn);
  const zoomOut = useZoomStore((state) => state.zoomOut);
  const resetZoom = useZoomStore((state) => state.resetZoom);
  const percent = Math.round(zoomFactor(level) * 100);

  return (
    <Field
      label={t("settings.general.display.zoom")}
      hint={
        <span className="inline-flex flex-wrap items-center gap-x-1.5 gap-y-1">
          {t("settings.general.display.zoomHint")}
          <Kbd keys={["mod", "+"]} className="h-4 min-w-4" /> /
          <Kbd keys={["mod", "−"]} className="h-4 min-w-4" /> /
          <Kbd keys={["mod", "0"]} className="h-4 min-w-4" />
        </span>
      }
    >
      <div className="flex w-full flex-wrap items-center gap-1.5">
        <Tooltip content={t("settings.general.display.zoomOut")}>
          <Button
            size="icon"
            variant="outline"
            disabled={level <= ZOOM_LEVEL_MIN}
            onClick={zoomOut}
          >
            <Minus className="size-3.5" />
          </Button>
        </Tooltip>
        <span className="min-w-14 text-center text-sm tabular-nums text-foreground">
          {percent}%
        </span>
        <Tooltip content={t("settings.general.display.zoomIn")}>
          <Button
            size="icon"
            variant="outline"
            disabled={level >= ZOOM_LEVEL_MAX}
            onClick={zoomIn}
          >
            <Plus className="size-3.5" />
          </Button>
        </Tooltip>
        {level !== 0 && (
          <Button variant="outline" onClick={resetZoom}>
            {t("settings.general.display.zoomReset")}
          </Button>
        )}
      </div>
    </Field>
  );
}

function ThemeFamilyCard({
  family,
  active,
  description,
}: {
  family: ThemeFamilyDefinition;
  active: boolean;
  description: string;
}) {
  return (
    <RadioGroupItem
      value={family.id}
      className={cn(
        "group flex min-w-0 flex-col overflow-hidden rounded-lg border bg-card text-left transition-[border-color,box-shadow]",
        CONTROL_FOCUS_CLASS,
        active ? "border-primary ring-2 ring-primary/25" : CONTROL_BORDER_CLASS,
      )}
    >
      <div className="grid h-24 grid-cols-2">
        {(["light", "dark"] as const).map((appearance) => (
          <ThemePreview key={appearance} theme={family.themes[appearance]} />
        ))}
      </div>
      <div className="flex w-full items-center gap-2 border-t border-border px-3 py-2.5">
        <div className="min-w-0 flex-1">
          <p className="truncate text-xs font-semibold text-card-foreground">
            {family.name}
          </p>
          <p className="mt-0.5 truncate text-2xs text-muted-foreground">
            {description}
          </p>
        </div>
        {active && (
          <span className="flex size-5 shrink-0 items-center justify-center rounded-full bg-primary text-primary-foreground">
            <Check className="size-3" strokeWidth={3} />
          </span>
        )}
      </div>
    </RadioGroupItem>
  );
}

function ThemePreview({
  theme,
}: {
  theme: ThemeFamilyDefinition["themes"][ThemeAppearance];
}) {
  const { colors, terminal } = theme;

  return (
    <div
      className="flex min-w-0 border-r last:border-r-0"
      style={{
        backgroundColor: terminal.background,
        borderColor: colors.border,
        color: terminal.foreground,
      }}
    >
      <div
        className="flex w-1/3 flex-col gap-1 border-r p-1.5"
        style={{
          backgroundColor: colors.surface,
          borderColor: colors.border,
        }}
      >
        <span
          className="h-1 w-2/3 rounded-full"
          style={{ backgroundColor: colors.primary }}
        />
        <span
          className="h-1 w-full rounded-full opacity-55"
          style={{ backgroundColor: colors.mutedForeground }}
        />
        <span
          className="h-1 w-3/4 rounded-full opacity-55"
          style={{ backgroundColor: colors.mutedForeground }}
        />
      </div>
      <div className="flex min-w-0 flex-1 flex-col gap-1.5 p-1.5">
        <span
          className="h-3 rounded-sm"
          style={{ backgroundColor: colors.listActive }}
        />
        <span
          className="h-1 w-3/4 rounded-full"
          style={{ backgroundColor: terminal.blue }}
        />
        <span
          className="h-1 w-1/2 rounded-full"
          style={{ backgroundColor: terminal.green }}
        />
        <span
          className="mt-auto h-1 w-5/6 rounded-full opacity-60"
          style={{ backgroundColor: terminal.foreground }}
        />
      </div>
    </div>
  );
}
