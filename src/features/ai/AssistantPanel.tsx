import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
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
  ConfirmDialog,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  EmptyState,
  INTERACTIVE_FOCUS_CLASS,
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
import { safeExternalUrl } from "./links";
import { shouldSubmitPrompt } from "./input";
import { useAiStore } from "./store";
import { MAX_AI_PROMPT_CHARS, type AgentLogItem } from "./transcript";
import { askUserOptions, askUserQuestion } from "./tools";
import { resolveEnabledToolNames } from "./tools/registry";
import { QuestionPrompt, ToolActivity } from "./ToolActivity";

const EMPTY_LOG: AgentLogItem[] = [];
const STICK_TO_BOTTOM_THRESHOLD = 32;
const SUGGESTIONS = [
  "ai.suggestion.terminalOutput",
  "ai.suggestion.resourceUsage",
  "ai.suggestion.systemLogs",
] as const;

export function AssistantPanel({ width }: { width: number }) {
  const { t } = useI18n();
  const { data: config } = useAiConfig();
  const setModel = useSetAiModel();
  const configured = Boolean(config?.baseUrl.trim());
  const {
    data: fetchedModels,
    error: modelsError,
    isLoading: modelsLoading,
  } = useAiModels(configured);
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
  const startNewChat = useAiStore((s) => s.startNewChat);
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
  const [deletingSession, setDeletingSession] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);
  const logContentRef = useRef<HTMLDivElement>(null);
  const stickToBottom = useRef(true);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const compositionActive = useRef(false);
  const enabledToolList = resolveEnabledToolNames(config?.enabledTools);
  const sessionLoading = Boolean(activeId && !runtime);

  const onLogScroll = () => {
    const el = scrollRef.current;
    if (!el) return;
    stickToBottom.current =
      el.scrollHeight - el.scrollTop - el.clientHeight <=
      STICK_TO_BOTTOM_THRESHOLD;
  };

  const scrollLogToBottom = useCallback(() => {
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, []);

  useEffect(() => {
    if (configured) void loadSessions();
  }, [configured, loadSessions]);

  useEffect(() => {
    if (configured && modelsError)
      toast.error(t("ai.error"), errorMessage(modelsError));
  }, [configured, modelsError, t]);

  const models = [
    ...new Set([config?.model, ...(fetchedModels ?? [])].filter(Boolean)),
  ] as string[];

  const model = config?.model || models[0] || "";

  const changeModel = (next: string) => {
    setModel.mutate(next, {
      onError: (err) => toast.error(t("ai.error"), errorMessage(err)),
    });
  };

  const startChat = () => {
    startNewChat();
    inputRef.current?.focus();
  };

  useLayoutEffect(() => {
    stickToBottom.current = true;
    scrollLogToBottom();
  }, [activeId, scrollLogToBottom]);

  useLayoutEffect(() => {
    if (!stickToBottom.current) return;
    scrollLogToBottom();
  }, [log, pending, scrollLogToBottom]);

  useEffect(() => {
    const scrollArea = scrollRef.current;
    const logContent = logContentRef.current;
    if (!scrollArea || !logContent) return;
    const observer = new ResizeObserver(() => {
      if (stickToBottom.current) scrollLogToBottom();
    });
    observer.observe(scrollArea);
    observer.observe(logContent);
    return () => observer.disconnect();
  }, [configured, scrollLogToBottom]);

  useLayoutEffect(() => {
    const el = inputRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${el.scrollHeight}px`;
    if (stickToBottom.current) scrollLogToBottom();
  }, [input, scrollLogToBottom]);

  const sendPrompt = async (prompt: string): Promise<boolean> => {
    if (!prompt || pending || !model || sessionLoading) return false;
    if (prompt.length > MAX_AI_PROMPT_CHARS) {
      toast.error(t("ai.error"), t("ai.promptTooLong"));
      return false;
    }
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
                    aria-label={t("ai.newChat")}
                    onClick={startChat}
                  >
                    <MessageCirclePlus className="size-4" />
                  </Button>
                </Tooltip>
                <DropdownMenu>
                  <Tooltip content={t("ai.history")}>
                    <DropdownMenuTrigger asChild>
                      <Button
                        size="icon"
                        variant="ghost"
                        className={PANEL_HEADER_ACTION_CLASS}
                        aria-label={t("ai.history")}
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
                            aria-label={t("ai.deleteChat")}
                            className="rounded p-1 text-muted-foreground hover:bg-accent hover:text-danger"
                            onClick={(e) => {
                              e.stopPropagation();
                              setDeleteTargetId(s.id);
                            }}
                          >
                            <Trash2 className="size-3.5" />
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
                aria-label={t("ai.hidePanel")}
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
            className="min-w-0 flex-1 overflow-x-hidden overflow-y-auto"
          >
            <div
              ref={logContentRef}
              className="flex min-h-full min-w-0 max-w-full flex-col gap-[var(--content-gap)] px-3 py-4"
            >
              {sessionLoading ? (
                <div
                  className="my-auto text-center text-xs text-muted-foreground"
                  role="status"
                  aria-live="polite"
                >
                  {t("common.loading")}
                </div>
              ) : log.length === 0 ? (
                <div className="my-auto w-full max-w-md self-center py-8">
                  <div className="mb-2 flex items-center gap-1.5 px-1 text-muted-foreground">
                    <Sparkles className="size-3.5" strokeWidth={1.8} />
                    <h3 className="text-xs font-medium">
                      {t("ai.empty.title")}
                    </h3>
                  </div>
                  <div className="ui-divided-list">
                    {SUGGESTIONS.map((suggestion) => (
                      <button
                        key={suggestion}
                        type="button"
                        disabled={pending || !model || sessionLoading}
                        onClick={() => void sendPrompt(t(suggestion))}
                        className={cn(
                          "ui-list-row group flex w-full items-center text-left text-xs leading-normal text-foreground/75 transition-colors hover:bg-list-hover hover:text-foreground disabled:opacity-50",
                          INTERACTIVE_FOCUS_CLASS,
                        )}
                      >
                        <span className="min-w-0 flex-1">{t(suggestion)}</span>
                        <ArrowUp className="size-3.5 shrink-0 opacity-40 transition-opacity group-hover:opacity-80" />
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

          <div className="shrink-0 px-3 pb-3 pt-2">
            <div className="overflow-hidden rounded-lg border border-border-strong bg-surface-raised transition-colors focus-within:border-ring focus-within:ring-2 focus-within:ring-ring/35">
              <Textarea
                ref={inputRef}
                rows={1}
                value={input}
                maxLength={MAX_AI_PROMPT_CHARS}
                disabled={sessionLoading}
                onChange={(e) => setInput(e.target.value)}
                onCompositionStart={() => {
                  compositionActive.current = true;
                }}
                onCompositionEnd={() => {
                  compositionActive.current = false;
                }}
                onKeyDown={(e) => {
                  if (
                    shouldSubmitPrompt(e.nativeEvent, compositionActive.current)
                  ) {
                    e.preventDefault();
                    void submit();
                  }
                }}
                placeholder={t("ai.inputPlaceholder")}
                className="max-h-40 min-h-0 resize-none rounded-none border-0 bg-transparent px-3 pb-1.5 pt-2.5 focus-visible:ring-0"
              />
              <div className="flex items-center gap-1.5 px-1.5 pb-1.5 pt-1">
                <Select
                  value={model}
                  onValueChange={changeModel}
                  options={models.map((item) => ({
                    value: item,
                    label: item,
                  }))}
                  placeholder={
                    modelsLoading
                      ? t("ai.modelLoading")
                      : models.length === 0
                        ? t("ai.modelEmpty")
                        : undefined
                  }
                  title={t("ai.modelLabel")}
                  disabled={models.length === 0}
                  showChevron={false}
                  className="h-[var(--toolbar-control-size)] w-auto min-w-0 max-w-[70%] border-0 bg-transparent px-2 text-xs hover:bg-accent focus-visible:ring-0"
                />
                <div className="ml-auto flex items-center gap-1.5">
                  {pending ? (
                    <Tooltip content={t("ai.stop")}>
                      <Button
                        size="icon"
                        variant="secondary"
                        className="size-[var(--toolbar-control-size)] shrink-0"
                        aria-label={t("ai.stop")}
                        onClick={() => activeId && stop(activeId)}
                      >
                        <Square className="size-3.5 fill-current" />
                      </Button>
                    </Tooltip>
                  ) : (
                    <Button
                      size="icon"
                      className="size-[var(--toolbar-control-size)] shrink-0"
                      aria-label={t("ai.send")}
                      disabled={!input.trim() || !model || sessionLoading}
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
      <ConfirmDialog
        state={
          deleteTargetId
            ? {
                title: t("ai.deleteChatTitle"),
                description: t("common.deleteConfirm", {
                  name:
                    sessions.find((session) => session.id === deleteTargetId)
                      ?.title || t("ai.untitledChat"),
                }),
                cancelLabel: t("common.cancel"),
                actions: [
                  {
                    label: t("ai.deleteChat"),
                    variant: "destructive",
                    loading: deletingSession,
                    onSelect: async () => {
                      setDeletingSession(true);
                      try {
                        await deleteSession(deleteTargetId);
                      } finally {
                        setDeletingSession(false);
                      }
                    },
                  },
                ],
              }
            : null
        }
        onClose={() => setDeleteTargetId(null)}
      />
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
    <div className="ui-muted-panel flex items-center justify-between gap-3 px-2.5 py-2">
      <span className="min-w-0 truncate text-xs text-muted-foreground">
        {t("ai.stepLimitReached")}
      </span>
      <Button
        size="sm"
        variant="secondary"
        className="h-[var(--toolbar-control-size)] shrink-0"
        disabled={disabled}
        onClick={onContinue}
      >
        {t("ai.continueRun")}
      </Button>
    </div>
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
      <div className="ml-auto max-w-[88%] rounded-lg rounded-br-sm border border-border-subtle bg-muted px-3 py-2">
        <p className="select-text whitespace-pre-wrap break-words text-sm text-foreground/90">
          {content}
        </p>
      </div>
    );
  }
  return (
    <div className="min-w-0 max-w-full select-text space-y-2 px-0.5">
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
      {...props}
      onClick={(e) => {
        e.preventDefault();
        const safeUrl = href ? safeExternalUrl(href) : null;
        if (safeUrl) void openUrl(safeUrl).catch(() => {});
      }}
    />
  ),
  img: ({ node: _node, alt }) => (
    <span className="text-sm text-muted-foreground">
      {alt ? `[Image: ${alt}]` : "[Image]"}
    </span>
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
      className="break-all rounded bg-muted px-1 py-0.5 font-mono text-[0.8em] text-foreground/90"
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
  const copiedTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const sendToTerminal = useTabsStore((s) => s.sendToTerminal);

  useEffect(
    () => () => {
      if (copiedTimerRef.current) clearTimeout(copiedTimerRef.current);
    },
    [],
  );

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(code);
      setCopied(true);
      if (copiedTimerRef.current) clearTimeout(copiedTimerRef.current);
      copiedTimerRef.current = setTimeout(() => setCopied(false), 1500);
    } catch (err) {
      toast.error(t("ai.error"), errorMessage(err));
    }
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
    <div className="overflow-hidden rounded-lg border border-border-subtle bg-terminal-background">
      <div className="flex items-center justify-between border-b border-border px-2 py-1">
        <span className="text-2xs font-medium text-muted-foreground">
          {t("ai.commandLabel")}
        </span>
        <div className="flex gap-1">
          <Tooltip content={t("snippets.run")}>
            <Button
              size="icon"
              variant="ghost"
              className="size-[var(--compact-control-size)]"
              aria-label={t("snippets.run")}
              onClick={run}
            >
              <TerminalIcon className="size-3.5" />
            </Button>
          </Tooltip>
          <Tooltip content={copied ? t("common.copied") : t("common.copy")}>
            <Button
              size="icon"
              variant="ghost"
              className="size-[var(--compact-control-size)]"
              aria-label={copied ? t("common.copied") : t("common.copy")}
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
