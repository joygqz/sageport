import { useEffect, useRef, useState } from "react";
import {
  Check,
  ChevronRight,
  Info,
  Laptop,
  Minus,
  Moon,
  Palette,
  Plus,
  RefreshCw,
  Sparkles,
  Sun,
} from "lucide-react";

import {
  Button,
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
  CONTROL_BORDER_CLASS,
  CONTROL_FOCUS_CLASS,
  Dialog,
  DialogContent,
  DialogToolbar,
  ErrorState,
  Field,
  Input,
  Kbd,
  LoadingState,
  PasswordInput,
  RadioGroup,
  RadioGroupItem,
  ScrollArea,
  SectionHeader,
  SegmentedControl,
  Separator,
  Select,
  Switch,
  Tooltip,
} from "@/components/ui";
import { LOCALE_LABELS, LOCALES, useI18n, type TKey } from "@/i18n";
import { errorMessage, toast } from "@/lib/toast";
import { cn } from "@/lib/utils";
import {
  THEME_FAMILIES,
  useTheme,
  type ThemeAppearance,
  type ThemeFamilyDefinition,
  type ThemeMode,
} from "@/themes";
import { useFontStore } from "@/workbench/font";
import type { SettingsSection } from "@/workbench/overlays";
import {
  useZoomStore,
  zoomFactor,
  ZOOM_LEVEL_MAX,
  ZOOM_LEVEL_MIN,
} from "@/workbench/zoom";
import type { AiConfig, AiProtocol } from "@/types/models";
import {
  AI_PROTOCOLS,
  exampleBaseUrl,
  useAiConfig,
  useSetAiConfig,
  useSetAiModel,
} from "@/features/ai/api";
import {
  CORE_TOOL_NAMES,
  normalizeEnabledToolNames,
  resolveEnabledToolNames,
  TOOL_GROUPS,
} from "@/features/ai/tools";
import { SyncSection } from "@/features/sync/SyncSection";
import { AboutSection } from "./AboutSection";

const NAV: {
  id: SettingsSection;
  labelKey: TKey;
  descriptionKey?: TKey;
  icon: typeof Palette;
}[] = [
  { id: "appearance", labelKey: "settings.nav.appearance", icon: Palette },
  {
    id: "ai",
    labelKey: "settings.nav.ai",
    descriptionKey: "settings.ai.description",
    icon: Sparkles,
  },
  {
    id: "sync",
    labelKey: "settings.nav.sync",
    descriptionKey: "settings.sync.description",
    icon: RefreshCw,
  },
  { id: "about", labelKey: "settings.nav.about", icon: Info },
];

const THEME_DESCRIPTION_KEYS: Record<string, TKey> = {
  midnight: "settings.appearance.familyMidnight",
  graphite: "settings.appearance.familyGraphite",
  dracula: "settings.appearance.familyDracula",
};

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

  return (
    <Dialog open={open} onOpenChange={(next) => !next && onClose()}>
      <DialogContent
        showClose={false}
        className="flex h-[min(44rem,calc(100dvh-2rem))] w-[min(58rem,calc(100vw-2rem))] max-w-none flex-col gap-0 overflow-hidden bg-background p-0 text-foreground sm:h-[min(44rem,calc(100dvh-4rem))] sm:w-[min(58rem,calc(100vw-4rem))] sm:p-0"
      >
        <DialogToolbar className="bg-background">
          {t("settings.title")}
        </DialogToolbar>
        <SettingsPage section={section} onSectionChange={onSectionChange} />
      </DialogContent>
    </Dialog>
  );
}

function SettingsPage({
  section,
  onSectionChange,
}: {
  section: SettingsSection;
  onSectionChange: (section: SettingsSection) => void;
}) {
  const { t } = useI18n();
  const currentSection = NAV.find((item) => item.id === section)!;

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
                    "flex h-[var(--control-height)] shrink-0 items-center gap-2.5 rounded-lg px-2.5 text-left text-sm outline-none transition-colors focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring/35 sm:w-full",
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
          <main className="settings-content flex w-full max-w-3xl flex-col gap-6 px-5 py-6 sm:px-8 sm:py-8">
            {section !== "sync" && (
              <div>
                <h1 className="text-lg font-semibold tracking-tight text-foreground">
                  {t(currentSection.labelKey)}
                </h1>
                {currentSection.descriptionKey && (
                  <p className="mt-1.5 text-sm leading-relaxed text-muted-foreground">
                    {t(currentSection.descriptionKey)}
                  </p>
                )}
              </div>
            )}
            {section === "appearance" && <AppearanceSection />}
            {section === "ai" && <AiSection />}
            {section === "sync" && <SyncSection />}
            {section === "about" && <AboutSection />}
          </main>
        </ScrollArea>
      </div>
    </div>
  );
}

