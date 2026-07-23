import { lazy, Suspense, useState } from "react";
import { Save, Undo2 } from "lucide-react";

import { Button, ErrorState, LoadingState } from "@/components/ui";
import { useAiConfig } from "@/features/ai/api";
import { clearModelLimitsCache } from "@/features/ai/model-limits";
import { useI18n, type TFunction } from "@/i18n";
import { systemLocale } from "@/i18n/config";
import { ipc } from "@/lib/ipc";
import { queryClient } from "@/lib/query";
import { cacheSettingValue } from "@/lib/settingSync";
import { errorMessage, toast } from "@/lib/toast";
import { serializeThemePreference } from "@/themes/apply";
import { useTheme } from "@/themes";
import { useFontStore } from "@/workbench/font";
import { useZoomStore } from "@/workbench/zoom";
import { SettingsGroup } from "./SettingsGroup";
import {
  createJsonSettingsDocument,
  createJsonSettingsValues,
  defaultJsonSettings,
  parseJsonSettings,
  resolveJsonSettings,
  stringifyJsonSettings,
  themePreferenceFromJson,
  type JsonSettingsDocument,
  type JsonSettingsIssue,
  type JsonSettingsValues,
} from "./jsonSettings";

const JsonSettingsEditor = lazy(() =>
  import("./JsonSettingsEditor").then((module) => ({
    default: module.JsonSettingsEditor,
  })),
);

function issueMessage(t: TFunction, issue: JsonSettingsIssue): string {
  if (issue.kind === "syntax") return t("settings.json.error.syntax");
  if (issue.kind === "root") return t("settings.json.error.root");
  if (issue.kind === "unknown") {
    return t("settings.json.error.unknown", { key: issue.key });
  }
  return t("settings.json.error.invalid", { key: issue.key });
}

export function JsonSettingsSection() {
  const { t, locale } = useI18n();
  const { preference } = useTheme();
  const fontFamily = useFontStore((state) => state.family);
  const zoomLevel = useZoomStore((state) => state.level);
  const ai = useAiConfig();

  if (ai.isPending) {
    return <LoadingState label={t("common.loading")} />;
  }
  if (ai.isError || !ai.data) {
    return (
      <ErrorState
        title={t("common.loadError")}
        retryLabel={t("common.retry")}
        onRetry={() => void ai.refetch()}
      />
    );
  }

  const values = createJsonSettingsValues({
    locale,
    theme: serializeThemePreference(preference),
    fontFamily,
    zoomLevel,
    ai: ai.data,
  });
  const defaults = defaultJsonSettings(systemLocale());
  const document = createJsonSettingsDocument(values, defaults);

  return <JsonSettingsForm initialDocument={document} defaults={defaults} />;
}

function JsonSettingsForm({
  initialDocument,
  defaults,
}: {
  initialDocument: JsonSettingsDocument;
  defaults: JsonSettingsValues;
}) {
  const { t, locale, setLocale } = useI18n();
  const { preference, setPreference } = useTheme();
  const setFontFamily = useFontStore((state) => state.setFamily);
  const setZoomLevel = useZoomStore((state) => state.setLevel);
  const initialText = stringifyJsonSettings(initialDocument);
  const [savedText, setSavedText] = useState(initialText);
  const [draft, setDraft] = useState(initialText);
  const [issue, setIssue] = useState<JsonSettingsIssue | null>(null);
  const [saving, setSaving] = useState(false);
  const dirty = draft !== savedText;

  const save = async () => {
    if (saving) return;
    const parsed = parseJsonSettings(draft);
    if (!parsed.ok) {
      setIssue(parsed.issue);
      return;
    }

    setIssue(null);
    setSaving(true);
    const next = resolveJsonSettings(parsed.value, defaults);
    const includesApiKey = Object.prototype.hasOwnProperty.call(
      parsed.value,
      "ai.api_key",
    );

    try {
      await ipc.settings.applyJson({
        locale: next["general.locale"],
        theme: next["general.theme"],
        fontFamily: next["general.fontFamily"],
        zoomLevel: next["general.zoomLevel"],
        protocol: next["ai.protocol"],
        baseUrl: next["ai.base_url"],
        apiKey: includesApiKey ? next["ai.api_key"] : undefined,
        model: next["ai.model"],
        autoApprove: next["ai.auto_approve"],
        enabledTools: next["ai.enabled_tools"],
        maxHistoryTokens: next["ai.max_history_tokens"],
      });

      cacheSettingValue("general.locale", next["general.locale"]);
      cacheSettingValue("general.theme", next["general.theme"]);
      cacheSettingValue("general.fontFamily", next["general.fontFamily"]);
      cacheSettingValue("general.zoomLevel", String(next["general.zoomLevel"]));
      clearModelLimitsCache();
      void queryClient.invalidateQueries({ queryKey: ["ai"] });

      if (next["general.locale"] !== locale) {
        setLocale(next["general.locale"]);
      }
      const nextPreference = themePreferenceFromJson(next["general.theme"]);
      if (
        nextPreference.familyId !== preference.familyId ||
        nextPreference.mode !== preference.mode
      ) {
        setPreference(nextPreference);
      }
      setFontFamily(next["general.fontFamily"]);
      setZoomLevel(next["general.zoomLevel"]);

      const formatted = stringifyJsonSettings(
        createJsonSettingsDocument(next, defaults),
      );
      setSavedText(formatted);
      setDraft(formatted);
      toast.success(t("settings.json.saved"));
    } catch (error) {
      toast.error(t("settings.json.saveError"), errorMessage(error));
    } finally {
      setSaving(false);
    }
  };

  const discard = () => {
    setDraft(savedText);
    setIssue(null);
  };

  return (
    <SettingsGroup
      title={t("settings.json.title")}
      description={t("settings.json.description")}
      actions={
        <>
          {dirty && (
            <Button variant="ghost" onClick={discard} disabled={saving}>
              <Undo2 />
              {t("settings.json.discard")}
            </Button>
          )}
          <Button
            onClick={() => void save()}
            loading={saving}
            disabled={!dirty}
          >
            <Save />
            {t("settings.json.save")}
          </Button>
        </>
      }
      contentClassName="gap-2"
    >
      <div className="overflow-hidden rounded-lg border border-border">
        <Suspense fallback={<LoadingState label={t("common.loading")} />}>
          <JsonSettingsEditor
            value={draft}
            onChange={(value) => {
              setDraft(value);
              if (issue) setIssue(null);
            }}
            onSave={() => void save()}
          />
        </Suspense>
      </div>
      {issue && (
        <p role="alert" className="text-xs text-danger">
          {issueMessage(t, issue)}
        </p>
      )}
      <p className="text-xs leading-relaxed text-muted-foreground">
        {t("settings.json.hint")}
      </p>
    </SettingsGroup>
  );
}
