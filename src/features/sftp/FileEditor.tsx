import { useEffect, useRef } from "react";

import {
  defaultKeymap,
  history,
  historyKeymap,
  indentLess,
  insertTab,
} from "@codemirror/commands";
import {
  bracketMatching,
  HighlightStyle,
  LanguageDescription,
  syntaxHighlighting,
} from "@codemirror/language";
import { languages } from "@codemirror/language-data";
import { Compartment, EditorState } from "@codemirror/state";
import {
  EditorView,
  highlightActiveLine,
  highlightActiveLineGutter,
  highlightWhitespace,
  keymap,
  lineNumbers,
  ViewPlugin,
} from "@codemirror/view";
import { tags as t } from "@lezer/highlight";
import { HardDrive, Server } from "lucide-react";

import { Spinner } from "@/components/ui";
import { useTabsStore, type FileTab } from "@/workbench/tabs";

/**
 * Structural editor chrome. Colors reference the theme's CSS custom
 * properties (the editor shares the terminal's surface colors), so a theme
 * switch restyles a live editor without a rebuild.
 */
const editorTheme = EditorView.theme({
  "&": {
    height: "100%",
    fontSize: "0.875rem",
    backgroundColor: "var(--color-terminal-background)",
    color: "var(--color-terminal-foreground)",
  },
  "&.cm-focused": { outline: "none" },
  ".cm-scroller": {
    fontFamily:
      'var(--font-mono, "JetBrains Mono Variable", ui-monospace, monospace)',
    lineHeight: "1.5",
    overflow: "auto",
  },
  // Match xterm 6's VSCode-style scrollbar (14px, flat, foreground at
  // 20/40/50% opacity) instead of the app-wide pill-shaped scrollbar.
  ".cm-scroller::-webkit-scrollbar": {
    width: "14px",
    height: "14px",
  },
  ".cm-scroller::-webkit-scrollbar-track": {
    backgroundColor: "transparent",
  },
  ".cm-scroller::-webkit-scrollbar-corner": {
    backgroundColor: "transparent",
  },
  ".cm-scroller::-webkit-scrollbar-thumb": {
    backgroundColor:
      "color-mix(in srgb, var(--color-terminal-foreground) 20%, transparent)",
    borderRadius: "0",
    border: "none",
    backgroundClip: "border-box",
  },
  ".cm-scroller::-webkit-scrollbar-thumb:hover": {
    backgroundColor:
      "color-mix(in srgb, var(--color-terminal-foreground) 40%, transparent)",
  },
  ".cm-scroller::-webkit-scrollbar-thumb:active": {
    backgroundColor:
      "color-mix(in srgb, var(--color-terminal-foreground) 50%, transparent)",
  },
  ".cm-content": {
    padding: "0.5rem 0",
    // CodeMirror's base theme hardcodes a black caret (it can't know the
    // app theme's appearance); follow the text color instead.
    caretColor: "currentColor",
  },
  ".cm-line": { padding: "0 1rem" },
  ".cm-gutters": {
    backgroundColor: "var(--color-terminal-background)",
    color: "var(--color-muted-foreground)",
    borderRight: "none",
    paddingLeft: "0.5rem",
  },
  ".cm-activeLine": {
    backgroundColor:
      "color-mix(in oklch, var(--color-list-hover) 60%, transparent)",
  },
  ".cm-activeLineGutter": {
    backgroundColor: "transparent",
    color: "var(--color-foreground)",
  },
  ".cm-matchingBracket": {
    backgroundColor:
      "color-mix(in oklch, var(--color-primary) 20%, transparent)",
    outline:
      "1px solid color-mix(in oklch, var(--color-primary) 50%, transparent)",
  },
  ".cm-highlightSpace": {
    backgroundImage:
      "radial-gradient(circle at center, color-mix(in srgb, currentColor 35%, transparent) 1px, transparent 1.2px)",
    backgroundPosition: "center",
    backgroundRepeat: "no-repeat",
  },
  ".cm-highlightTab": {
    position: "relative",
  },
  ".cm-highlightTab::after": {
    content: '"→"',
    position: "absolute",
    inset: "0 auto 0 0.15em",
    color: "color-mix(in srgb, currentColor 35%, transparent)",
    pointerEvents: "none",
  },
});

const SCROLLBAR_HIT_SIZE = 18;

type InternalMouseSelection = { destroy: () => void };
type InternalInputState = {
  mouseSelection?: InternalMouseSelection | null;
  draggedContent?: unknown;
};

function isScrollbarHit(view: EditorView, event: MouseEvent) {
  if (event.button !== 0) return false;

  const scroller = view.scrollDOM;
  const rect = scroller.getBoundingClientRect();
  if (
    event.clientX < rect.left ||
    event.clientX > rect.right ||
    event.clientY < rect.top ||
    event.clientY > rect.bottom
  ) {
    return false;
  }

  const hasVertical = scroller.scrollHeight > scroller.clientHeight + 1;
  const hasHorizontal = scroller.scrollWidth > scroller.clientWidth + 1;
  const verticalWidth = Math.max(
    scroller.offsetWidth - scroller.clientWidth,
    SCROLLBAR_HIT_SIZE,
  );
  const horizontalHeight = Math.max(
    scroller.offsetHeight - scroller.clientHeight,
    SCROLLBAR_HIT_SIZE,
  );

  return (
    (hasVertical && event.clientX >= rect.right - verticalWidth) ||
    (hasHorizontal && event.clientY >= rect.bottom - horizontalHeight)
  );
}