function AppearanceSection() {
  const { t, locale, setLocale } = useI18n();
  const { preference, setFamily, setMode } = useTheme();

  const modes: { value: ThemeMode; label: React.ReactNode }[] = [
    {
      value: "system",
      label: (
        <span className="flex items-center justify-center gap-2">
          <Laptop className="size-3.5" />
          {t("settings.appearance.modeSystem")}
        </span>
      ),
    },
    {
      value: "light",
      label: (
        <span className="flex items-center justify-center gap-2">
          <Sun className="size-3.5" />
          {t("settings.appearance.modeLight")}
        </span>
      ),
    },
    {
      value: "dark",
      label: (
        <span className="flex items-center justify-center gap-2">
          <Moon className="size-3.5" />
          {t("settings.appearance.modeDark")}
        </span>
      ),
    },
  ];

  return (
    <div className="flex flex-col gap-6">
      <Field label={t("settings.appearance.colorMode")}>
        <SegmentedControl
          value={preference.mode}
          onChange={setMode}
          options={modes}
        />
      </Field>

      <Field label={t("settings.appearance.themeFamily")}>
        <RadioGroup
          value={preference.familyId}
          onValueChange={setFamily}
          className="grid grid-cols-[repeat(auto-fill,minmax(min(100%,12rem),1fr))] gap-3"
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

      <Separator />

      <Field
        label={t("settings.appearance.language")}
        hint={t("settings.appearance.languageHint")}
      >
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
    </div>
  );
}

function DraftInput({
  value,
  onCommit,
  password = false,
  ...props
}: Omit<React.ComponentProps<typeof Input>, "value" | "onChange" | "onBlur"> & {
  value: string;
  onCommit: (next: string) => void;
  password?: boolean;
}) {
  const [draft, setDraft] = useState<string | null>(null);
  const pending = useRef({ draft, value, onCommit });

  useEffect(() => {
    pending.current = { draft, value, onCommit };
  });

  useEffect(
    () => () => {
      const { draft, value, onCommit } = pending.current;
      if (draft !== null && draft !== value) onCommit(draft);
    },
    [],
  );

  const commit = () => {
    if (draft === null) return;
    setDraft(null);
    if (draft !== value) onCommit(draft);
  };

  const inputProps = {
    ...props,
    value: draft ?? value,
    onChange: (e: React.ChangeEvent<HTMLInputElement>) =>
      setDraft(e.target.value),
    onBlur: commit,
  };
  return password ? (
    <PasswordInput {...inputProps} />
  ) : (
    <Input {...inputProps} />
  );
}

function FontField() {
  const { t } = useI18n();
  const family = useFontStore((s) => s.family);
  const setFamily = useFontStore((s) => s.setFamily);

  return (
    <Field
      label={t("settings.appearance.fontFamily")}
      hint={t("settings.appearance.fontFamilyHint")}
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
  const [apiKey, setApiKey] = useState(config.apiKey);
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
  const values = useRef({
    baseUrl: config.baseUrl,
    protocol: config.protocol,
    apiKey: config.apiKey,
    autoApprove: config.autoApprove,
    enabledTools: resolveEnabledToolNames(config.enabledTools),
    maxHistoryTokens: config.maxHistoryTokens,
  });
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const saveConfig = (patch: Partial<typeof values.current>) => {
    values.current = { ...values.current, ...patch };
    if (saveTimer.current !== null) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(() => {
      saveTimer.current = null;
      mutate(values.current, {
        onError: (err) =>
          toast.error(t("settings.ai.saveError"), errorMessage(err)),
      });
    }, 500);
  };

  useEffect(
    () => () => {
      if (saveTimer.current !== null) {
        clearTimeout(saveTimer.current);
        saveTimer.current = null;
        mutate(values.current, {
          onError: (err) =>
            toast.error(t("settings.ai.saveError"), errorMessage(err)),
        });
      }
    },
    [mutate, t],
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
    setApiKey(next);
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
    <div className="flex flex-col gap-6">
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
          label={t("settings.ai.apiKeyLabel")}
          hint={t("settings.ai.apiKeyHint")}
        >
          <DraftInput
            password
            value={apiKey}
            onCommit={commitApiKey}
            maxLength={16384}
            placeholder="sk-…"
            autoComplete="off"
            spellCheck={false}
          />
        </Field>

        <Field
          label={t("settings.ai.autonomousModeLabel")}
          hint={t("settings.ai.autonomousModeHint")}
        >
          <div className="flex items-center justify-between gap-4 rounded-lg border border-border bg-card px-3 py-2.5">
            <div className="min-w-0">
              <p className="text-sm font-medium">
                {t("settings.ai.autonomousMode")}
              </p>
              <p className="mt-0.5 text-xs text-danger">
                {t("settings.ai.autonomousModeWarning")}
              </p>
            </div>
            <Switch
              checked={autoApprove}
              onCheckedChange={changeAutoApprove}
              aria-label={t("settings.ai.autonomousMode")}
            />
          </div>
        </Field>

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

      <div className="flex flex-col gap-3">
        <SectionHeader title={t("settings.ai.tools.title")} />
        <p className="text-xs text-muted-foreground">
          {t("settings.ai.tools.enabledSummary", {
            enabled: CORE_TOOL_NAMES.size + enabledTools.length,
            total: TOOL_GROUPS.reduce(
              (count, group) => count + group.tools.length,
              0,
            ),
          })}
        </p>

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
        <p className="text-xs leading-relaxed text-muted-foreground">
          {t("settings.ai.tools.description")}
        </p>
      </div>
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
            className="shrink-0 rounded-sm outline-none focus-visible:ring-2 focus-visible:ring-ring/35"
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
            className="flex min-w-0 flex-1 items-center gap-1.5 rounded-sm text-left outline-none focus-visible:ring-2 focus-visible:ring-ring/35"
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
