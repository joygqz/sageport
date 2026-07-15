import {
  Fragment,
  memo,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import { readText, writeText } from "@tauri-apps/plugin-clipboard-manager";
import type { ISearchOptions } from "@xterm/addon-search";
import {
  ArrowDown,
  ArrowUp,
  CaseSensitive,
  ClipboardPaste,
  Copy,
  Eraser,
  Loader2,
  PlugZap,
  Regex,
  ServerCrash,
  SquareDashedMousePointer,
  SquareSplitHorizontal,
  SquareSplitVertical,
  WholeWord,
  X,
} from "lucide-react";

import {
  Button,
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuTrigger,
  FindActionButton,
  FindBar,
  FindCount,
  FindInput,
  FindToggleButton,
  ResizeHandle,
  Tooltip,
} from "@/components/ui";
import { useI18n } from "@/i18n";
import { isValidRegex } from "@/lib/utils";
import { useTheme } from "@/themes";
import { monoFontFamily, useFontStore } from "@/workbench/font";
import type { PaneLayout } from "@/workbench/pane-layout";
import {
  useTabsStore,
  type TerminalPane,
  type TerminalTab,
} from "@/workbench/tabs";
import { terminalFontSize, useZoomStore } from "@/workbench/zoom";
import { useTerminalSearch } from "./search";
import { focusTerminal, getSession } from "./sessions";
import { TerminalView } from "./TerminalView";

async function copyPaneSelection(paneId: string) {
  const term = getSession(paneId)?.term;
  if (!term?.hasSelection()) return;
  await writeText(term.getSelection());
}

async function pastePaneClipboard(paneId: string) {
  const session = getSession(paneId);
  if (!session) return;
  const text = await readText().catch(() => "");
  if (text) session.term.paste(text);
}

function selectPaneAll(paneId: string) {
  getSession(paneId)?.term.selectAll();
}

function clearPaneBuffer(paneId: string) {
  getSession(paneId)?.term.clear();
}

const MIN_PANE_PX = 90;

export function TerminalTabActions({ paneId }: { paneId: string }) {
  const { t } = useI18n();
  const splitPane = useTabsStore((s) => s.splitPane);

  return (
    <>
      <Tooltip content={t("commands.terminal.splitRight")}>
        <button
          type="button"
          onClick={() => splitPane(paneId, "right")}
          className="ml-1 flex size-[var(--toolbar-control-size)] shrink-0 items-center justify-center self-center rounded-lg text-muted-foreground outline-none transition-colors hover:bg-accent hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/35"
        >
          <SquareSplitHorizontal className="size-4" />
        </button>
      </Tooltip>
      <Tooltip content={t("commands.terminal.splitDown")}>
        <button
          type="button"
          onClick={() => splitPane(paneId, "down")}
          className="flex size-[var(--toolbar-control-size)] shrink-0 items-center justify-center self-center rounded-lg text-muted-foreground outline-none transition-colors hover:bg-accent hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/35"
        >
          <SquareSplitVertical className="size-4" />
        </button>
      </Tooltip>
    </>
  );
}

export const TerminalEditor = memo(function TerminalEditor({
  tab,
  active,
}: {
  tab: TerminalTab;
  active: boolean;
}) {
  useLayoutEffect(() => {
    if (!active) return;
    for (const pane of tab.panes) getSession(pane.id)?.refit();
  }, [active, tab.panes]);

  return (
    <div className="h-full w-full bg-terminal-background">
      <LayoutNode node={tab.layout} tab={tab} active={active} />
    </div>
  );
});

function LayoutNode({
  node,
  tab,
  active,
}: {
  node: PaneLayout;
  tab: TerminalTab;
  active: boolean;
}) {
  if (node.type === "leaf") {
    const pane = tab.panes.find((item) => item.id === node.paneId);
    if (!pane) return null;
    return <PaneView pane={pane} tab={tab} active={active} />;
  }
  return <SplitView node={node} tab={tab} active={active} />;
}

function SplitView({
  node,
  tab,
  active,
}: {
  node: Extract<PaneLayout, { type: "split" }>;
  tab: TerminalTab;
  active: boolean;
}) {
  const resizePanes = useTabsStore((s) => s.resizePanes);
  const containerRef = useRef<HTMLDivElement>(null);
  const childRefs = useRef<(HTMLDivElement | null)[]>([]);
  const horizontal = node.direction === "row";

  const measure = (el: HTMLDivElement | null) =>
    el ? (horizontal ? el.offsetWidth : el.offsetHeight) : 0;

  const pairPx = (index: number) =>
    measure(childRefs.current[index]) + measure(childRefs.current[index + 1]);

  const applyResize = (index: number, px: number) => {
    const container = containerRef.current;
    const total = measure(container);
    if (!container || total <= 0) return;
    const pair = node.sizes[index] + node.sizes[index + 1];
    const clamped = Math.min(
      Math.max(px, MIN_PANE_PX),
      Math.max(pairPx(index) - MIN_PANE_PX, MIN_PANE_PX),
    );
    const sizes = [...node.sizes];
    sizes[index] = Math.min(clamped / total, pair);
    sizes[index + 1] = pair - sizes[index];
    resizePanes(tab.id, node.id, sizes);
  };

  return (
    <div
      ref={containerRef}
      className={horizontal ? "flex h-full w-full" : "flex h-full w-full flex-col"}
    >
      {node.children.map((child, i) => (
        <Fragment key={child.type === "leaf" ? child.paneId : child.id}>
          {i > 0 && (
            <ResizeHandle
              axis={horizontal ? "x" : "y"}
              getSize={() => measure(childRefs.current[i - 1])}
              onResize={(px) => applyResize(i - 1, px)}
              limits={() => ({
                min: MIN_PANE_PX,
                max: Math.max(pairPx(i - 1) - MIN_PANE_PX, MIN_PANE_PX),
              })}
            />
          )}
          <div
            ref={(el) => {
              childRefs.current[i] = el;
            }}
            className="min-h-0 min-w-0"
            style={{ flexGrow: node.sizes[i], flexShrink: 1, flexBasis: 0 }}
          >
            <LayoutNode node={child} tab={tab} active={active} />
          </div>
        </Fragment>
      ))}
    </div>
  );
}

function PaneView({
  pane,
  tab,
  active,
}: {
  pane: TerminalPane;
  tab: TerminalTab;
  active: boolean;
}) {
  const { t } = useI18n();
  const reconnect = useTabsStore((s) => s.reconnectTerminal);
  const focusPane = useTabsStore((s) => s.focusPane);
  const splitPane = useTabsStore((s) => s.splitPane);
  const closePane = useTabsStore((s) => s.closePane);
  const searchOpen = useTerminalSearch((s) => s.openFor === pane.id);
  const paneActive = active && tab.activePaneId === pane.id;
  const [hasSelection, setHasSelection] = useState(
    () => getSession(pane.id)?.term.hasSelection() ?? false,
  );

  useEffect(() => {
    const term = getSession(pane.id)?.term;
    if (!term) return;
    const sub = term.onSelectionChange(() =>
      setHasSelection(term.hasSelection()),
    );
    return () => sub.dispose();
  }, [pane.id]);

  const runAndRefocus = (action: () => void) => () => {
    action();
    getSession(pane.id)?.focus();
  };

  return (
    <ContextMenu>
      <ContextMenuTrigger asChild>
        <div
          className="relative h-full w-full bg-terminal-background"
          onFocusCapture={() => {
            if (tab.activePaneId !== pane.id) focusPane(pane.id);
          }}
        >
          <TerminalView
            sessionId={pane.id}
            target={pane.target}
            hostId={pane.hostId}
            adhoc={pane.adhoc}
            attempt={pane.attempt}
            active={paneActive}
          />
          <StickyCommand key={pane.attempt} sessionId={pane.id} />
          {searchOpen && active && <SearchBar sessionId={pane.id} />}
          <StatusOverlay pane={pane} onReconnect={() => reconnect(pane.id)} />
        </div>
      </ContextMenuTrigger>
      <ContextMenuContent>
        <ContextMenuItem
          disabled={!hasSelection}
          onSelect={runAndRefocus(() => void copyPaneSelection(pane.id))}
        >
          <Copy /> {t("common.copy")}
        </ContextMenuItem>
        <ContextMenuItem
          onSelect={runAndRefocus(() => void pastePaneClipboard(pane.id))}
        >
          <ClipboardPaste /> {t("terminal.menu.paste")}
        </ContextMenuItem>
        <ContextMenuItem onSelect={runAndRefocus(() => selectPaneAll(pane.id))}>
          <SquareDashedMousePointer /> {t("terminal.menu.selectAll")}
        </ContextMenuItem>
        <ContextMenuItem onSelect={runAndRefocus(() => clearPaneBuffer(pane.id))}>
          <Eraser /> {t("terminal.menu.clear")}
        </ContextMenuItem>
        <ContextMenuSeparator />
        <ContextMenuItem
          onSelect={runAndRefocus(() => splitPane(pane.id, "right"))}
        >
          <SquareSplitHorizontal /> {t("commands.terminal.splitRight")}
        </ContextMenuItem>
        <ContextMenuItem onSelect={runAndRefocus(() => splitPane(pane.id, "down"))}>
          <SquareSplitVertical /> {t("commands.terminal.splitDown")}
        </ContextMenuItem>
        <ContextMenuSeparator />
        <ContextMenuItem destructive onSelect={() => closePane(pane.id)}>
          <X />{" "}
          {t(
            tab.panes.length > 1
              ? "terminal.menu.closePane"
              : "terminal.menu.closeTerminal",
          )}
        </ContextMenuItem>
      </ContextMenuContent>
    </ContextMenu>
  );
}

function StickyCommand({ sessionId }: { sessionId: string }) {
  const [sticky, setSticky] = useState<{ text: string; line: number }>();
  useZoomStore((s) => s.level);
  useFontStore((s) => s.family);

  useEffect(() => {
    const session = getSession(sessionId);
    if (!session) return;
    const term = session.term;
    const update = () => {
      const buf = term.buffer.active;
      if (buf.type === "alternate") return setSticky(undefined);
      const mark = session.commands.stickyAt(buf.viewportY);
      setSticky(mark ? { text: mark.text, line: mark.marker.line } : undefined);
    };
    const subs = [
      term.onScroll(update),
      term.onWriteParsed(update),
      term.onResize(update),
    ];
    return () => subs.forEach((sub) => sub.dispose());
  }, [sessionId]);

  if (!sticky) return null;

  return (
    <button
      type="button"
      onClick={() => {
        const session = getSession(sessionId);
        session?.term.scrollToLine(sticky.line);
        session?.focus();
      }}
      className="absolute inset-x-0 top-0 z-10 block overflow-hidden text-ellipsis whitespace-pre border-b border-border bg-terminal-background text-left"
      style={{
        color: "var(--terminal-foreground)",
        fontFamily: monoFontFamily(),
        fontSize: terminalFontSize(),
        lineHeight: 1.25,
      }}
    >
      {sticky.text}
    </button>
  );
}

interface SearchToggles {
  matchCase: boolean;
  wholeWord: boolean;
  regex: boolean;
}

function SearchBar({ sessionId }: { sessionId: string }) {
  const { t } = useI18n();
  const { theme } = useTheme();
  const close = useTerminalSearch((s) => s.close);
  const requestId = useTerminalSearch((s) => s.requestId);
  const [query, setQuery] = useState("");
  const [toggles, setToggles] = useState<SearchToggles>({
    matchCase: false,
    wholeWord: false,
    regex: false,
  });
  const [result, setResult] = useState<{ index: number; count: number }>();
  const inputRef = useRef<HTMLInputElement>(null);

  useLayoutEffect(() => {
    inputRef.current?.focus();
    inputRef.current?.select();
  }, [requestId]);

  useEffect(() => {
    const search = getSession(sessionId)?.search;
    if (!search) return;
    const sub = search.onDidChangeResults((e) =>
      setResult({ index: e.resultIndex, count: e.resultCount }),
    );
    return () => sub.dispose();
  }, [sessionId]);

  const runSearch = (
    text: string,
    nextToggles: SearchToggles,
    direction: "next" | "previous",
    incremental: boolean,
  ) => {
    const search = getSession(sessionId)?.search;
    if (!search) return;
    if (!text || (nextToggles.regex && !isValidRegex(text))) {
      search.clearDecorations();
      setResult(undefined);
      return;
    }
    const options: ISearchOptions = {
      caseSensitive: nextToggles.matchCase,
      wholeWord: nextToggles.wholeWord,
      regex: nextToggles.regex,
      incremental: direction === "next" && incremental,
      decorations: {
        matchBackground: theme.terminal.selectionBackground,
        matchOverviewRuler: theme.terminal.selectionBackground,
        activeMatchBackground: theme.terminal.selectionBackground,
        activeMatchBorder: theme.terminal.cursor,
        activeMatchColorOverviewRuler: theme.terminal.selectionBackground,
      },
    };
    if (direction === "next") search.findNext(text, options);
    else search.findPrevious(text, options);
  };

  const toggle = (key: keyof SearchToggles) => {
    const next = { ...toggles, [key]: !toggles[key] };
    setToggles(next);
    runSearch(query, next, "next", true);
  };

  const dismiss = () => {
    getSession(sessionId)?.search.clearDecorations();
    close();
    focusTerminal(sessionId);
  };

  const invalidRegex = Boolean(query) && toggles.regex && !isValidRegex(query);
  const hasResults = Boolean(result && result.count > 0);
  const resultLabel = !query
    ? t("terminal.search.noResults")
    : invalidRegex
      ? t("terminal.search.invalidRegex")
      : !result || result.count === 0
        ? t("terminal.search.noResults")
        : result.index < 0
          ? `${result.count}+`
          : t("terminal.search.resultCount", {
              current: result.index + 1,
              total: result.count,
            });

  return (
    <FindBar
      label={t("terminal.search.dialogLabel")}
      onDismiss={dismiss}
      className="flex w-[min(26rem,calc(100%-1.5rem))] items-center gap-1"
    >
      <div className="relative min-w-0 flex-1">
        <FindInput
          ref={inputRef}
          value={query}
          placeholder={t("terminal.search.placeholder")}
          aria-label={t("terminal.search.placeholder")}
          aria-invalid={invalidRegex || undefined}
          onChange={(e) => {
            setQuery(e.target.value);
            runSearch(e.target.value, toggles, "next", true);
          }}
          onKeyDown={(e) => {
            if (e.key !== "Enter") return;
            e.preventDefault();
            runSearch(query, toggles, e.shiftKey ? "previous" : "next", false);
          }}
          onBlur={() => getSession(sessionId)?.search.clearActiveDecoration()}
          className="pr-[4.75rem]"
        />
        <div className="absolute inset-y-0 right-0.5 flex items-center">
          <FindToggleButton
            active={toggles.matchCase}
            label={t("terminal.search.matchCase")}
            icon={CaseSensitive}
            onClick={() => toggle("matchCase")}
          />
          <FindToggleButton
            active={toggles.wholeWord}
            label={t("terminal.search.wholeWord")}
            icon={WholeWord}
            onClick={() => toggle("wholeWord")}
          />
          <FindToggleButton
            active={toggles.regex}
            label={t("terminal.search.regex")}
            icon={Regex}
            onClick={() => toggle("regex")}
          />
        </div>
      </div>
      <FindCount danger={Boolean(query) && (invalidRegex || !hasResults)}>
        {resultLabel}
      </FindCount>
      <FindActionButton
        label={t("terminal.search.previous")}
        icon={ArrowUp}
        disabled={!hasResults}
        onClick={() => runSearch(query, toggles, "previous", false)}
      />
      <FindActionButton
        label={t("terminal.search.next")}
        icon={ArrowDown}
        disabled={!hasResults}
        onClick={() => runSearch(query, toggles, "next", false)}
      />
      <FindActionButton
        label={t("terminal.search.close")}
        icon={X}
        onClick={dismiss}
      />
    </FindBar>
  );
}

function StatusOverlay({
  pane,
  onReconnect,
}: {
  pane: TerminalPane;
  onReconnect: () => void;
}) {
  const { t } = useI18n();

  if (pane.status === "connecting") {
    return (
      <Shell>
        <Loader2 className="size-7 animate-spin text-link" />
        <p className="text-sm font-medium text-foreground">
          {t("terminal.connecting", { host: pane.title })}
        </p>
      </Shell>
    );
  }

  if (pane.status === "error") {
    const cancelled = pane.errorCode === "cancelled";
    return (
      <Shell>
        <span className="flex size-12 items-center justify-center rounded-full bg-danger/10 text-danger">
          <ServerCrash className="size-6" />
        </span>
        <p className="text-sm font-semibold text-foreground">
          {t(
            cancelled ? "terminal.connectCancelled" : "terminal.connectFailed",
          )}
        </p>
        {pane.error && (
          <p className="max-w-md select-text break-words text-center font-mono text-xs leading-relaxed text-danger">
            {pane.error}
          </p>
        )}
        <Button size="sm" variant="outline" onClick={onReconnect}>
          {t("terminal.retry")}
        </Button>
      </Shell>
    );
  }

  if (pane.status === "closed") {
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
    <div className="absolute inset-0 z-10 flex overflow-hidden bg-background/85 backdrop-blur-sm">
      <div className="m-auto flex flex-col items-center gap-3 p-3">
        {children}
      </div>
    </div>
  );
}
