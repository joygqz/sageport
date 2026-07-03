import { useState } from "react";
import { Info, Palette, RefreshCw, Sparkles } from "lucide-react";

import { Button, Field, Input, ScrollArea, Select } from "@/components/ui";
import { LOCALE_LABELS, LOCALES, useI18n, type TKey } from "@/i18n";
import { errorMessage, toast } from "@/lib/toast";
import { cn } from "@/lib/utils";
import { THEMES, useTheme, type ThemeDefinition } from "@/themes";
import { useTabsStore, type SettingsSection } from "@/workbench/tabs";
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

/**
 * Settings as a full editor tab (not a dialog), with a section nav on the
 * left. The active section lives on the tab itself so deep links (e.g. the
 * assistant jumping to its provider setup) land on the right section.
 */
export function SettingsPage({ section }: { section: SettingsSection }) {
  const { t } = useI18n();
  const setSection = useTabsStore((s) => s.setSettingsSection);

  return (
    <div className="flex h-full bg-background">
      <nav className="flex w-44 shrink-0 flex-col gap-0.5 border-r border-border p-2">
        {NAV.map((item) => {
          const Icon = item.icon;
          const active = section === item.id;
          return (
            <button
              key={item.id}
              onClick={() => setSection(item.id)}
              className={cn(
                "flex items-center gap-2 rounded-md px-2.5 py-1.5 text-left text-sm transition-colors",
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

      <ScrollArea className="min-w-0 flex-1">
        <div className="mx-auto flex max-w-2xl flex-col gap-6 p-6">
          {section === "appearance" && <AppearanceSection />}
          {section === "ai" && <AiSection />}
          {section === "sync" && <SyncSection />}
          {section === "about" && <AboutSection />}
        </div>
      </ScrollArea>
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

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
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
    </div>
  );
}

/** A small live swatch of the theme: chrome strip, editor area, terminal colors. */
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
        "group flex flex-col overflow-hidden rounded-lg border text-left transition-colors",
        active
          ? "border-primary ring-2 ring-primary/40"
          : "border-border hover:border-ring",
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
  // Mount the form only once the saved config is available so its fields
  // initialize from props with no setState-in-effect hydration.
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
