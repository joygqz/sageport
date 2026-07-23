import { useCallback, useEffect, useRef, useState } from "react";
import {
  Braces,
  ChevronRight,
  Info,
  RefreshCw,
  Settings2,
  Sparkles,
} from "lucide-react";

import {
  Button,
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
  Dialog,
  DialogContent,
  DialogToolbar,
  ErrorState,
  Field,
  LoadingState,
  ScrollArea,
  Select,
  SwitchField,
  Tooltip,
} from "@/components/ui";
import { useI18n, type TKey } from "@/i18n";
import { errorMessage, toast } from "@/lib/toast";
import { cn } from "@/lib/utils";
import type { SettingsSection } from "@/workbench/overlays";
import type { AiConfig, AiProtocol } from "@/types/models";
import {
  AI_PROTOCOLS,
  exampleBaseUrl,
  useAiConfig,
  useSetAiConfig,
  useSetAiModel,
} from "@/features/ai/api";
import {
  normalizeEnabledToolNames,
  resolveEnabledToolNames,
  TOOL_GROUPS,
} from "@/features/ai/tools";
import { SyncSection } from "@/features/sync/SyncSection";
import { AboutSection } from "./AboutSection";
import { DraftInput } from "./DraftInput";
import { GeneralSection } from "./GeneralSection";
import { JsonSettingsSection } from "./JsonSettingsSection";
import { SettingsGroup, SETTINGS_GROUP_STACK_CLASS } from "./SettingsGroup";

const NAV: {
  id: SettingsSection;
  labelKey: TKey;
  icon: typeof Settings2;
}[] = [
  {
    id: "general",
    labelKey: "settings.nav.general",
    icon: Settings2,
  },
  {
    id: "ai",
    labelKey: "settings.nav.ai",
    icon: Sparkles,
  },
  {
    id: "sync",
    labelKey: "settings.nav.sync",
    icon: RefreshCw,
  },
  {
    id: "about",
    labelKey: "settings.nav.about",
    icon: Info,
  },
];

export function SettingsDialog({
  open,
  section,
  onSectionChange,
  onClose,
}: {
  open: boolean;
  section: SettingsSection;
  onSectionChange: (section: SettingsSection) => void;
  onClose: () => void;
}) {
  const { t } = useI18n();
  const [jsonOpen, setJsonOpen] = useState(false);
  const jsonActionLabel = t(
    jsonOpen ? "settings.json.openVisual" : "settings.json.open",
  );

  return (
    <Dialog open={open} onOpenChange={(next) => !next && onClose()}>
      <DialogContent
        showClose={false}
        scrollMode="content"
        className="flex h-[min(44rem,calc(100dvh-2rem))] w-[min(58rem,calc(100vw-2rem))] max-w-none flex-col gap-0 bg-background p-0 text-foreground sm:h-[min(44rem,calc(100dvh-4rem))] sm:w-[min(58rem,calc(100vw-4rem))] sm:p-0"
      >
        <DialogToolbar
          className="bg-background"
          actions={
            <Tooltip content={jsonActionLabel}>
              <Button
                size="icon"
                variant="ghost"
                className="size-[var(--toolbar-control-size)]"
                aria-label={jsonActionLabel}
                onClick={() => setJsonOpen((current) => !current)}
              >
                {jsonOpen ? (
                  <Settings2 className="size-4" />
                ) : (
                  <Braces className="size-4" />
                )}
              </Button>
            </Tooltip>
          }
        >
          {t("settings.title")}
        </DialogToolbar>
        <SettingsPage
          section={section}
          jsonOpen={jsonOpen}
          onSectionChange={onSectionChange}
        />
      </DialogContent>
    </Dialog>
  );
}

