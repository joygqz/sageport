import { useEffect, useRef, useState } from "react";
import {
  Check,
  ChevronRight,
  Info,
  Minus,
  Palette,
  Plus,
  RefreshCw,
  Sparkles,
} from "lucide-react";

import {
  Button,
  Field,
  Input,
  Kbd,
  PasswordInput,
  ScrollArea,
  SectionHeader,
  SegmentedControl,
  Select,
  Switch,
  Tooltip,
} from "@/components/ui";
import { LOCALE_LABELS, LOCALES, useI18n, type TKey } from "@/i18n";
import { errorMessage, toast } from "@/lib/toast";
import { cn } from "@/lib/utils";
import { THEMES, useTheme, type ThemeDefinition } from "@/themes";
import { useFontStore } from "@/workbench/font";
import { useTabsStore, type SettingsSection } from "@/workbench/tabs";
import {
  useZoomStore,
  zoomFactor,
  ZOOM_LEVEL_MAX,
  ZOOM_LEVEL_MIN,
} from "@/workbench/zoom";
import type { AiConfig, AiProtocol } from "@/types/models";
import {
  AI_PROTOCOLS,
  defaultBaseUrl,
  useAiConfig,
  useSetAiConfig,
} from "@/features/ai/api";
import {
  CORE_TOOL_NAMES,
  normalizeEnabledToolNames,
  TOOL_GROUPS,
} from "@/features/ai/tools";
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
    <div className="settings-page h-full overflow-x-auto overflow-y-hidden bg-background">
      <div className="flex h-full min-w-xl flex-col">
        <div className="shrink-0 border-b border-border">
          <div className="w-full max-w-2xl px-6 py-3">
            <SegmentedControl
              value={section}
              onChange={setSection}
              options={NAV.map((item) => {
                const Icon = item.icon;
                return {
                  value: item.id,
                  label: (
                    <span className="flex items-center justify-center gap-2">
                      <Icon className="size-4 shrink-0" />
                      <span className="truncate">{t(item.labelKey)}</span>
                    </span>
                  ),
                };
              })}
            />
          </div>
        </div>

        <ScrollArea className="min-h-0 flex-1">
          <div className="settings-content flex w-full max-w-2xl flex-col gap-6 p-6">
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

  const groups = [
    {
      labelKey: "settings.appearance.darkThemes" as TKey,
      themes: THEMES.filter((candidate) => candidate.appearance === "dark"),
    },
    {
      labelKey: "settings.appearance.lightThemes" as TKey,
      themes: THEMES.filter((candidate) => candidate.appearance === "light"),
    },
  ];

  return (
    <div className="flex flex-col gap-4">
      <SectionHeader
        title={t("settings.appearance.themeTitle")}
        description={t("settings.appearance.themeDescription")}
      />

      {groups.map((group) => (
        <div key={group.labelKey} className="flex flex-col gap-2">
          <p className="text-xs font-medium text-muted-foreground">
            {t(group.labelKey)}
          </p>
          <div className="grid grid-cols-[repeat(auto-fill,minmax(min(100%,13rem),1fr))] gap-3">
            {group.themes.map((candidate) => (
              <ThemeCard
                key={candidate.id}
                theme={candidate}
                active={candidate.id === theme.id}
                onSelect={() => setTheme(candidate.id)}
              />
            ))}
          </div>
        </div>
      ))}

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

      <FontField />

      <ZoomField />
    </div>
  );
}

