import { useState } from "react";
import { Info, Minus, Palette, Plus, RefreshCw, Sparkles } from "lucide-react";

import {
  Button,
  Field,
  Input,
  Kbd,
  ScrollArea,
  Select,
  Tooltip,
} from "@/components/ui";
import { LOCALE_LABELS, LOCALES, useI18n, type TKey } from "@/i18n";
import { errorMessage, toast } from "@/lib/toast";
import { cn } from "@/lib/utils";
import { THEMES, useTheme, type ThemeDefinition } from "@/themes";
import { useTabsStore, type SettingsSection } from "@/workbench/tabs";
import {
  useZoomStore,
  zoomFactor,
  ZOOM_LEVEL_MAX,
  ZOOM_LEVEL_MIN,
} from "@/workbench/zoom";
import {
  useFontStore,
  PRESET_FONTS,
  type PresetFontId,
} from "@/features/terminal/font-store";
import type { AiConfig, AiProtocol } from "@/types/models";
import {
  AI_PROTOCOLS,
  defaultBaseUrl,
  useAiConfig,
  useSetAiConfig,
} from "@/features/ai/api";
import { SyncSection } from "@/features/sync/SyncSection";
import { AboutSection } from "./AboutSection";

const NAV: { id: SettingsSection; labelKey: TKey; icon: typeof Palette }[] = [
  { id: "appearance", labelKey: "settings.nav.appearance", icon: Palette },
  { id: "ai", labelKey: "settings.nav.ai", icon: Sparkles },
  { id: "sync", labelKey: "settings.nav.sync", icon: RefreshCw },
  { id: "about", labelKey: "settings.nav.about", icon: Info },
];

export function SettingsPage({ section }: { section: SettingsSection }) {
  const { t } = useI18n();
  const setSection = useTabsStore((s) => s.setSettingsSection);

  return (
    <div className="settings-page h-full bg-background">
      <div className="settings-layout">
        <nav className="settings-nav flex shrink-0 flex-col gap-0.5 border-r border-border p-2">
          {NAV.map((item) => {
            const Icon = item.icon;
            const active = section === item.id;
            return (
              <button
                key={item.id}
                onClick={() => setSection(item.id)}
                className={cn(
                  "settings-nav-button flex items-center gap-2 rounded-md px-2.5 py-1.5 text-left text-sm transition-colors",
                  active
                    ? "bg-list-active text-list-active-foreground"
                    : "text-muted-foreground hover:bg-list-hover hover:text-foreground",
                )}
              >
                <Icon className="size-4 shrink-0" />
                <span className="truncate">{t(item.labelKey)}</span>
              </button>
            );
          })}
        </nav>

        <ScrollArea className="min-h-0 min-w-0 flex-1">
          <div className="settings-content flex min-w-0 max-w-2xl flex-col gap-6 p-6">
            {section === "appearance" && <AppearanceSection />}
            {section === "ai" && <AiSection />}
            {section === "sync" && <SyncSection />}
            {section === "about" && <AboutSection />}
          </div>
        </ScrollArea>
      </div>
    </div>
  );
}

function AppearanceSection() {
  const { t, locale, setLocale } = useI18n();
  const { theme, setTheme } = useTheme();

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h3 className="text-sm font-medium text-foreground">
          {t("settings.appearance.themeTitle")}
        </h3>
        <p className="mt-1 text-sm text-muted-foreground">
          {t("settings.appearance.themeDescription")}
        </p>
      </div>

      <div className="grid grid-cols-[repeat(auto-fit,minmax(min(100%,11rem),1fr))] gap-3">
        {THEMES.map((candidate) => (
          <ThemeCard
            key={candidate.id}
            theme={candidate}
            active={candidate.id === theme.id}
            onSelect={() => setTheme(candidate.id)}
          />
        ))}
      </div>

      <Field
        label={t("settings.appearance.language")}
        hint={t("settings.appearance.languageHint")}
      >
        <Select
          value={locale}
          onChange={(e) =>
            setLocale(e.target.value as (typeof LOCALES)[number])
          }
        >
          {LOCALES.map((code) => (
            <option key={code} value={code}>
              {LOCALE_LABELS[code]}
            </option>
          ))}
        </Select>
      </Field>

      <ZoomField />

      <TerminalFontField />
    </div>
  );
}

function TerminalFontField() {
  const { t } = useI18n();
  const preset = useFontStore((s) => s.preset);
  const customFamily = useFontStore((s) => s.customFamily);
  const setPreset = useFontStore((s) => s.setPreset);
  const setCustomFamily = useFontStore((s) => s.setCustomFamily);

  return (
    <div className="flex flex-col gap-4">
      <Field
        label={t("settings.appearance.terminalFont")}
        hint={t("settings.appearance.terminalFontHint")}
      >
        <Select
          value={preset}
          onChange={(e) => setPreset(e.target.value as PresetFontId)}
        >
          {PRESET_FONTS.map((font) => (
            <option key={font.id} value={font.id}>
              {font.name}
            </option>
          ))}
        </Select>
      </Field>

      {preset === "custom" && (
        <Field label={t("settings.appearance.customFontFamily")}>
          <Input
            value={customFamily}
            onChange={(e) => setCustomFamily(e.target.value)}
            placeholder='"MyNerdFont", "JetBrains Mono Variable", monospace'
          />
        </Field>
      )}
    </div>
  );
}