function clearSelectionArtifacts(view: EditorView) {
  const inputState = (view as unknown as { inputState?: InternalInputState })
    .inputState;
  inputState?.mouseSelection?.destroy();
  if (inputState) inputState.draggedContent = null;

  const selection = view.contentDOM.ownerDocument.getSelection();
  if (
    selection?.anchorNode &&
    view.dom.contains(selection.anchorNode) &&
    (!selection.focusNode || view.dom.contains(selection.focusNode))
  ) {
    selection.removeAllRanges();
  }
}

/**
 * Dragging a native WebKit scrollbar can leak a text-selection gesture through
 * the overlay thumb into CodeMirror's contentDOM. That leaves CM with an active
 * mouse selection; the next editor click then selects a range and scrolls back
 * toward the old anchor. Shield only actual scrollbar drags.
 */
const scrollbarDragGuard = ViewPlugin.fromClass(
  class {
    private draggingScrollbar = false;
    private restoreUserSelect: (() => void) | null = null;
    private idleTimer = 0;
    private frame = 0;

    constructor(private readonly view: EditorView) {
      view.scrollDOM.addEventListener("mousedown", this.onMouseDown, true);
      view.scrollDOM.addEventListener("scroll", this.onScroll, {
        passive: true,
      });
    }

    destroy() {
      this.finishScrollbarDrag();
      this.view.scrollDOM.removeEventListener(
        "mousedown",
        this.onMouseDown,
        true,
      );
      this.view.scrollDOM.removeEventListener("scroll", this.onScroll);
      this.cancelTimers();
    }

    private onMouseDown = (event: MouseEvent) => {
      if (!isScrollbarHit(this.view, event)) return;
      this.startScrollbarDrag();
      event.stopImmediatePropagation();
    };

    private onMouseMove = (event: MouseEvent) => {
      if (!this.draggingScrollbar) return;
      clearSelectionArtifacts(this.view);
      event.stopImmediatePropagation();
    };

    private onMouseUp = (event: MouseEvent) => {
      if (!this.draggingScrollbar) return;
      event.stopImmediatePropagation();
      this.finishScrollbarDrag();
    };

    private onScroll = () => {
      if (!this.draggingScrollbar) return;
      clearSelectionArtifacts(this.view);
      this.measureNowAndNextFrame();
      this.finishAfterIdle();
    };

    private startScrollbarDrag() {
      this.draggingScrollbar = true;
      clearSelectionArtifacts(this.view);
      this.disableContentSelection();
      this.measureNowAndNextFrame();

      const doc = this.view.contentDOM.ownerDocument;
      doc.addEventListener("mousemove", this.onMouseMove, true);
      doc.addEventListener("mouseup", this.onMouseUp, true);
    }

    private finishScrollbarDrag() {
      if (!this.draggingScrollbar) return;
      this.draggingScrollbar = false;
      clearSelectionArtifacts(this.view);
      this.restoreUserSelect?.();
      this.restoreUserSelect = null;
      this.measureNowAndNextFrame();

      const doc = this.view.contentDOM.ownerDocument;
      doc.removeEventListener("mousemove", this.onMouseMove, true);
      doc.removeEventListener("mouseup", this.onMouseUp, true);

      const win = doc.defaultView;
      if (this.idleTimer && win) win.clearTimeout(this.idleTimer);
      this.idleTimer = 0;
    }

    private disableContentSelection() {
      if (this.restoreUserSelect) return;
      const { style } = this.view.contentDOM;
      const userSelect = style.userSelect;
      const webkitUserSelect = style.getPropertyValue("-webkit-user-select");
      style.userSelect = "none";
      style.setProperty("-webkit-user-select", "none");
      this.restoreUserSelect = () => {
        style.userSelect = userSelect;
        if (webkitUserSelect)
          style.setProperty("-webkit-user-select", webkitUserSelect);
        else style.removeProperty("-webkit-user-select");
      };
    }

    private finishAfterIdle() {
      const win = this.view.contentDOM.ownerDocument.defaultView;
      if (!win) return;
      if (this.idleTimer) win.clearTimeout(this.idleTimer);
      this.idleTimer = win.setTimeout(() => this.finishScrollbarDrag(), 250);
    }

    private measureNowAndNextFrame() {
      const win = this.view.contentDOM.ownerDocument.defaultView;
      if (!win) return;
      this.view.requestMeasure();
      if (this.frame) win.cancelAnimationFrame(this.frame);
      this.frame = win.requestAnimationFrame(() => {
        this.frame = 0;
        this.view.requestMeasure();
      });
    }

    private cancelTimers() {
      const win = this.view.contentDOM.ownerDocument.defaultView;
      if (!win) return;
      if (this.idleTimer) win.clearTimeout(this.idleTimer);
      if (this.frame) win.cancelAnimationFrame(this.frame);
      this.idleTimer = 0;
      this.frame = 0;
    }
  },
);

