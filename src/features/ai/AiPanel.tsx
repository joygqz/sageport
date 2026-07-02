import { useEffect, useRef, useState } from "react";
import {
  ArrowUp,
  Bot,
  Check,
  Copy,
  History,
  KeyRound,
  Pencil,
  SquarePen,
  Terminal as TerminalIcon,
  Trash2,
  User,
  X,
} from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { EmptyState } from "@/components/ui/empty-state";
import { Input } from "@/components/ui/input";
import { ResizeHandle } from "@/components/ui/resize-handle";
import { Select } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { Tooltip } from "@/components/ui/tooltip";
import { useI18n } from "@/i18n";
import { ipc } from "@/lib/ipc";
import { toast } from "@/lib/toast";
import { cn } from "@/lib/utils";
import { useSessionStore } from "@/features/terminal/sessionStore";
import type { AiSessionSummary } from "@/types/models";
import { useAiConfig, useAiModels, useSetAiModel } from "./api";
import { useAiStore, type AgentLogItem } from "./store";
import { ToolActivity } from "./ToolActivity";

const MIN_WIDTH = 280;
const MAX_WIDTH = 640;
const clampWidth = (w: number) => Math.max(MIN_WIDTH, Math.min(w, MAX_WIDTH));
/** Stable reference so an inactive/unloaded session doesn't churn effect deps. */
const EMPTY_LOG: AgentLogItem[] = [];

/** Split assistant text into plain-text and fenced-code segments. */
function parseSegments(text: string) {
  const segments: { type: "text" | "code"; content: string }[] = [];
  const regex = /```(?:[\w-]*)\n?([\s\S]*?)```/g;
  let last = 0;
  let match: RegExpExecArray | null;
  while ((match = regex.exec(text)) !== null) {
    if (match.index > last) {
      segments.push({ type: "text", content: text.slice(last, match.index) });
    }
    segments.push({ type: "code", content: match[1].trimEnd() });
    last = regex.lastIndex;
  }
  if (last < text.length) {
    segments.push({ type: "text", content: text.slice(last) });
  }
  return segments;
}

