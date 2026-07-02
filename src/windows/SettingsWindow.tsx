import { useState } from "react";
import {
  Bot,
  KeyRound,
  Monitor,
  Moon,
  Palette,
  RefreshCw,
  ScrollText,
  Sun,
  UserCog,
} from "lucide-react";

import { Button, Field, Input, Select } from "@/components/ui";
import { LOCALE_LABELS, LOCALES, useI18n } from "@/i18n";
import { errorMessage, toast } from "@/lib/toast";
import { cn } from "@/lib/utils";
import { useTheme } from "@/theme/useTheme";
import type { ThemeMode } from "@/theme/theme-context";
import {
  AI_PROTOCOLS,
  defaultBaseUrl,
  useAiConfig,
  useSetAiConfig,
} from "@/features/ai/api";
import type { AiConfig, AiProtocol } from "@/types/models";
import { IdentitiesSection } from "@/features/credentials/IdentitiesSection";
import { KeysSection } from "@/features/credentials/KeysSection";
import { SnippetsSection } from "@/features/snippets/SnippetsSection";
import { SyncSection } from "@/features/sync/SyncSection";

type SettingsSection =
  | "appearance"
  | "ai"
  | "keys"
  | "identities"
  | "snippets"
  | "sync";

export function SettingsWindow() {
  const { t } = useI18n();
  const [section, setSection] = useState<SettingsSection>("appearance");

  const items: {
    id: SettingsSection;
    labelKey: Parameters<typeof t>[0];
    icon: typeof Palette;
  }[] = [
    { id: "appearance", labelKey: "settings.tabs.appearance", icon: Palette },
    { id: "ai", labelKey: "settings.tabs.ai", icon: Bot },
    { id: "keys", labelKey: "settings.tabs.keys", icon: KeyRound },
    { id: "identities", labelKey: "settings.tabs.identities", icon: UserCog },
    { id: "snippets", labelKey: "settings.tabs.snippets", icon: ScrollText },
    { id: "sync", labelKey: "settings.tabs.sync", icon: RefreshCw },
  ];

  return (
    <div className="flex h-full flex-col bg-background">
      <header
        data-tauri-drag-region
        className="flex h-10 shrink-0 items-center border-b border-sidebar-border bg-sidebar pl-20 text-sm font-medium text-sidebar-foreground"
      >
        {t("windowTitles.settings")}
      </header>

      <div className="flex min-h-0 flex-1">
        <aside className="flex w-44 shrink-0 flex-col gap-0.5 border-r border-sidebar-border bg-sidebar p-2">
          {items.map((item) => {
            const Icon = item.icon;
            const active = section === item.id;
            return (
              <button
                key={item.id}
                onClick={() => setSection(item.id)}
                className={cn(
                  "flex items-center gap-2 rounded-md px-2.5 py-1.5 text-left text-sm transition-colors",
                  active
                    ? "bg-sidebar-accent text-sidebar-accent-foreground"
                    : "text-muted-foreground hover:bg-sidebar-accent/60 hover:text-sidebar-accent-foreground",
                )}
              >
                <Icon className="size-4 shrink-0" />
                <span className="truncate">{t(item.labelKey)}</span>
              </button>
            );
          })}
        </aside>

        <div className="min-h-0 flex-1 overflow-y-auto p-4">
          {section === "appearance" && <AppearanceSection />}
          {section === "ai" && <AiSection />}
          {section === "keys" && <KeysSection />}
          {section === "identities" && <IdentitiesSection />}
          {section === "snippets" && <SnippetsSection />}
          {section === "sync" && <SyncSection />}
        </div>
      </div>
    </div>
  );
}

function AppearanceSection() {
  const { t, locale, setLocale } = useI18n();
  const { mode, setMode } = useTheme();
  const options: {
    value: ThemeMode;
    labelKey: Parameters<typeof t>[0];
    icon: typeof Sun;
  }[] = [
    { value: "light", labelKey: "settings.appearance.light", icon: Sun },
    { value: "dark", labelKey: "settings.appearance.dark", icon: Moon },
    { value: "system", labelKey: "settings.appearance.system", icon: Monitor },
  ];
  return (
    <div className="flex flex-col gap-4">
      <Field label={t("settings.appearance.theme")}>
        <div className="grid grid-cols-3 gap-2">
          {options.map((opt) => {
            const Icon = opt.icon;
            return (
              <button
                key={opt.value}
                onClick={() => setMode(opt.value)}
                className={cn(
                  "flex flex-col items-center gap-1.5 rounded-lg border p-3 text-sm transition-colors",
                  mode === opt.value
                    ? "border-primary bg-primary/10 text-foreground"
                    : "border-border text-muted-foreground hover:border-ring",
                )}
              >
                <Icon className="size-4" />
                {t(opt.labelKey)}
              </button>
            );
          })}
        </div>
      </Field>

      <Field label={t("settings.appearance.language")}>
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

function AiSection() {
  const { data: config } = useAiConfig();
  // Mount the form only once the saved config is available so its fields can
  // initialize from props — no setState-in-effect hydration needed.
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
      toast.success(
        t("settings.ai.savedTitle"),
        t("settings.ai.savedDescription"),
      );
    } catch (err) {
      toast.error(t("settings.ai.saveError"), errorMessage(err));
    }
  };

  return (
    <div className="flex flex-col gap-4">
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
