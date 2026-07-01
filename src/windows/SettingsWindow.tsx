import { useState } from "react";
import { Monitor, Moon, Sun } from "lucide-react";

import {
  Button,
  Field,
  Input,
  Select,
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from "@/components/ui";
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

export function SettingsWindow() {
  const { t } = useI18n();
  return (
    <div className="flex h-full flex-col bg-background">
      <Tabs defaultValue="appearance" className="flex min-h-0 flex-1 flex-col">
        <TabsList className="m-3 mb-0">
          <TabsTrigger value="appearance" className="flex-1">
            {t("settings.tabs.appearance")}
          </TabsTrigger>
          <TabsTrigger value="ai" className="flex-1">
            {t("settings.tabs.ai")}
          </TabsTrigger>
          <TabsTrigger value="keys" className="flex-1">
            {t("settings.tabs.keys")}
          </TabsTrigger>
          <TabsTrigger value="identities" className="flex-1">
            {t("settings.tabs.identities")}
          </TabsTrigger>
          <TabsTrigger value="snippets" className="flex-1">
            {t("settings.tabs.snippets")}
          </TabsTrigger>
          <TabsTrigger value="sync" className="flex-1">
            {t("settings.tabs.sync")}
          </TabsTrigger>
        </TabsList>

        <div className="min-h-0 flex-1 overflow-y-auto p-4">
          <TabsContent value="appearance">
            <AppearanceSection />
          </TabsContent>
          <TabsContent value="ai">
            <AiSection />
          </TabsContent>
          <TabsContent value="keys">
            <KeysSection />
          </TabsContent>
          <TabsContent value="identities">
            <IdentitiesSection />
          </TabsContent>
          <TabsContent value="snippets">
            <SnippetsSection />
          </TabsContent>
          <TabsContent value="sync">
            <SyncSection />
          </TabsContent>
        </div>
      </Tabs>
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