export function AiPanel({
  onClose,
  onOpenSettings,
}: {
  onClose: () => void;
  onOpenSettings: () => void;
}) {
  const { t } = useI18n();
  const { data: config } = useAiConfig();
  const setModel = useSetAiModel();
  const configured = !!config?.hasApiKey;
  const { data: fetchedModels } = useAiModels(configured);

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
  const approve = useAiStore((s) => s.approve);
  const deny = useAiStore((s) => s.deny);

  const log = runtime?.log ?? EMPTY_LOG;
  const pending = runtime?.pending ?? false;

  const [input, setInput] = useState("");
  const [modelOverride, setModelOverride] = useState<string | null>(null);
  const [width, setWidth] = useState(384);
  const [renameTarget, setRenameTarget] = useState<AiSessionSummary | null>(
    null,
  );
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (configured) void loadSessions();
  }, [configured, loadSessions]);

  // The saved model plus every model the provider reports, de-duplicated.
  const models = [
    ...new Set([config?.model, ...(fetchedModels ?? [])].filter(Boolean)),
  ] as string[];
  // The user's in-session pick wins; otherwise fall back to the saved model,
  // then the first one the provider reports.
  const model = modelOverride ?? config?.model ?? models[0] ?? "";

  const changeModel = (next: string) => {
    setModelOverride(next);
    setModel.mutate(next);
  };

  useEffect(() => {
    requestAnimationFrame(() =>
      scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight }),
    );
  }, [log, pending]);

  const submit = async () => {
    const prompt = input.trim();
    if (!prompt || pending || !model) return;
    setInput("");
    const sessionId = activeId ?? (await newSession());
    void send(sessionId, prompt, model);
  };

  const activeTitle = sessions.find((s) => s.id === activeId)?.title;

  return (
    <>
      <ResizeHandle
        axis="x"
        size={width}
        reverse
        onResize={(w) => setWidth(clampWidth(w))}
      />
      <aside style={{ width }} className="flex shrink-0 flex-col bg-surface">
        <div className="flex h-9 items-center gap-1 border-b border-border px-2">
          <Bot className="size-4 shrink-0 text-primary" />
          <span className="min-w-0 flex-1 truncate text-sm font-semibold">
            {activeId ? activeTitle || t("ai.untitledChat") : t("ai.assistant")}
          </span>
          {configured && (
            <>
              <Tooltip content={t("ai.newChat")}>
                <Button
                  size="icon"
                  variant="ghost"
                  className="size-7 shrink-0"
                  onClick={() => void newSession()}
                >
                  <SquarePen className="size-4" />
                </Button>
              </Tooltip>
              <DropdownMenu>
                <Tooltip content={t("ai.history")}>
                  <DropdownMenuTrigger asChild>
                    <Button
                      size="icon"
                      variant="ghost"
                      className="size-7 shrink-0"
                    >
                      <History className="size-4" />
                    </Button>
                  </DropdownMenuTrigger>
                </Tooltip>
                <DropdownMenuContent align="end" className="w-64">
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
                          className="rounded p-1 text-muted-foreground hover:bg-accent hover:text-destructive"
                          onClick={(e) => {
                            e.stopPropagation();
                            void deleteSession(s.id);
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
          <Button
            size="icon"
            variant="ghost"
            className="size-7 shrink-0"
            onClick={onClose}
          >
            <X />
          </Button>
        </div>

        {!configured ? (
          <EmptyState
            className="m-auto"
            icon={KeyRound}
            title={t("ai.connectTitle")}
            description={t("ai.connectDescription")}
            action={
              <Button size="sm" onClick={onOpenSettings}>
                {t("ai.openSettings")}
              </Button>
            }
          />
        ) : (
          <>
            <div ref={scrollRef} className="flex-1 overflow-y-auto">
              <div className="flex flex-col gap-3 p-3">
                {log.length === 0 ? (
                  <EmptyState
                    className="mt-10"
                    icon={Bot}
                    title={t("ai.askTitle")}
                    description={t("ai.askDescription")}
                  />
                ) : (
                  log.map((item) => (
                    <LogEntry
                      key={item.id}
                      item={item}
                      onApprove={approve}
                      onDeny={deny}
                    />
                  ))
                )}
                {pending && (
                  <div className="flex items-center gap-2 text-xs text-muted-foreground">
                    <Bot className="size-4 animate-pulse text-primary" />
                    {t("ai.thinking")}
                  </div>
                )}
              </div>
            </div>

            <div className="p-2.5">
              <div className="rounded-md border border-input bg-surface shadow-sm transition-colors focus-within:border-ring focus-within:ring-2 focus-within:ring-ring">
                <Textarea
                  value={input}
                  onChange={(e) => setInput(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && !e.shiftKey) {
                      e.preventDefault();
                      submit();
                    }
                  }}
                  placeholder={t("ai.inputPlaceholder")}
                  className="max-h-40 min-h-16 resize-none border-0 shadow-none focus-visible:ring-0"
                />
                <div className="flex items-center gap-1.5 px-1.5 pb-1.5">
                  <Select
                    value={model}
                    onChange={(e) => changeModel(e.target.value)}
                    className="h-7 max-w-[10.5rem] border-0 bg-transparent text-xs shadow-none hover:bg-accent"
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
                  <Button
                    size="icon"
                    className="ml-auto size-7 shrink-0"
                    disabled={!input.trim() || pending || !model}
                    onClick={() => void submit()}
                  >
                    <ArrowUp className="size-4" />
                  </Button>
                </div>
              </div>
            </div>
          </>
        )}
      </aside>
      <RenameSessionDialog
        session={renameTarget}
        onClose={() => setRenameTarget(null)}
        onRename={renameSession}
      />
    </>
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
        {/* Mount fresh per open so the field initializes without an effect. */}
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
}: {
  item: AgentLogItem;
  onApprove: (id: string) => void;
  onDeny: (id: string) => void;
}) {
  if (item.kind === "tool") {
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
  const isUser = role === "user";
  return (
    <div className="flex gap-2.5">
      <div
        className={cn(
          "flex size-6 shrink-0 items-center justify-center rounded-full",
          isUser ? "bg-secondary" : "bg-primary/15 text-primary",
        )}
      >
        {isUser ? <User className="size-3.5" /> : <Bot className="size-3.5" />}
      </div>
      <div className="min-w-0 flex-1 space-y-2 pt-0.5">
        {isUser ? (
          <p className="whitespace-pre-wrap break-words text-sm">{content}</p>
        ) : (
          parseSegments(content).map((seg, i) =>
            seg.type === "code" ? (
              <CodeBlock key={i} code={seg.content} />
            ) : (
              <p
                key={i}
                className="whitespace-pre-wrap break-words text-sm text-foreground/90"
              >
                {seg.content.trim()}
              </p>
            ),
          )
        )}
      </div>
    </div>
  );
}

function CodeBlock({ code }: { code: string }) {
  const { t } = useI18n();
  const [copied, setCopied] = useState(false);
  const activeId = useSessionStore((s) => s.activeId);

  const copy = async () => {
    await navigator.clipboard.writeText(code);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };

  const run = () => {
    if (!activeId) {
      toast.error(t("common.noActiveTerminalTitle"));
      return;
    }
    void ipc.ssh.send(activeId, code + "\n").catch(() => {});
  };

  return (
    <div className="overflow-hidden rounded-md border border-border bg-terminal-background">
      <div className="flex items-center justify-between border-b border-border px-2 py-1">
        <span className="text-[0.65rem] font-medium uppercase tracking-wide text-muted-foreground">
          {t("ai.commandLabel")}
        </span>
        <div className="flex gap-1">
          <Tooltip content={t("common.runInTerminal")}>
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