/**
 * Token classes only — the actual colors live in globals.css under `.tok-*`
 * (with `.dark` overrides), so highlighting follows the theme's appearance.
 */
const highlightStyle = HighlightStyle.define([
  { tag: [t.controlKeyword, t.moduleKeyword], class: "tok-controlKeyword" },
  { tag: t.keyword, class: "tok-keyword" },
  { tag: [t.atom, t.bool, t.null, t.self], class: "tok-atom" },
  { tag: t.string, class: "tok-string" },
  { tag: [t.regexp, t.escape, t.special(t.string)], class: "tok-string2" },
  { tag: t.number, class: "tok-number" },
  { tag: t.comment, class: "tok-comment" },
  {
    tag: [t.function(t.variableName), t.function(t.propertyName), t.macroName],
    class: "tok-function",
  },
  { tag: [t.typeName, t.className, t.namespace], class: "tok-type" },
  { tag: t.tagName, class: "tok-tag" },
  { tag: t.attributeName, class: "tok-attribute" },
  { tag: [t.variableName, t.propertyName, t.labelName], class: "tok-variable" },
  { tag: t.heading, class: "tok-heading" },
  { tag: t.link, class: "tok-link" },
  { tag: t.emphasis, class: "tok-emphasis" },
  { tag: t.strong, class: "tok-strong" },
  { tag: t.meta, class: "tok-meta" },
  { tag: t.invalid, class: "tok-invalid" },
]);

/**
 * An editor tab for small files opened from the files panel, local or
 * remote. VSCode conventions: Cmd/Ctrl+S saves in place (no save button;
 * unsaved changes show as the dot on the tab), and syntax highlighting is
 * picked by file name.
 */
export function FileEditor({ tab }: { tab: FileTab }) {
  return (
    <div className="flex h-full flex-col bg-background">
      <div className="flex h-9 shrink-0 items-center gap-2 border-b border-border px-3">
        {tab.connectionId ? (
          <Server className="size-3.5 shrink-0 text-muted-foreground" />
        ) : (
          <HardDrive className="size-3.5 shrink-0 text-muted-foreground" />
        )}
        <span
          className="min-w-0 flex-1 truncate text-xs text-muted-foreground"
          title={tab.path}
        >
          {tab.path}
        </span>
        {tab.saving && <Spinner className="size-3.5 text-muted-foreground" />}
      </div>

      {tab.loadError ? (
        <p className="p-4 text-sm text-destructive">{tab.loadError}</p>
      ) : tab.content === null ? (
        <div className="flex flex-1 items-center justify-center">
          <Spinner />
        </div>
      ) : (
        <CodeEditor tabId={tab.id} title={tab.title} />
      )}
    </div>
  );
}

/**
 * The CodeMirror host. The view is created once per tab (file tabs stay
 * mounted while hidden, so undo history and scroll position survive tab
 * switches); edits flow into the tabs store, and Cmd/Ctrl+S saves through it.
 */
function CodeEditor({ tabId, title }: { tabId: string; title: string }) {
  const hostRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const tab = useTabsStore
      .getState()
      .tabs.find((t): t is FileTab => t.id === tabId && t.kind === "file");
    const language = new Compartment();
    const view = new EditorView({
      state: EditorState.create({
        doc: tab?.content ?? "",
        extensions: [
          lineNumbers(),
          highlightActiveLineGutter(),
          highlightActiveLine(),
          history(),
          bracketMatching(),
          highlightWhitespace(),
          language.of([]),
          syntaxHighlighting(highlightStyle),
          keymap.of([
            {
              key: "Mod-s",
              run: () => {
                void useTabsStore.getState().saveFile(tabId);
                return true;
              },
            },
            { key: "Tab", run: insertTab, shift: indentLess },
            ...defaultKeymap,
            ...historyKeymap,
          ]),
          editorTheme,
          scrollbarDragGuard,
          EditorView.updateListener.of((update) => {
            if (update.docChanged) {
              useTabsStore
                .getState()
                .updateFileContent(tabId, update.state.doc.toString());
            }
          }),
        ],
      }),
      parent: hostRef.current!,
    });
    view.focus();

    // Language support loads lazily (each grammar is its own chunk); the
    // buffer stays plain text until (and unless) a grammar matches the name.
    let cancelled = false;
    const description = LanguageDescription.matchFilename(languages, title);
    if (description) {
      void description.load().then((support) => {
        if (!cancelled) {
          view.dispatch({ effects: language.reconfigure(support) });
        }
      });
    }

    return () => {
      cancelled = true;
      view.destroy();
    };
  }, [tabId, title]);

  return <div ref={hostRef} className="min-h-0 flex-1 overflow-hidden" />;
}
