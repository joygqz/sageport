import { useEffect, useLayoutEffect, useRef, useState } from "react";
import {
  ArrowUp,
  Check,
  Copy,
  History,
  KeyRound,
  MessageCirclePlus,
  Sparkles,
  Square,
  Terminal as TerminalIcon,
  Trash2,
  X,
} from "lucide-react";
import ReactMarkdown, { type Components } from "react-markdown";
import remarkGfm from "remark-gfm";
import { openUrl } from "@tauri-apps/plugin-opener";

import {
  Button,
  CONTROL_INTERACTION_CLASS,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  EmptyState,
  Select,
  Textarea,
  Tooltip,
} from "@/components/ui";
import { useI18n } from "@/i18n";
import { errorMessage, toast } from "@/lib/toast";
import { cn } from "@/lib/utils";
import { useLayoutStore } from "@/workbench/layout";
import { useOverlayStore } from "@/workbench/overlays";
import {
  PanelHeader,
  PANEL_HEADER_ACTION_CLASS,
} from "@/workbench/PanelHeader";
import { useTabsStore } from "@/workbench/tabs";
import { useAiConfig, useAiModels, useSetAiModel } from "./api";
import { pickSuggestionsForSession } from "./suggestions";
import { useAiStore } from "./store";
import type { AgentLogItem } from "./transcript";
import { askUserOptions, askUserQuestion } from "./tools";
import { resolveEnabledToolNames, TOOL_GROUPS } from "./tools/registry";
import { QuestionPrompt, ToolActivity } from "./ToolActivity";

const EMPTY_LOG: AgentLogItem[] = [];

