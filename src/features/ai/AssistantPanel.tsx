import { useEffect, useRef, useState } from "react";
import {
  ArrowUp,
  Check,
  Copy,
  History,
  KeyRound,
  Pencil,
  Sparkles,
  Square,
  SquarePen,
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
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  EmptyState,
  Input,
  Select,
  Textarea,
  Tooltip,
  type ConfirmState,
} from "@/components/ui";
import { useI18n } from "@/i18n";
import { toast } from "@/lib/toast";
import { cn } from "@/lib/utils";
import type { AiSessionSummary } from "@/types/models";
import { useLayoutStore } from "@/workbench/layout";
import { useTabsStore } from "@/workbench/tabs";
import { useAiConfig, useAiModels, useSetAiModel } from "./api";
import { useAiStore, type AgentLogItem } from "./store";
import { askUserOptions, askUserQuestion } from "./tools";
import { QuestionPrompt, ToolActivity } from "./ToolActivity";

const EMPTY_LOG: AgentLogItem[] = [];

const SUGGESTION_KEYS = [
  "ai.suggestion.health",
  "ai.suggestion.logs",
  "ai.suggestion.services",
] as const;

export function AssistantPanel({ width }: { width: number }) {
  const { t } = useI18n();
  const { data: config } = useAiConfig();
  const setModel = useSetAiModel();
  const configured = Boolean(config?.apiKey);
  const { data: fetchedModels } = useAiModels(configured);
  const toggleAux = useLayoutStore((s) => s.toggleAux);
  const openSettings = useTabsStore((s) => s.openSettings);

  const sessions = useAiStore((s) => s.sessions);
  const activeId = useAiStore((s) => s.activeId);
  const runtime = useAiStore((s) =>
    s.activeId ? s.runtime[s.activeId] : undefined,
  );
  const loadSessions = useAiStore((s) => s.loadSessions);
  const openSession = useAiStore((s) => s.openSession);
  const newSession = useAiStore((s) => s.newSession);
  const renameSession = useAiStore((s) => s.renameSession);
  const deleteSession = useAiStore((s) => s.deleteSession);
  const send = useAiStore((s) => s.send);
  const stop = useAiStore((s) => s.stop);
  const approve = useAiStore((s) => s.approve);
  const deny = useAiStore((s) => s.deny);
  const answer = useAiStore((s) => s.answer);

  const log = runtime?.log ?? EMPTY_LOG;
  const pending = runtime?.pending ?? false;
  const activity = runtime?.activity ?? null;
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
  const [modelOverride, setModelOverride] = useState<string | null>(null);
  const [renameTarget, setRenameTarget] = useState<AiSessionSummary | null>(
    null,
  );
  const [confirmState, setConfirmState] = useState<ConfirmState | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const stickToBottom = useRef(true);

  const onLogScroll = () => {
    const el = scrollRef.current;
    if (!el) return;
    stickToBottom.current =
      el.scrollHeight - el.scrollTop - el.clientHeight < 4;
  };

  useEffect(() => {
    if (configured) void loadSessions();
  }, [configured, loadSessions]);

  const models = [
    ...new Set([config?.model, ...(fetchedModels ?? [])].filter(Boolean)),
  ] as string[];

  const model = modelOverride ?? config?.model ?? models[0] ?? "";

  const changeModel = (next: string) => {
    setModelOverride(next);
    setModel.mutate(next);
  };

  useEffect(() => {
    stickToBottom.current = true;
  }, [activeId]);

  useEffect(() => {
    if (!stickToBottom.current) return;
    requestAnimationFrame(() => {
      if (!stickToBottom.current) return;
      scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight });
    });
  }, [log, pending]);

  const sendPrompt = async (prompt: string) => {
    if (!prompt || pending || !model) return;
    stickToBottom.current = true;
    const sessionId = activeId ?? (await newSession());
    void send(sessionId, prompt, model);
  };

  const submit = async () => {
    const prompt = input.trim();
    if (!prompt) return;
    setInput("");
    await sendPrompt(prompt);
  };

  const activeTitle = sessions.find((s) => s.id === activeId)?.title;

  const confirmDeleteSession = (session: AiSessionSummary) => {
    setConfirmState({
      title: t("ai.deleteSession.title"),
      description: t("common.deleteConfirm", {
        name: session.title || t("ai.untitledChat"),
      }),
      cancelLabel: t("common.cancel"),
      actions: [
        {
          label: t("common.delete"),
          variant: "destructive",
          onSelect: () => void deleteSession(session.id),
        },
      ],
    });
  };

  return (
    <aside
      style={{ width }}
      className="flex shrink-0 flex-col overflow-hidden bg-surface"
    >
      <div className="flex h-9 shrink-0 items-center justify-between gap-1 pl-4 pr-2">
        <h2 className="min-w-0 truncate text-2xs font-semibold uppercase tracking-wider text-muted-foreground">
          {activeTitle || t("ai.viewTitle")}
        </h2>
        <div className="flex items-center gap-0.5">
          {configured && (
            <>
              <Tooltip content={t("ai.newChat")}>
                <Button
                  size="icon"
                  variant="ghost"
                  className="size-6"
                  onClick={() => void newSession()}
                >
                  <SquarePen className="size-4" />
                </Button>
              </Tooltip>
              <DropdownMenu>
                <Tooltip content={t("ai.history")}>
                  <DropdownMenuTrigger asChild>
                    <Button size="icon" variant="ghost" className="size-6">
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
                        className={cn(
                          "gap-1.5",
                          s.id === activeId && "bg-accent/70",
                        )}
                        onSelect={() => void openSession(s.id)}
                      >
                        <span className="min-w-0 flex-1 truncate">
                          {s.title || t("ai.untitledChat")}
                        </span>
                        <button
                          type="button"
                          className="rounded p-1 text-muted-foreground hover:bg-accent hover:text-foreground"
                          onClick={(e) => {
                            e.stopPropagation();
                            setRenameTarget(s);
                          }}
                        >
                          <Pencil className="size-3.5" />
                        </button>
                        <button
                          type="button"
                          className="rounded p-1 text-muted-foreground hover:bg-accent hover:text-danger"
                          onClick={(e) => {
                            e.stopPropagation();
                            confirmDeleteSession(s);
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
              className="size-6"
              onClick={toggleAux}
            >
              <X className="size-4" />
            </Button>
          </Tooltip>
        </div>
      </div>

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
            <div className="flex flex-col gap-3 p-3">
              {log.length === 0 ? (
                <div className="mt-10 flex flex-col gap-4">
                  <EmptyState
                    icon={Sparkles}
                    title={t("ai.empty.title")}
                    description={t("ai.empty.description")}
                  />
                  <div className="flex flex-col gap-1.5 px-2">
                    {SUGGESTION_KEYS.map((key) => (
                      <button
                        key={key}
                        type="button"
                        disabled={pending || !model}
                        onClick={() => void sendPrompt(t(key))}
                        className="rounded-md border border-input px-3 py-2 text-left text-xs text-muted-foreground transition-colors hover:bg-accent hover:text-foreground disabled:opacity-50"
                      >
                        {t(key)}
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
            </div>
          </div>

          <div className="p-2.5">
            <div className="rounded-md border border-input bg-surface transition-colors focus-within:border-ring focus-within:ring-2 focus-within:ring-ring/30">
              <Textarea
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && !e.shiftKey) {
                    e.preventDefault();
                    void submit();
                  }
                }}
                placeholder={t("ai.inputPlaceholder")}
                className="max-h-40 min-h-16 resize-none border-0 focus-visible:ring-0"
              />
              <div className="flex items-center gap-1.5 px-1.5 pb-1.5">
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
                {pending ? (
                  <Tooltip content={t("ai.stop")}>
                    <Button
                      size="icon"
                      variant="secondary"
                      className="ml-auto size-7 shrink-0"
                      onClick={() => activeId && stop(activeId)}
                    >
                      <Square className="size-3.5 fill-current" />
                    </Button>
                  </Tooltip>
                ) : (
                  <Button
                    size="icon"
                    className="ml-auto size-7 shrink-0"
                    disabled={!input.trim() || !model}
                    onClick={() => void submit()}
                  >
                    <ArrowUp className="size-4" />
                  </Button>
                )}
              </div>
            </div>
          </div>
        </>
      )}

      <RenameSessionDialog
        session={renameTarget}
        onClose={() => setRenameTarget(null)}
        onRename={renameSession}
      />
      <ConfirmDialog
        state={confirmState}
        onClose={() => setConfirmState(null)}
      />
    </aside>
  );
}

function ThinkingStatus() {
  const { t } = useI18n();
  const [elapsedSeconds, setElapsedSeconds] = useState(0);

  useEffect(() => {
    const startedAt = Date.now();
    const timer = window.setInterval(() => {
      setElapsedSeconds(Math.floor((Date.now() - startedAt) / 1000));
    }, 1000);
    return () => window.clearInterval(timer);
  }, []);

  return (
    <div
      className="text-xs text-muted-foreground"
      role="status"
      aria-live="polite"
    >
      <span className="ai-thinking-shimmer">{t("ai.thinking")}</span>
      {elapsedSeconds >= 10 && (
        <span aria-hidden="true">
          {" · "}
          {t("ai.elapsedSeconds", { seconds: elapsedSeconds })}
        </span>
      )}
    </div>
  );
}

function RenameSessionDialog({
  session,
  onClose,
  onRename,
}: {
  session: AiSessionSummary | null;
  onClose: () => void;
  onRename: (id: string, title: string) => void;
}) {
  return (
    <Dialog open={!!session} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-w-sm">
        {session && (
          <RenameSessionForm
            session={session}
            onClose={onClose}
            onRename={onRename}
          />
        )}
      </DialogContent>
    </Dialog>
  );
}

function RenameSessionForm({
  session,
  onClose,
  onRename,
}: {
  session: AiSessionSummary;
  onClose: () => void;
  onRename: (id: string, title: string) => void;
}) {
  const { t } = useI18n();
  const [value, setValue] = useState(session.title);

  const submit = () => {
    const trimmed = value.trim();
    if (!trimmed) return;
    onRename(session.id, trimmed);
    onClose();
  };

  return (
    <>
      <DialogHeader>
        <DialogTitle>{t("ai.renameSession")}</DialogTitle>
      </DialogHeader>
      <Input
        autoFocus
        value={value}
        onChange={(e) => setValue(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") submit();
        }}
      />
      <DialogFooter>
        <Button variant="ghost" onClick={onClose}>
          {t("common.cancel")}
        </Button>
        <Button onClick={submit}>{t("common.save")}</Button>
      </DialogFooter>
    </>
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
      <div className="rounded-lg bg-accent/60 px-3 py-2">
        <p className="select-text whitespace-pre-wrap break-words text-sm">
          {content}
        </p>
      </div>
    );
  }
  return (
    <div className="min-w-0 select-text space-y-2">
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
    if (sendToTerminal(code)) {
      toast.success(t("snippets.sent"));
    } else {
      toast.error(t("snippets.noTerminal"));
    }
  };

  return (
    <div className="overflow-hidden rounded-md border border-input bg-terminal-background">
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