function SettingsPage({
  section,
  jsonOpen,
  onSectionChange,
}: {
  section: SettingsSection;
  jsonOpen: boolean;
  onSectionChange: (section: SettingsSection) => void;
}) {
  const { t } = useI18n();

  if (jsonOpen) {
    return (
      <div className="settings-page min-h-0 flex-1 overflow-hidden bg-background">
        <ScrollArea className="h-full">
          <main className="settings-content mx-auto flex w-full max-w-5xl flex-col px-5 py-6 sm:px-8 sm:py-8">
            <JsonSettingsSection />
          </main>
        </ScrollArea>
      </div>
    );
  }

  return (
    <div className="settings-page min-h-0 flex-1 overflow-hidden bg-background">
      <div className="flex h-full min-w-0 flex-col sm:flex-row">
        <aside className="flex shrink-0 flex-col border-b border-border bg-surface/65 px-2 py-2 sm:w-48 sm:border-b-0 sm:border-r sm:px-3 sm:py-4">
          <nav
            className="scrollbar-none flex gap-1 overflow-x-auto sm:flex-col sm:overflow-visible"
            aria-label={t("settings.title")}
          >
            {NAV.map((item) => {
              const Icon = item.icon;
              const active = section === item.id;
              return (
                <button
                  key={item.id}
                  type="button"
                  aria-current={active ? "page" : undefined}
                  onClick={() => onSectionChange(item.id)}
                  className={cn(
                    "flex h-[var(--control-height)] shrink-0 items-center gap-2.5 rounded-lg px-2.5 text-left text-sm outline-none transition-colors focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring/60 sm:w-full",
                    active
                      ? "bg-list-active font-medium text-list-active-foreground"
                      : "text-muted-foreground hover:bg-list-hover hover:text-foreground",
                  )}
                >
                  <Icon className="size-4 shrink-0" />
                  <span className="truncate">{t(item.labelKey)}</span>
                </button>
              );
            })}
          </nav>
        </aside>

        <ScrollArea className="min-h-0 min-w-0 flex-1">
          <main className="settings-content mx-auto flex w-full max-w-3xl flex-col px-5 py-6 sm:px-8 sm:py-8">
            {section === "general" && <GeneralSection />}
            {section === "ai" && <AiSection />}
            {section === "sync" && <SyncSection />}
            {section === "about" && <AboutSection />}
          </main>
        </ScrollArea>
      </div>
    </div>
  );
}

function AiSection() {
  const { t } = useI18n();
  const { data: config, isLoading, isError, refetch } = useAiConfig();

  if (isLoading) return <LoadingState label={t("common.loading")} />;
  if (isError || !config) {
    return (
      <ErrorState
        title={t("common.loadError")}
        retryLabel={t("common.retry")}
        onRetry={() => void refetch()}
      />
    );
  }
  return <AiForm config={config} />;
}