function FontField() {
  const { t } = useI18n();
  const family = useFontStore((s) => s.family);
  const setFamily = useFontStore((s) => s.setFamily);
  const [draft, setDraft] = useState<string | null>(null);

  useEffect(() => {
    if (draft === null) return;
    const timer = setTimeout(() => {
      setFamily(draft);
      setDraft(null);
    }, 500);
    return () => clearTimeout(timer);
  }, [draft, setFamily]);

  return (
    <Field
      label={t("settings.appearance.fontFamily")}
      hint={t("settings.appearance.fontFamilyHint")}
    >
      <Input
        value={draft ?? family}
        onChange={(e) => setDraft(e.target.value)}
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

  return (
    <button
      type="button"
      onClick={onSelect}
      aria-pressed={active}
      className={cn(
        "flex min-w-0 flex-col overflow-hidden rounded-lg border text-left outline-none transition-[border-color,box-shadow] focus-visible:ring-2 focus-visible:ring-ring/40",
        active
          ? "border-primary ring-2 ring-primary/40"
          : "border-input hover:border-ring",
      )}
    >
      <div
        className="flex h-20"
        style={{
          backgroundColor: terminal.background,
          color: terminal.foreground,
        }}
      >
        <div
          className="flex w-1/4 flex-col gap-1 border-r p-1.5"
          style={{
            backgroundColor: colors.surface,
            borderColor: colors.border,
          }}
        >
          <span
            className="h-1 w-3/4 rounded-full"
            style={{ backgroundColor: colors.primary }}
          />
          <span
            className="h-1 w-full rounded-full opacity-70"
            style={{ backgroundColor: colors.mutedForeground }}
          />
          <span
            className="h-1 w-2/3 rounded-full opacity-70"
            style={{ backgroundColor: colors.mutedForeground }}
          />
        </div>
        <div className="flex min-w-0 flex-1 flex-col gap-1.5 p-2 font-mono">
          <div
            className="flex h-5 items-center gap-1 rounded px-1.5"
            style={{ backgroundColor: colors.listActive }}
          >
            <span
              className="size-1.5 rounded-full"
              style={{ backgroundColor: terminal.green }}
            />
            <span
              className="h-1 w-1/2 rounded-full"
              style={{ backgroundColor: colors.listActiveForeground }}
            />
          </div>
          <div className="mt-auto flex items-center gap-1 text-[8px] leading-none">
            <span style={{ color: terminal.green }}>$</span>
            <span style={{ color: terminal.blue }}>ssh</span>
            <span style={{ color: terminal.foreground }}>sageport</span>
            <span
              className="h-2 w-px"
              style={{ backgroundColor: terminal.cursor }}
            />
          </div>
        </div>
      </div>
      <div
        className="flex w-full items-center gap-1.5 border-t px-2 py-1.5"
        style={{
          backgroundColor: colors.surface,
          borderColor: colors.border,
          color: colors.surfaceForeground,
        }}
      >
        <p className="min-w-0 flex-1 truncate text-xs font-medium">
          {theme.name}
        </p>
        {active && (
          <span
            className="flex size-4 shrink-0 items-center justify-center rounded-full"
            style={{
              backgroundColor: colors.primary,
              color: colors.primaryForeground,
            }}
          >
            <Check className="size-2.5" strokeWidth={3} />
          </span>
        )}
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
  const [apiKey, setApiKey] = useState(config.apiKey);
  const [autoApprove, setAutoApprove] = useState(config.autoApprove);
  const [enabledTools, setEnabledTools] = useState(() =>
    normalizeEnabledToolNames(config.enabledTools ?? []),
  );
  const [maxHistoryTokens, setMaxHistoryTokens] = useState(
    config.maxHistoryTokens,
  );
  const [expandedToolGroups, setExpandedToolGroups] = useState<Set<string>>(
    () => new Set(),
  );
  const mutate = setConfig.mutate;
  const skipSave = useRef(true);
  const pendingSave = useRef<{
    baseUrl: string;
    protocol: AiProtocol;
    apiKey: string;
    autoApprove: boolean;
    enabledTools: string[];
    maxHistoryTokens: number | null;
  } | null>(null);

  const changeProtocol = (next: AiProtocol) => {
    setProtocol(next);
    setBaseUrl(defaultBaseUrl(next));
  };

  useEffect(() => {
    if (skipSave.current) {
      skipSave.current = false;
      return;
    }
    pendingSave.current = {
      baseUrl,
      protocol,
      apiKey,
      autoApprove,
      enabledTools,
      maxHistoryTokens,
    };
    const timer = setTimeout(() => {
      pendingSave.current = null;
      mutate(
        {
          baseUrl,
          protocol,
          apiKey,
          autoApprove,
          enabledTools,
          maxHistoryTokens,
        },
        {
          onError: (err) =>
            toast.error(t("settings.ai.saveError"), errorMessage(err)),
        },
      );
    }, 500);
    return () => clearTimeout(timer);
  }, [
    protocol,
    baseUrl,
    apiKey,
    autoApprove,
    enabledTools,
    maxHistoryTokens,
    mutate,
    t,
  ]);

  const toggleTool = (name: string, checked: boolean) => {
    setEnabledTools((current) =>
      normalizeEnabledToolNames(
        checked ? [...current, name] : current.filter((item) => item !== name),
      ),
    );
  };

  const toggleToolGroup = (names: readonly string[], checked: boolean) => {
    setEnabledTools((current) =>
      normalizeEnabledToolNames(
        checked
          ? [...current, ...names]
          : current.filter((name) => !names.includes(name)),
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

  useEffect(
    () => () => {
      if (pendingSave.current) {
        mutate(pendingSave.current, {
          onError: (err) =>
            toast.error(t("settings.ai.saveError"), errorMessage(err)),
        });
      }
    },
    [mutate, t],
  );

  return (
    <div className="flex flex-col gap-4">
      <SectionHeader
        title={t("settings.ai.title")}
        description={t("settings.ai.description")}
      />

      <Field label={t("settings.ai.protocolLabel")}>
        <Select
          value={protocol}
          onChange={(e) => changeProtocol(e.target.value as AiProtocol)}
        >
          {AI_PROTOCOLS.map((p) => (
            <option key={p.value} value={p.value}>
              {t(`settings.ai.protocol.${p.value}`)}
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
        hint={t("settings.ai.apiKeyHint")}
      >
        <PasswordInput
          value={apiKey}
          onChange={(e) => setApiKey(e.target.value)}
          placeholder="sk-…"
          autoComplete="off"
          spellCheck={false}
        />
      </Field>

      <Field
        label={t("settings.ai.autonomousModeLabel")}
        hint={t("settings.ai.autonomousModeHint")}
      >
        <div className="flex items-center justify-between gap-4 rounded-md border border-input px-3 py-2.5">
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
            onCheckedChange={setAutoApprove}
            aria-label={t("settings.ai.autonomousMode")}
          />
        </div>
      </Field>

      <Field
        label={t("settings.ai.maxHistoryTokensLabel")}
        hint={t("settings.ai.maxHistoryTokensHint")}
      >
        <Input
          type="number"
          min={0}
          step={1000}
          value={maxHistoryTokens ?? ""}
          onChange={(e) => {
            const parsed = Number.parseInt(e.target.value, 10);
            setMaxHistoryTokens(
              Number.isFinite(parsed) && parsed > 0 ? parsed : null,
            );
          }}
          placeholder="200000"
          autoComplete="off"
          spellCheck={false}
        />
      </Field>

      <div className="mt-2 flex flex-col gap-3">
        <SectionHeader
          title={t("settings.ai.tools.title")}
          description={t("settings.ai.tools.description")}
        />
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
          className="overflow-hidden rounded-md border border-input"
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
    <div>
      <div className="flex min-h-7 items-center gap-1.5 px-2 py-1 hover:bg-accent/60">
        <button
          type="button"
          onClick={onToggleExpanded}
          aria-expanded={expanded}
          aria-label={groupLabel}
          className="shrink-0 rounded-sm outline-none focus-visible:ring-2 focus-visible:ring-ring/40"
        >
          <ChevronRight
            className={cn(
              "size-3.5 text-muted-foreground transition-transform",
              expanded && "rotate-90",
            )}
          />
        </button>
        <TreeCheckbox
          checked={allEnabled}
          indeterminate={partiallyEnabled}
          disabled={core}
          onChange={(event) => onToggleGroup(names, event.target.checked)}
          aria-label={groupLabel}
        />
        <button
          type="button"
          onClick={onToggleExpanded}
          aria-expanded={expanded}
          className="flex min-w-0 flex-1 items-center gap-1.5 rounded-sm text-left outline-none focus-visible:ring-2 focus-visible:ring-ring/40"
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
      </div>

      {expanded && (
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
      )}
    </div>
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
      className={cn(
        "size-4 shrink-0 accent-primary disabled:cursor-not-allowed",
        className,
      )}
    />
  );
}
