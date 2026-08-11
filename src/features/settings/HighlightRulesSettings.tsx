import { useState } from "react";
import { Plus, Trash2 } from "lucide-react";

import { Button, Field, Input, Switch, Tooltip } from "@/components/ui";
import {
  MAX_HIGHLIGHT_PATTERN_LENGTH,
  MAX_HIGHLIGHT_RULES,
  type HighlightRule,
} from "@/features/terminal/highlight-rules";
import { useHighlightStore } from "@/features/terminal/highlight-state";
import { useI18n } from "@/i18n";
import { DraftInput } from "./DraftInput";
import { SettingsGroup } from "./SettingsGroup";

const DEFAULT_FOREGROUND = "#ff6b6b";
const DEFAULT_BACKGROUND = "#5a1d1d";

export function HighlightRulesSettings() {
  const { t } = useI18n();
  const rules = useHighlightStore((state) => state.rules);
  const replaceRules = useHighlightStore((state) => state.replaceRules);
  const [draftRule, setDraftRule] = useState<HighlightRule | null>(null);
  const visibleRules = draftRule ? [...rules, draftRule] : rules;
  const update = (id: string, patch: Partial<HighlightRule>) => {
    if (draftRule?.id === id) {
      setDraftRule({ ...draftRule, ...patch });
      return;
    }
    replaceRules(
      rules.map((rule) => (rule.id === id ? { ...rule, ...patch } : rule)),
    );
  };
  const commitPattern = (id: string, pattern: string) => {
    if (draftRule?.id === id) {
      if (pattern.length > 0) {
        replaceRules([...rules, { ...draftRule, pattern }]);
      }
      setDraftRule(null);
      return;
    }
    if (pattern.length === 0) {
      replaceRules(rules.filter((rule) => rule.id !== id));
      return;
    }
    update(id, { pattern });
  };
  const add = () =>
    setDraftRule({
      id: crypto.randomUUID(),
      pattern: "",
      caseSensitive: false,
      foreground: DEFAULT_FOREGROUND,
      background: DEFAULT_BACKGROUND,
      enabled: true,
    });

  return (
    <SettingsGroup
      title={t("settings.general.highlights.title")}
      description={t("settings.general.highlights.description")}
      actions={
        <Button
          variant="outline"
          onClick={add}
          disabled={draftRule !== null || rules.length >= MAX_HIGHLIGHT_RULES}
        >
          <Plus /> {t("settings.general.highlights.add")}
        </Button>
      }
    >
      {visibleRules.length === 0 ? (
        <p className="ui-surface-card px-4 py-5 text-sm text-muted-foreground">
          {t("settings.general.highlights.empty")}
        </p>
      ) : (
        <div className="flex flex-col gap-2">
          {visibleRules.map((rule) => (
            <div
              key={rule.id}
              className="ui-surface-card grid gap-3 p-3 sm:grid-cols-[minmax(0,1fr)_auto]"
            >
              <div className="grid min-w-0 gap-3 sm:grid-cols-[minmax(0,1fr)_auto_auto]">
                <Field label={t("settings.general.highlights.pattern")}>
                  <DraftInput
                    value={rule.pattern}
                    maxLength={MAX_HIGHLIGHT_PATTERN_LENGTH}
                    onCommit={(pattern) => commitPattern(rule.id, pattern)}
                  />
                </Field>
                <Field label={t("settings.general.highlights.textColor")}>
                  <Input
                    type="color"
                    className="w-16 px-1"
                    value={rule.foreground ?? DEFAULT_FOREGROUND}
                    onChange={(event) =>
                      update(rule.id, { foreground: event.target.value })
                    }
                  />
                </Field>
                <Field label={t("settings.general.highlights.backgroundColor")}>
                  <Input
                    type="color"
                    className="w-16 px-1"
                    value={rule.background ?? DEFAULT_BACKGROUND}
                    onChange={(event) =>
                      update(rule.id, { background: event.target.value })
                    }
                  />
                </Field>
              </div>
              <div className="flex flex-wrap items-end justify-end gap-x-4 gap-y-2 pb-0.5">
                <label className="flex h-[var(--control-height)] items-center gap-2 whitespace-nowrap text-xs text-muted-foreground">
                  <Switch
                    checked={rule.caseSensitive}
                    onCheckedChange={(caseSensitive) =>
                      update(rule.id, { caseSensitive })
                    }
                    aria-label={t("settings.general.highlights.caseSensitive")}
                  />
                  {t("settings.general.highlights.caseSensitive")}
                </label>
                <label className="flex h-[var(--control-height)] items-center gap-2 whitespace-nowrap text-xs text-muted-foreground">
                  <Switch
                    checked={rule.enabled}
                    onCheckedChange={(enabled) => update(rule.id, { enabled })}
                    aria-label={t("settings.general.highlights.enabled")}
                  />
                  {t("settings.general.highlights.enabled")}
                </label>
                <Tooltip content={t("settings.general.highlights.remove")}>
                  <Button
                    size="icon"
                    variant="ghost"
                    aria-label={t("settings.general.highlights.remove")}
                    onClick={() =>
                      draftRule?.id === rule.id
                        ? setDraftRule(null)
                        : replaceRules(
                            rules.filter((item) => item.id !== rule.id),
                          )
                    }
                  >
                    <Trash2 />
                  </Button>
                </Tooltip>
              </div>
            </div>
          ))}
        </div>
      )}
    </SettingsGroup>
  );
}