function AiForm({ config }: { config: AiConfig }) {
  const { t } = useI18n();
  const setConfig = useSetAiConfig();
  const setModelMutation = useSetAiModel();
  const [protocol, setProtocol] = useState<AiProtocol>(config.protocol);
  const [baseUrl, setBaseUrl] = useState(config.baseUrl);
  const [model, setModel] = useState(config.model);
  const [autoApprove, setAutoApprove] = useState(config.autoApprove);
  const [enabledTools, setEnabledTools] = useState(() =>
    resolveEnabledToolNames(config.enabledTools),
  );
  const [maxHistoryTokens, setMaxHistoryTokens] = useState(
    config.maxHistoryTokens,
  );
  const [expandedToolGroups, setExpandedToolGroups] = useState<Set<string>>(
    () => new Set(),
  );
  const mutate = setConfig.mutate;
  const mutateModel = setModelMutation.mutate;
  const lastSavedModel = useRef(config.model);
  type ConfigInput = {
    baseUrl: string;
    protocol: AiProtocol;
    apiKey?: string;
    autoApprove: boolean;
    enabledTools: string[];
    maxHistoryTokens: number | null;
  };
  const values = useRef<ConfigInput>({
    baseUrl: config.baseUrl,
    protocol: config.protocol,
    autoApprove: config.autoApprove,
    enabledTools: resolveEnabledToolNames(config.enabledTools),
    maxHistoryTokens: config.maxHistoryTokens,
  });
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const flushConfig = useCallback(() => {
    saveTimer.current = null;
    const input = values.current;
    const { apiKey: _apiKey, ...retained } = input;
    values.current = retained;
    mutate(input, {
      onError: (err) =>
        toast.error(t("settings.ai.saveError"), errorMessage(err)),
    });
  }, [mutate, t]);

  const saveConfig = (patch: Partial<ConfigInput>) => {
    values.current = { ...values.current, ...patch };
    if (saveTimer.current !== null) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(flushConfig, 500);
  };

  useEffect(
    () => () => {
      if (saveTimer.current !== null) {
        clearTimeout(saveTimer.current);
        flushConfig();
      }
    },
    [flushConfig],
  );

  const commitModel = (next: string) => {
    setModel(next);
    if (next === lastSavedModel.current) return;
    lastSavedModel.current = next;
    mutateModel(next, {
      onError: (err) =>
        toast.error(t("settings.ai.saveError"), errorMessage(err)),
    });
  };

  const commitBaseUrl = (next: string) => {
    setBaseUrl(next);
    setModel("");
    lastSavedModel.current = "";
    saveConfig({ baseUrl: next });
  };

  const commitApiKey = (next: string) => {
    saveConfig({ apiKey: next });
  };

  const commitMaxHistoryTokens = (raw: string) => {
    const parsed = Number.parseInt(raw, 10);
    const next = Number.isFinite(parsed) && parsed > 0 ? parsed : null;
    setMaxHistoryTokens(next);
    saveConfig({ maxHistoryTokens: next });
  };

  const changeProtocol = (next: AiProtocol) => {
    setProtocol(next);
    setBaseUrl("");
    setModel("");
    lastSavedModel.current = "";
    saveConfig({ protocol: next, baseUrl: "" });
  };

  const changeAutoApprove = (next: boolean) => {
    setAutoApprove(next);
    saveConfig({ autoApprove: next });
  };

  const changeEnabledTools = (next: string[]) => {
    setEnabledTools(next);
    saveConfig({ enabledTools: next });
  };

  const toggleTool = (name: string, checked: boolean) => {
    changeEnabledTools(
      normalizeEnabledToolNames(
        checked
          ? [...enabledTools, name]
          : enabledTools.filter((item) => item !== name),
      ),
    );
  };

  const toggleToolGroup = (names: readonly string[], checked: boolean) => {
    changeEnabledTools(
      normalizeEnabledToolNames(
        checked
          ? [...enabledTools, ...names]
          : enabledTools.filter((name) => !names.includes(name)),
      ),
    );
  };

  const toggleToolGroupExpanded = (id: string) => {
    setExpandedToolGroups((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  return (
    <div className={SETTINGS_GROUP_STACK_CLASS}>
      <SettingsGroup title={t("settings.ai.modelProviderTitle")}>
        <div className="flex flex-col gap-4">
          <Field label={t("settings.ai.protocolLabel")}>
            <Select
              value={protocol}
              onValueChange={(value) => changeProtocol(value as AiProtocol)}
              options={AI_PROTOCOLS.map((item) => ({
                value: item.value,
                label: t(`settings.ai.protocol.${item.value}`),
              }))}
            />
          </Field>

          <Field
            label={t("settings.ai.modelLabel")}
            hint={t("settings.ai.modelHint")}
          >
            <DraftInput
              value={model}
              onCommit={commitModel}
              maxLength={1024}
              placeholder="provider/model-id"
              autoComplete="off"
              spellCheck={false}
            />
          </Field>

          <Field
            label={t("settings.ai.baseUrlLabel")}
            hint={t("settings.ai.baseUrlHint")}
          >
            <DraftInput
              value={baseUrl}
              onCommit={commitBaseUrl}
              maxLength={8192}
              placeholder={exampleBaseUrl(protocol)}
              autoComplete="off"
              spellCheck={false}
            />
          </Field>

          <Field
            label={t("settings.ai.apiKeyLabel")}
            hint={t("settings.ai.apiKeyHint")}
          >
            <div className="flex flex-col items-stretch gap-2 sm:flex-row sm:items-center">
              <div className="min-w-0 flex-1">
                <DraftInput
                  password
                  value=""
                  onCommit={commitApiKey}
                  maxLength={16384}
                  placeholder={
                    config.hasApiKey
                      ? t("settings.ai.apiKeySavedPlaceholder")
                      : "sk-…"
                  }
                  autoComplete="off"
                  spellCheck={false}
                />
              </div>
              {config.hasApiKey && (
                <Button variant="outline" onClick={() => commitApiKey("")}>
                  {t("settings.ai.apiKeyClear")}
                </Button>
              )}
            </div>
          </Field>
        </div>
      </SettingsGroup>

      <SettingsGroup title={t("settings.ai.behaviorTitle")}>
        <div className="flex flex-col gap-4">
          <SwitchField
            fieldLabel={t("settings.ai.autonomousModeLabel")}
            label={t("settings.ai.autonomousMode")}
            hint={t("settings.ai.autonomousModeHint")}
            description={t("settings.ai.autonomousModeWarning")}
            descriptionClassName="text-danger"
            checked={autoApprove}
            onCheckedChange={changeAutoApprove}
          />

          <Field
            label={t("settings.ai.maxHistoryTokensLabel")}
            hint={t("settings.ai.maxHistoryTokensHint")}
          >
            <DraftInput
              type="number"
              min={0}
              max={4294967295}
              step={1000}
              value={maxHistoryTokens?.toString() ?? ""}
              onCommit={commitMaxHistoryTokens}
              placeholder="200000"
              autoComplete="off"
              spellCheck={false}
            />
          </Field>
        </div>
      </SettingsGroup>

      <SettingsGroup
        title={t("settings.ai.tools.title")}
        description={t("settings.ai.tools.description")}
      >
        <div
          aria-label={t("settings.ai.tools.title")}
          className="overflow-hidden rounded-lg border border-border bg-card"
        >
          {TOOL_GROUPS.map((group) => (
            <ToolTreeGroup
              key={group.id}
              group={group}
              expanded={expandedToolGroups.has(group.id)}
              enabledTools={enabledTools}
              onToggleExpanded={() => toggleToolGroupExpanded(group.id)}
              onToggleTool={toggleTool}
              onToggleGroup={toggleToolGroup}
            />
          ))}
        </div>
      </SettingsGroup>
    </div>
  );
}

type ToolGroup = (typeof TOOL_GROUPS)[number];

function ToolTreeGroup({
  group,
  expanded,
  enabledTools,
  onToggleExpanded,
  onToggleTool,
  onToggleGroup,
}: {
  group: ToolGroup;
  expanded: boolean;
  enabledTools: string[];
  onToggleExpanded: () => void;
  onToggleTool: (name: string, checked: boolean) => void;
  onToggleGroup: (names: readonly string[], checked: boolean) => void;
}) {
  const { t } = useI18n();
  const core = group.id === "core";
  const names = group.tools.map((tool) => tool.spec.name);
  const enabledCount = core
    ? names.length
    : names.filter((name) => enabledTools.includes(name)).length;
  const allEnabled = enabledCount === names.length;
  const partiallyEnabled = enabledCount > 0 && !allEnabled;
  const groupLabel = t(`settings.ai.tools.group.${group.id}`);

  return (
    <Collapsible open={expanded} onOpenChange={onToggleExpanded}>
      <div className="flex min-h-8 items-center gap-1.5 px-2 py-1 hover:bg-list-hover">
        <CollapsibleTrigger asChild>
          <button
            type="button"
            aria-label={groupLabel}
            className="shrink-0 rounded-sm outline-none focus-visible:ring-2 focus-visible:ring-ring/60"
          >
            <ChevronRight
              className={cn(
                "size-3.5 text-muted-foreground transition-transform",
                expanded && "rotate-90",
              )}
            />
          </button>
        </CollapsibleTrigger>
        <TreeCheckbox
          checked={allEnabled}
          indeterminate={partiallyEnabled}
          disabled={core}
          onChange={(event) => onToggleGroup(names, event.target.checked)}
          aria-label={groupLabel}
        />
        <CollapsibleTrigger asChild>
          <button
            type="button"
            className="flex min-w-0 flex-1 items-center gap-1.5 rounded-sm text-left outline-none focus-visible:ring-2 focus-visible:ring-ring/60"
          >
            <span className="min-w-0 flex-1 truncate text-xs font-medium">
              {groupLabel}
            </span>
            <span className="shrink-0 text-2xs tabular-nums text-muted-foreground">
              {enabledCount}/{names.length}
            </span>
            {core && (
              <span className="shrink-0 text-2xs text-muted-foreground">
                {t("settings.ai.tools.required")}
              </span>
            )}
          </button>
        </CollapsibleTrigger>
      </div>

      <CollapsibleContent>
        <div className="py-0.5 pl-5 pr-2">
          <div className="pl-5">
            {group.tools.map((tool) => {
              const name = tool.spec.name;
              const checked = core || enabledTools.includes(name);
              const Icon = tool.icon;
              return (
                <label
                  key={name}
                  className={cn(
                    "flex min-h-7 items-center gap-2 rounded py-1 pl-2 pr-0",
                    core ? "cursor-default" : "cursor-pointer hover:bg-accent",
                  )}
                >
                  <TreeCheckbox
                    checked={checked}
                    disabled={core}
                    onChange={(event) =>
                      onToggleTool(name, event.target.checked)
                    }
                    aria-label={t(tool.labelKey)}
                  />
                  <Icon className="size-3 shrink-0 text-muted-foreground" />
                  <span className="min-w-0 flex-1 truncate text-xs">
                    {t(tool.labelKey)}
                  </span>
                </label>
              );
            })}
          </div>
        </div>
      </CollapsibleContent>
    </Collapsible>
  );
}

function TreeCheckbox({
  indeterminate = false,
  className,
  ...props
}: React.ComponentProps<"input"> & { indeterminate?: boolean }) {
  const ref = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (ref.current) ref.current.indeterminate = indeterminate;
  }, [indeterminate]);

  return (
    <input
      {...props}
      ref={ref}
      type="checkbox"
      className={cn("ui-checkbox", className)}
    />
  );
}