export function AssistantPanel({ width }: { width: number }) {
  const { t } = useI18n();
  const { data: config } = useAiConfig();
  const setModel = useSetAiModel();
  const configured = Boolean(config?.apiKey);
  const { data: fetchedModels, error: modelsError } = useAiModels(configured);
  const toggleAux = useLayoutStore((s) => s.toggleAux);
  const openSettings = useOverlayStore((s) => s.openSettings);

  const sessions = useAiStore((s) => s.sessions);
  const activeId = useAiStore((s) => s.activeId);
  const runtime = useAiStore((s) =>
    s.activeId ? s.runtime[s.activeId] : undefined,
  );
  const loadSessions = useAiStore((s) => s.loadSessions);
  const openSession = useAiStore((s) => s.openSession);
  const newSession = useAiStore((s) => s.newSession);
  const deleteSession = useAiStore((s) => s.deleteSession);
  const send = useAiStore((s) => s.send);
  const resume = useAiStore((s) => s.resume);
  const stop = useAiStore((s) => s.stop);
  const approve = useAiStore((s) => s.approve);
  const deny = useAiStore((s) => s.deny);
  const answer = useAiStore((s) => s.answer);

  const log = runtime?.log ?? EMPTY_LOG;
  const pending = runtime?.pending ?? false;
  const activity = runtime?.activity ?? null;
  const stepLimitReached = runtime?.stepLimitReached ?? false;
  const awaitingUser = log.some(
    (item) =>
      item.kind === "tool" &&
      (item.status === "awaiting-approval" || item.status === "awaiting-input"),
  );
  const toolRunning = log.some(
    (item) => item.kind === "tool" && item.status === "running",
  );
  const showThinking =
    pending && activity === "thinking" && !awaitingUser && !toolRunning;

  const [input, setInput] = useState("");
  const [deleteTargetId, setDeleteTargetId] = useState<string | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const stickToBottom = useRef(true);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const enabledToolList = resolveEnabledToolNames(config?.enabledTools);
  const enabledToolNames = new Set(enabledToolList);
  const enabledSuggestionGroups = TOOL_GROUPS.filter(
    ({ id, tools }) =>
      id === "core" ||
      tools.some(({ spec }) => enabledToolNames.has(spec.name)),
  ).map(({ id }) => id);
  const suggestions = pickSuggestionsForSession(
    activeId ?? "pending-session",
    enabledSuggestionGroups,
  );

  const onLogScroll = () => {
    const el = scrollRef.current;
    if (!el) return;
    stickToBottom.current =
      el.scrollHeight - el.scrollTop - el.clientHeight < 4;
  };

  useEffect(() => {
    if (configured) void loadSessions();
  }, [configured, loadSessions]);

  useEffect(() => {
    if (modelsError) toast.error(t("ai.error"), errorMessage(modelsError));
  }, [modelsError, t]);

  const models = [
    ...new Set([config?.model, ...(fetchedModels ?? [])].filter(Boolean)),
  ] as string[];

  const model = config?.model || models[0] || "";

  const changeModel = (next: string) => {
    setModel.mutate(next, {
      onError: (err) => toast.error(t("ai.error"), errorMessage(err)),
    });
  };

  const createSession = async () => {
    try {
      await newSession();
      inputRef.current?.focus();
    } catch (err) {
      toast.error(t("ai.error"), errorMessage(err));
    }
  };

  useEffect(() => {
    stickToBottom.current = true;
  }, [activeId]);

  useLayoutEffect(() => {
    if (!stickToBottom.current) return;
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [log, pending]);

  useLayoutEffect(() => {
    const el = inputRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${el.scrollHeight}px`;
    if (stickToBottom.current && scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [input]);

  const sendPrompt = async (prompt: string): Promise<boolean> => {
    if (!prompt || pending || !model) return false;
    stickToBottom.current = true;
    try {
      const sessionId = activeId ?? (await newSession());
      void send(
        sessionId,
        prompt,
        model,
        config?.autoApprove ?? false,
        enabledToolList,
        config?.maxHistoryTokens,
      );
      return true;
    } catch (err) {
      toast.error(t("ai.error"), errorMessage(err));
      return false;
    }
  };

  const submit = async () => {
    const prompt = input.trim();
    if (!prompt) return;
    if (await sendPrompt(prompt)) setInput("");
  };

  const continueRun = () => {
    if (!activeId || !model || pending) return;
    stickToBottom.current = true;
    void resume(
      activeId,
      model,
      config?.autoApprove ?? false,
      enabledToolList,
      config?.maxHistoryTokens,
    );
  };

  const activeTitle = sessions.find((s) => s.id === activeId)?.title;

  return (
    <aside
      style={{ width }}
      className="flex shrink-0 flex-col overflow-hidden bg-surface"
    >
      <PanelHeader
        title={activeTitle || t("ai.viewTitle")}
        titleAfter={
          config?.autoApprove ? (
            <button
              type="button"
              onClick={() => openSettings("ai")}
              className="shrink-0 rounded bg-danger/15 px-1.5 py-0.5 text-2xs font-medium text-danger hover:bg-danger/25"
              title={t("ai.autonomousModeHint")}
            >
              {t("ai.autonomousMode")}
            </button>
          ) : undefined
        }
        actions={
          <>
            {configured && (
              <>
                <Tooltip content={t("ai.newChat")}>
                  <Button
                    size="icon"
                    variant="ghost"
                    className={PANEL_HEADER_ACTION_CLASS}
                    onClick={() => void createSession()}
                  >
                    <MessageCirclePlus className="size-4" />
                  </Button>
                </Tooltip>
                <DropdownMenu
                  onOpenChange={(open) => {
                    if (!open) setDeleteTargetId(null);
                  }}
                >
                  <Tooltip content={t("ai.history")}>
                    <DropdownMenuTrigger asChild>
                      <Button
                        size="icon"
                        variant="ghost"
                        className={PANEL_HEADER_ACTION_CLASS}
                      >
                        <History className="size-4" />
                      </Button>
                    </DropdownMenuTrigger>
                  </Tooltip>
                  <DropdownMenuContent
                    align="end"
                    className="max-h-[var(--radix-dropdown-menu-content-available-height)] w-64 overflow-y-auto overscroll-contain"
                  >
                    {sessions.length === 0 ? (
                      <div className="px-2 py-3 text-center text-xs text-muted-foreground">
                        {t("ai.noSessions")}
                      </div>
                    ) : (
                      sessions.map((s) => (
                        <DropdownMenuItem
                          key={s.id}
                          className="gap-1.5"
                          onSelect={() => void openSession(s.id)}
                        >
                          <span className="min-w-0 flex-1 truncate">
                            {s.title || t("ai.untitledChat")}
                          </span>
                          {s.id === activeId && (
                            <Check className="size-3.5 shrink-0 text-link" />
                          )}
                          <button
                            type="button"
                            aria-label={t(
                              deleteTargetId === s.id
                                ? "common.confirm"
                                : "common.delete",
                            )}
                            className={cn(
                              "rounded text-muted-foreground hover:bg-accent hover:text-danger",
                              deleteTargetId === s.id
                                ? "px-2 py-1 text-xs font-medium text-danger"
                                : "p-1",
                            )}
                            onClick={(e) => {
                              e.stopPropagation();
                              if (deleteTargetId === s.id) {
                                setDeleteTargetId(null);
                                void deleteSession(s.id);
                              } else {
                                setDeleteTargetId(s.id);
                              }
                            }}
                          >
                            {deleteTargetId === s.id ? (
                              t("common.confirm")
                            ) : (
                              <Trash2 className="size-3.5" />
                            )}
                          </button>
                        </DropdownMenuItem>
                      ))
                    )}
                  </DropdownMenuContent>
                </DropdownMenu>
              </>
            )}
            <Tooltip content={t("ai.hidePanel")}>
              <Button
                size="icon"
                variant="ghost"
                className={PANEL_HEADER_ACTION_CLASS}
                onClick={toggleAux}
              >
                <X className="size-4" />
              </Button>
            </Tooltip>
          </>
        }
      />

      {!configured ? (
        <EmptyState
          className="m-auto"
          icon={KeyRound}
          title={t("ai.setup.title")}
          description={t("ai.setup.description")}
          action={
            <Button size="sm" onClick={() => openSettings("ai")}>
              {t("ai.setup.action")}
            </Button>
          }
        />
      ) : (
        <>
          <div
            ref={scrollRef}
            onScroll={onLogScroll}
            className="flex-1 overflow-y-auto"
          >
            <div className="flex min-h-full flex-col gap-3 p-3">
              {log.length === 0 ? (
                <div className="my-auto flex w-full max-w-md self-center flex-col gap-3 py-4">
                  <EmptyState
                    className="gap-3 px-4 py-4"
                    icon={Sparkles}
                    title={t("ai.empty.title")}
                    description={t(
                      config?.autoApprove
                        ? "ai.empty.descriptionAutonomous"
                        : "ai.empty.description",
                    )}
                  />
                  <div className="flex flex-col gap-1.5 px-1">
                    {suggestions.map((suggestion) => (
                      <button
                        key={suggestion.key}
                        type="button"
                        disabled={pending || !model}
                        onClick={() => void sendPrompt(t(suggestion.key))}
                        className={cn(
                          "rounded-lg border bg-surface px-3 py-2 text-left text-xs leading-normal text-muted-foreground transition-[background-color,border-color,color] hover:bg-muted hover:text-foreground disabled:opacity-50",
                          CONTROL_INTERACTION_CLASS,
                        )}
                      >
                        {t(suggestion.key)}
                      </button>
                    ))}
                  </div>
                </div>
              ) : (
                log.map((item) => (
                  <LogEntry
                    key={item.id}
                    item={item}
                    onApprove={approve}
                    onDeny={deny}
                    onAnswer={answer}
                  />
                ))
              )}
              {showThinking && <ThinkingStatus />}
              {stepLimitReached && !pending && (
                <ContinueRun onContinue={continueRun} disabled={!model} />
              )}
            </div>
          </div>

          <div className="border-t border-border bg-surface/35 p-3">
            <div className="overflow-hidden rounded-lg border border-input bg-surface transition-[border-color,box-shadow] focus-within:border-ring focus-within:ring-2 focus-within:ring-ring/30">
              <Textarea
                ref={inputRef}
                rows={1}
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && !e.shiftKey) {
                    e.preventDefault();
                    void submit();
                  }
                }}
                placeholder={t("ai.inputPlaceholder")}
                className="max-h-40 min-h-0 resize-none rounded-none border-0 bg-transparent py-2.5 focus-visible:ring-0"
              />
              <div className="flex items-center gap-1.5 border-t border-input px-1.5 py-1.5">
                <Select
                  value={model}
                  onChange={(e) => changeModel(e.target.value)}
                  className="h-7 max-w-[10.5rem] border-0 bg-transparent pl-2 pr-7 text-xs hover:bg-accent focus-visible:ring-0"
                  title={t("ai.modelLabel")}
                >
                  {models.length === 0 ? (
                    <option value="">{t("ai.modelLoading")}</option>
                  ) : (
                    models.map((m) => (
                      <option key={m} value={m}>
                        {m}
                      </option>
                    ))
                  )}
                </Select>
                <div className="ml-auto flex items-center gap-1.5">
                  <ContextMeter
                    tokens={runtime?.contextTokens ?? null}
                    window={runtime?.contextWindow ?? null}
                  />
                  {pending ? (
                    <Tooltip content={t("ai.stop")}>
                      <Button
                        size="icon"
                        variant="secondary"
                        className="size-7 shrink-0"
                        onClick={() => activeId && stop(activeId)}
                      >
                        <Square className="size-3.5 fill-current" />
                      </Button>
                    </Tooltip>
                  ) : (
                    <Button
                      size="icon"
                      className="size-7 shrink-0"
                      aria-label={t("ai.send")}
                      disabled={!input.trim() || !model}
                      onClick={() => void submit()}
                    >
                      <ArrowUp className="size-4" />
                    </Button>
                  )}
                </div>
              </div>
            </div>
          </div>
        </>
      )}
    </aside>
  );
}

function ThinkingStatus() {
  const { t } = useI18n();

  return (
    <div
      className="text-xs text-muted-foreground"
      role="status"
      aria-live="polite"
    >
      <span className="ai-thinking-shimmer">{t("ai.thinking")}</span>
    </div>
  );
}

function ContinueRun({
  onContinue,
  disabled,
}: {
  onContinue: () => void;
  disabled: boolean;
}) {
  const { t } = useI18n();

  return (
    <div className="flex items-center justify-between gap-3 rounded-lg border border-border bg-card px-3 py-2">
      <span className="min-w-0 truncate text-xs text-muted-foreground">
        {t("ai.stepLimitReached")}
      </span>
      <Button
        size="sm"
        variant="secondary"
        className="h-7 shrink-0"
        disabled={disabled}
        onClick={onContinue}
      >
        {t("ai.continueRun")}
      </Button>
    </div>
  );
}

function formatTokens(count: number): string {
  if (count < 1000) return String(count);
  return `${(count / 1000).toFixed(count < 10_000 ? 1 : 0)}k`;
}

function ContextMeter({
  tokens,
  window,
}: {
  tokens: number | null;
  window: number | null;
}) {
  const { t } = useI18n();
  if (tokens === null || !window || window <= 0) return null;

  const percent = Math.min(100, Math.round((tokens / window) * 100));
  return (
    <Tooltip
      content={t("ai.contextUsage", {
        percent,
        used: formatTokens(tokens),
        total: formatTokens(window),
      })}
    >
      <span
        className={cn(
          "shrink-0 cursor-default select-none tabular-nums text-2xs font-medium",
          percent >= 90
            ? "text-danger"
            : percent >= 75
              ? "text-warning"
              : "text-muted-foreground",
        )}
      >
        {percent}%
      </span>
    </Tooltip>
  );
}

function LogEntry({
  item,
  onApprove,
  onDeny,
  onAnswer,
}: {
  item: AgentLogItem;
  onApprove: (id: string) => void;
  onDeny: (id: string) => void;
  onAnswer: (id: string, option: string) => void;
}) {
  if (item.kind === "tool") {
    if (
      item.name === "ask_user" &&
      askUserQuestion(item.args) &&
      askUserOptions(item.args).length >= 2
    ) {
      return <QuestionPrompt item={item} onAnswer={onAnswer} />;
    }
    return <ToolActivity item={item} onApprove={onApprove} onDeny={onDeny} />;
  }
  return <Bubble role={item.kind} content={item.content} />;
}

function Bubble({
  role,
  content,
}: {
  role: "user" | "assistant";
  content: string;
}) {
  if (role === "user") {
    return (
      <div className="ml-auto max-w-[92%] rounded-xl rounded-br-sm border border-primary/15 bg-primary/12 px-3 py-2">
        <p className="select-text whitespace-pre-wrap break-words text-sm">
          {content}
        </p>
      </div>
    );
  }
  return (
    <div className="min-w-0 select-text space-y-2 px-0.5">
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={MARKDOWN_COMPONENTS}
      >
        {content}
      </ReactMarkdown>
    </div>
  );
}

function nodeText(node: unknown): string {
  if (!node || typeof node !== "object") return "";
  if ("value" in node && typeof node.value === "string") return node.value;
  if ("children" in node && Array.isArray(node.children)) {
    return node.children.map(nodeText).join("");
  }
  return "";
}

const MARKDOWN_COMPONENTS: Components = {
  p: ({ node: _node, ...props }) => (
    <p
      className="whitespace-pre-wrap break-words text-sm text-foreground/90"
      {...props}
    />
  ),
  a: ({ node: _node, href, ...props }) => (
    <a
      href={href}
      className="text-link underline underline-offset-2 hover:opacity-80"
      onClick={(e) => {
        e.preventDefault();
        if (href) void openUrl(href);
      }}
      {...props}
    />
  ),
  ul: ({ node: _node, ...props }) => (
    <ul
      className="list-disc space-y-1 pl-5 text-sm text-foreground/90"
      {...props}
    />
  ),
  ol: ({ node: _node, ...props }) => (
    <ol
      className="list-decimal space-y-1 pl-5 text-sm text-foreground/90"
      {...props}
    />
  ),
  li: ({ node: _node, ...props }) => (
    <li className="leading-relaxed" {...props} />
  ),
  h1: ({ node: _node, ...props }) => (
    <h1 className="mt-2 text-base font-semibold first:mt-0" {...props} />
  ),
  h2: ({ node: _node, ...props }) => (
    <h2 className="mt-2 text-[0.95rem] font-semibold first:mt-0" {...props} />
  ),
  h3: ({ node: _node, ...props }) => (
    <h3 className="mt-2 text-sm font-semibold first:mt-0" {...props} />
  ),
  h4: ({ node: _node, ...props }) => (
    <h4 className="mt-2 text-sm font-semibold first:mt-0" {...props} />
  ),
  h5: ({ node: _node, ...props }) => (
    <h5 className="mt-2 text-sm font-semibold first:mt-0" {...props} />
  ),
  h6: ({ node: _node, ...props }) => (
    <h6 className="mt-2 text-sm font-semibold first:mt-0" {...props} />
  ),
  blockquote: ({ node: _node, ...props }) => (
    <blockquote
      className="border-l-2 border-border pl-3 text-sm italic text-muted-foreground"
      {...props}
    />
  ),
  hr: ({ node: _node, ...props }) => (
    <hr className="my-2 border-border" {...props} />
  ),
  table: ({ node: _node, ...props }) => (
    <div className="overflow-x-auto">
      <table className="w-full border-collapse text-xs" {...props} />
    </div>
  ),
  th: ({ node: _node, ...props }) => (
    <th
      className="border border-input px-2 py-1 text-left font-medium"
      {...props}
    />
  ),
  td: ({ node: _node, ...props }) => (
    <td className="border border-input px-2 py-1" {...props} />
  ),
  code: ({ node: _node, className: _className, ...props }) => (
    <code
      className="rounded bg-muted px-1 py-0.5 font-mono text-[0.8em] text-foreground/90"
      {...props}
    />
  ),
  pre: ({ node }) => (
    <CodeBlock code={nodeText(node?.children?.[0]).replace(/\n$/, "")} />
  ),
};

function CodeBlock({ code }: { code: string }) {
  const { t } = useI18n();
  const [copied, setCopied] = useState(false);
  const sendToTerminal = useTabsStore((s) => s.sendToTerminal);

  const copy = async () => {
    await navigator.clipboard.writeText(code);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };

  const run = () => {
    const result = sendToTerminal(code);
    if (result === "sent") {
      toast.success(t("snippets.sent"));
    } else {
      toast.error(
        t(
          result === "not-connected"
            ? "snippets.notConnected"
            : "snippets.noTerminal",
        ),
      );
    }
  };

  return (
    <div className="overflow-hidden rounded-lg border border-border bg-terminal-background">
      <div className="flex items-center justify-between border-b border-border px-2 py-1">
        <span className="text-2xs font-medium uppercase tracking-wide text-muted-foreground">
          {t("ai.commandLabel")}
        </span>
        <div className="flex gap-1">
          <Tooltip content={t("snippets.run")}>
            <Button
              size="icon"
              variant="ghost"
              className="size-6"
              onClick={run}
            >
              <TerminalIcon className="size-3.5" />
            </Button>
          </Tooltip>
          <Tooltip content={copied ? t("common.copied") : t("common.copy")}>
            <Button
              size="icon"
              variant="ghost"
              className="size-6"
              onClick={copy}
            >
              {copied ? (
                <Check className="size-3.5 text-success" />
              ) : (
                <Copy className="size-3.5" />
              )}
            </Button>
          </Tooltip>
        </div>
      </div>
      <pre className="select-text overflow-x-auto p-2.5 font-mono text-xs leading-relaxed text-terminal-foreground">
        {code}
      </pre>
    </div>
  );
}
