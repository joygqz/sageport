import { useEffect, useRef, useState } from "react";
import {
  ArrowDown,
  ArrowUp,
  Loader2,
  PlugZap,
  ServerCrash,
  X,
} from "lucide-react";

import { Button, Input } from "@/components/ui";
import { useI18n } from "@/i18n";
import { useTabsStore, type TerminalTab } from "@/workbench/tabs";
import { focusTerminal, getTerminal } from "./registry";
import { useTerminalSearch } from "./search";
import { TerminalView } from "./TerminalView";

/**
 * One terminal editor: the xterm canvas inside a gutter painted with the
 * terminal background (so the padding is invisible), plus a find bar and a
 * full-pane overlay for the non-interactive states (connecting / error /
 * closed).
 */
export function TerminalEditor({
  tab,
  active,
}: {
  tab: TerminalTab;
  active: boolean;
}) {
  const reconnect = useTabsStore((s) => s.reconnectTerminal);
  const searchOpen = useTerminalSearch((s) => s.openFor === tab.id);

  return (
    <div className="relative h-full w-full bg-terminal-background p-2">
      <TerminalView
        sessionId={tab.id}
        hostId={tab.hostId}
        attempt={tab.attempt}
      />
      {searchOpen && active && <SearchBar sessionId={tab.id} />}
      <StatusOverlay tab={tab} onReconnect={() => reconnect(tab.id)} />
    </div>
  );
}

/** Match highlight colors, aligned with VSCode's find decorations. */
const SEARCH_DECORATIONS = {
  matchBackground: "#ea5c0055",
  matchOverviewRuler: "#d18616",
  activeMatchBackground: "#515c6a",
  activeMatchColorOverviewRuler: "#a0a0a0",
};

/**
 * VSCode-style find bar floating over the terminal's top-right corner.
 * Typing searches incrementally; Enter / shift+Enter step through matches;
 * Escape returns focus to the shell.
 */
function SearchBar({ sessionId }: { sessionId: string }) {
  const { t } = useI18n();
  const close = useTerminalSearch((s) => s.close);
  const [query, setQuery] = useState("");
  const [result, setResult] = useState<{ index: number; count: number }>();
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const search = getTerminal(sessionId)?.search;
    if (!search) return;
    const sub = search.onDidChangeResults((e) =>
      setResult({ index: e.resultIndex, count: e.resultCount }),
    );
    return () => sub.dispose();
  }, [sessionId]);

  const find = (text: string, direction: "next" | "previous") => {
    const search = getTerminal(sessionId)?.search;
    if (!search || !text) return;
    const options = { decorations: SEARCH_DECORATIONS };
    if (direction === "next") search.findNext(text, options);
    else search.findPrevious(text, options);
  };

  const dismiss = () => {
    getTerminal(sessionId)?.search.clearDecorations();
    close();
    focusTerminal(sessionId);
  };

  return (
    <div className="absolute right-4 top-3 z-20 flex items-center gap-1 rounded-md border border-border bg-popover p-1 shadow-md">
      <Input
        ref={inputRef}
        autoFocus
        value={query}
        placeholder={t("terminal.search.placeholder")}
        onChange={(e) => {
          setQuery(e.target.value);
          find(e.target.value, "next");
        }}
        onKeyDown={(e) => {
          if (e.key === "Enter") find(query, e.shiftKey ? "previous" : "next");
          if (e.key === "Escape") dismiss();
        }}
        className="h-6 w-44 border-0 bg-transparent text-xs focus-visible:ring-0"
      />
      <span className="min-w-10 text-center text-2xs tabular-nums text-muted-foreground">
        {query && result
          ? result.count > 0
            ? `${result.index + 1}/${result.count}`
            : t("terminal.search.noResults")
          : ""}
      </span>
      <Button
        size="icon"
        variant="ghost"
        className="size-6"
        disabled={!query}
        onClick={() => find(query, "previous")}
        aria-label={t("terminal.search.previous")}
      >
        <ArrowUp className="size-3.5" />
      </Button>
      <Button
        size="icon"
        variant="ghost"
        className="size-6"
        disabled={!query}
        onClick={() => find(query, "next")}
        aria-label={t("terminal.search.next")}
      >
        <ArrowDown className="size-3.5" />
      </Button>
      <Button
        size="icon"
        variant="ghost"
        className="size-6"
        onClick={dismiss}
        aria-label={t("terminal.search.close")}
      >
        <X className="size-3.5" />
      </Button>
    </div>
  );
}

/**
 * Overlays the terminal while it has no live connection. Rendering status
 * here instead of writing lines into the terminal buffer keeps the
 * scrollback clean and always offers a recovery action.
 */
function StatusOverlay({
  tab,
  onReconnect,
}: {
  tab: TerminalTab;
  onReconnect: () => void;
}) {
  const { t } = useI18n();

  if (tab.status === "connecting") {
    return (
      <Shell>
        <Loader2 className="size-7 animate-spin text-primary" />
        <p className="text-sm font-medium text-foreground">
          {t("terminal.connecting", { host: tab.title })}
        </p>
      </Shell>
    );
  }

  if (tab.status === "error") {
    return (
      <Shell>
        <span className="flex size-12 items-center justify-center rounded-full bg-destructive/10 text-destructive">
          <ServerCrash className="size-6" />
        </span>
        <p className="text-sm font-semibold text-foreground">
          {t("terminal.connectFailed")}
        </p>
        {tab.error && (
          <p className="max-w-md select-text break-words text-center font-mono text-xs leading-relaxed text-destructive">
            {tab.error}
          </p>
        )}
        <Button size="sm" variant="outline" onClick={onReconnect}>
          {t("terminal.reconnect")}
        </Button>
      </Shell>
    );
  }

  if (tab.status === "closed") {
    return (
      <Shell>
        <span className="flex size-12 items-center justify-center rounded-full bg-muted text-muted-foreground">
          <PlugZap className="size-6" />
        </span>
        <p className="text-sm font-medium text-foreground">
          {t("terminal.closed")}
        </p>
        <Button size="sm" variant="outline" onClick={onReconnect}>
          {t("terminal.reconnect")}
        </Button>
      </Shell>
    );
  }

  return null;
}

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <div className="absolute inset-0 z-10 flex flex-col items-center justify-center gap-3 bg-background/85 backdrop-blur-sm">
      {children}
    </div>
  );
}
