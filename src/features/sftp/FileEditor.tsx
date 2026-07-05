import { useEffect, useRef } from "react";

import {
  defaultKeymap,
  history,
  historyKeymap,
  indentWithTab,
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
  keymap,
  lineNumbers,
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
});

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
            indentWithTab,
            ...defaultKeymap,
            ...historyKeymap,
          ]),
          editorTheme,
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
