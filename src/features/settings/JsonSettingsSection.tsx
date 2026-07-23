import { lazy, Suspense, useRef, useState } from "react";
import { Save, Undo2 } from "lucide-react";

import { Button, ErrorState, LoadingState } from "@/components/ui";
import { useAiConfig, useSetAiConfig, useSetAiModel } from "@/features/ai/api";
import { useI18n, type TFunction } from "@/i18n";
import { systemLocale } from "@/i18n/config";
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

  return (
    <JsonSettingsForm
      initialDocument={document}
      initialValues={values}
      defaults={defaults}
    />
  );
}

function JsonSettingsForm({
  initialDocument,
  initialValues,
  defaults,
}: {
  initialDocument: JsonSettingsDocument;
  initialValues: JsonSettingsValues;
  defaults: JsonSettingsValues;
}) {
  const { t, locale, setLocale } = useI18n();
  const { preference, setPreference } = useTheme();
  const setFontFamily = useFontStore((state) => state.setFamily);
  const setZoomLevel = useZoomStore((state) => state.setLevel);
  const setAiConfig = useSetAiConfig();
  const setAiModel = useSetAiModel();
  const initialText = stringifyJsonSettings(initialDocument);
  const currentValuesRef = useRef(initialValues);
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
    const current = currentValuesRef.current;
    const next = resolveJsonSettings(parsed.value, defaults);
    const endpointChanged =
      next["ai.protocol"] !== current["ai.protocol"] ||
      next["ai.base_url"].trim().replace(/\/+$/, "") !==
        current["ai.base_url"].trim().replace(/\/+$/, "");
    const modelChanged = next["ai.model"] !== current["ai.model"];
    const aiConfigChanged = [
      "ai.protocol",
      "ai.base_url",
      "ai.api_key",
      "ai.auto_approve",
      "ai.enabled_tools",
      "ai.max_history_tokens",
    ].some(
      (key) =>
        JSON.stringify(next[key as keyof JsonSettingsValues]) !==
        JSON.stringify(current[key as keyof JsonSettingsValues]),
    );

    try {
      if (aiConfigChanged) {
        await setAiConfig.mutateAsync({
          protocol: next["ai.protocol"],
          baseUrl: next["ai.base_url"],
          apiKey: next["ai.api_key"],
          autoApprove: next["ai.auto_approve"],
          enabledTools: next["ai.enabled_tools"],
          maxHistoryTokens: next["ai.max_history_tokens"],
        });
      }
      if (modelChanged || endpointChanged) {
        await setAiModel.mutateAsync(next["ai.model"]);
      }

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
      if (
        next["general.fontFamily"] !==
        currentValuesRef.current["general.fontFamily"]
      ) {
        setFontFamily(next["general.fontFamily"]);
      }
      if (
        next["general.zoomLevel"] !==
        currentValuesRef.current["general.zoomLevel"]
      ) {
        setZoomLevel(next["general.zoomLevel"]);
      }

      currentValuesRef.current = next;
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