function ZoomField() {
  const { t } = useI18n();
  const level = useZoomStore((s) => s.level);
  const zoomIn = useZoomStore((s) => s.zoomIn);
  const zoomOut = useZoomStore((s) => s.zoomOut);
  const resetZoom = useZoomStore((s) => s.resetZoom);

  const percent = Math.round(zoomFactor(level) * 100);

  return (
    <Field
      label={t("settings.appearance.zoom")}
      hint={
        <span className="inline-flex flex-wrap items-center gap-x-1.5 gap-y-1">
          {t("settings.appearance.zoomHint")}
          <Kbd keys={["mod", "+"]} className="h-4 min-w-4" /> /
          <Kbd keys={["mod", "−"]} className="h-4 min-w-4" /> /
          <Kbd keys={["mod", "0"]} className="h-4 min-w-4" />
        </span>
      }
    >
      <div className="flex items-center gap-1.5">
        <Tooltip content={t("settings.appearance.zoomOut")}>
          <Button
            size="icon"
            variant="outline"
            className="size-7"
            disabled={level <= ZOOM_LEVEL_MIN}
            onClick={zoomOut}
          >
            <Minus className="size-3.5" />
          </Button>
        </Tooltip>
        <span className="min-w-14 text-center text-sm tabular-nums text-foreground">
          {percent}%
        </span>
        <Tooltip content={t("settings.appearance.zoomIn")}>
          <Button
            size="icon"
            variant="outline"
            className="size-7"
            disabled={level >= ZOOM_LEVEL_MAX}
            onClick={zoomIn}
          >
            <Plus className="size-3.5" />
          </Button>
        </Tooltip>
        {level !== 0 && (
          <Button size="sm" variant="ghost" onClick={resetZoom}>
            {t("settings.appearance.zoomReset")}
          </Button>
        )}
      </div>
    </Field>
  );
}

function ThemeCard({
  theme,
  active,
  onSelect,
}: {
  theme: ThemeDefinition;
  active: boolean;
  onSelect: () => void;
}) {
  const { colors, terminal } = theme;
  const ansi = [
    terminal.red,
    terminal.green,
    terminal.yellow,
    terminal.blue,
    terminal.magenta,
    terminal.cyan,
  ];

  return (
    <button
      onClick={onSelect}
      aria-pressed={active}
      className={cn(
        "group flex min-w-0 flex-col overflow-hidden rounded-lg border text-left transition-colors",
        active
          ? "border-primary ring-2 ring-primary/40"
          : "border-input hover:border-ring",
      )}
    >
      <div className="flex h-16" style={{ backgroundColor: colors.background }}>
        <div
          className="w-4 border-r"
          style={{
            backgroundColor: colors.surface,
            borderColor: colors.border,
          }}
        />
        <div className="flex min-w-0 flex-1 flex-col justify-between p-1.5">
          <div
            className="h-1.5 w-2/3 rounded-full"
            style={{ backgroundColor: colors.primary }}
          />
          <div className="flex gap-1">
            {ansi.map((color, i) => (
              <span
                key={i}
                className="size-1.5 rounded-full"
                style={{ backgroundColor: color }}
              />
            ))}
          </div>
        </div>
      </div>
      <div className="border-t border-border bg-surface px-2 py-1.5">
        <p className="truncate text-xs font-medium text-foreground">
          {theme.name}
        </p>
      </div>
    </button>
  );
}

function AiSection() {
  const { data: config } = useAiConfig();

  if (!config) return null;
  return <AiForm config={config} />;
}

function AiForm({ config }: { config: AiConfig }) {
  const { t } = useI18n();
  const setConfig = useSetAiConfig();
  const [protocol, setProtocol] = useState<AiProtocol>(config.protocol);
  const [baseUrl, setBaseUrl] = useState(config.baseUrl);
  const [apiKey, setApiKey] = useState("");

  const changeProtocol = (next: AiProtocol) => {
    setProtocol(next);
    setBaseUrl(defaultBaseUrl(next));
  };

  const save = async () => {
    try {
      await setConfig.mutateAsync({
        baseUrl,
        protocol,
        apiKey: apiKey || undefined,
      });
      setApiKey("");
      toast.success(t("settings.ai.saved"));
    } catch (err) {
      toast.error(t("settings.ai.saveError"), errorMessage(err));
    }
  };

  return (
    <div className="flex flex-col gap-4">
      <div>
        <h3 className="text-sm font-medium text-foreground">
          {t("settings.ai.title")}
        </h3>
        <p className="mt-1 text-sm text-muted-foreground">
          {t("settings.ai.description")}
        </p>
      </div>

      <Field label={t("settings.ai.protocolLabel")}>
        <Select
          value={protocol}
          onChange={(e) => changeProtocol(e.target.value as AiProtocol)}
        >
          {AI_PROTOCOLS.map((p) => (
            <option key={p.value} value={p.value}>
              {t(`settings.ai.protocol_${p.value}`)}
            </option>
          ))}
        </Select>
      </Field>

      <Field
        label={t("settings.ai.baseUrlLabel")}
        hint={t("settings.ai.baseUrlHint")}
      >
        <Input
          value={baseUrl}
          onChange={(e) => setBaseUrl(e.target.value)}
          placeholder={defaultBaseUrl(protocol)}
          autoComplete="off"
          spellCheck={false}
        />
      </Field>

      <Field
        label={t("settings.ai.apiKeyLabel")}
        hint={
          config.hasApiKey
            ? t("settings.ai.apiKeyHintSaved")
            : t("settings.ai.apiKeyHint")
        }
      >
        <Input
          type="password"
          value={apiKey}
          onChange={(e) => setApiKey(e.target.value)}
          placeholder={
            config.hasApiKey ? t("settings.ai.apiKeyPlaceholderSaved") : "sk-…"
          }
          autoComplete="off"
        />
      </Field>

      <Button
        className="self-start"
        onClick={save}
        disabled={!baseUrl || (!apiKey && !config.hasApiKey)}
        loading={setConfig.isPending}
      >
        {t("common.save")}
      </Button>
    </div>
  );
}
