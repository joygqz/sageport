import { useCallback, useEffect, useRef } from "react";
import { useI18n } from "@/i18n";
import { useSettingSync } from "@/lib/settingSync";
import { errorMessage, toast } from "@/lib/toast";
import {
  HIGHLIGHT_RULES_SYNC_KEY,
  parseHighlightRules,
  serializeHighlightRules,
} from "./highlight-rules";
import { useHighlightStore } from "./highlight-state";

export function HighlightRulesSync() {
  const { t } = useI18n();
  const rules = useHighlightStore((state) => state.rules);
  const replaceRules = useHighlightStore((state) => state.replaceRules);
  const onRemote = useCallback(
    (value: string) => replaceRules(parseHighlightRules(value)),
    [replaceRules],
  );
  const serialized = serializeHighlightRules(rules);
  const push = useSettingSync(HIGHLIGHT_RULES_SYNC_KEY, serialized, onRemote, {
    onLoadError: (error) =>
      toast.error(t("settings.persistence.loadError"), errorMessage(error)),
    onSaveError: (error) =>
      toast.error(t("settings.persistence.saveError"), errorMessage(error)),
  });
  const previous = useRef(serialized);
  useEffect(() => {
    if (previous.current === serialized) return;
    previous.current = serialized;
    push(serialized);
  }, [push, serialized]);
  return null;
}
