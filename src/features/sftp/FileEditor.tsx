import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
} from "react";

import { HardDrive, Server } from "lucide-react";

import { Spinner } from "@/components/ui";
import { IS_MACOS } from "@/lib/platform";
import { useTheme } from "@/themes";
import { monoFontFamily, useFontStore } from "@/workbench/font";
import { useTabsStore, type FileTab } from "@/workbench/tabs";
import { useZoomStore, zoomFactor } from "@/workbench/zoom";
import { registerFileEditor, unregisterFileEditor } from "./editor-registry";
import { FileFindBar, type FileFindBarHandle } from "./FileFindBar";
import { applyEditorTheme, monaco } from "./monaco";

const FONT_BASE = 13;
const INDENT_SIZE = 2;

function editorFontSize(level: number) {
  return Math.round(FONT_BASE * zoomFactor(level));
}

type CodeEditorInstance = ReturnType<typeof monaco.editor.create>;

interface FindUiState {
  open: boolean;
  replaceVisible: boolean;
  requestId: number;
  seedQuery: string;
}

const CLOSED_FIND: FindUiState = {
  open: false,
  replaceVisible: false,
  requestId: 0,
  seedQuery: "",
};

function selectionSearchText(editor: CodeEditorInstance) {
  const model = editor.getModel();
  const selection = editor.getSelection();
  if (!model || !selection) return "";

  if (!selection.isEmpty()) {
    const selected = model.getValueInRange(selection);
    return /[\r\n]/.test(selected) ? "" : selected;
  }

  const position = editor.getPosition();
  return position ? (model.getWordAtPosition(position)?.word ?? "") : "";
}

export function FileEditor({ tab }: { tab: FileTab }) {
  return (
    <div className="flex h-full flex-col bg-terminal-background">
      <div className="flex h-[var(--compact-toolbar-height)] shrink-0 items-center gap-2 border-b border-border px-3">
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
        <p className="p-4 text-sm text-danger">{tab.loadError}</p>
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

function CodeEditor({ tabId, title }: { tabId: string; title: string }) {
  const hostRef = useRef<HTMLDivElement>(null);
  const editorRef = useRef<CodeEditorInstance | null>(null);
  const findBarRef = useRef<FileFindBarHandle>(null);
  const [editorInstance, setEditorInstance] =
    useState<CodeEditorInstance | null>(null);
  const [findUi, setFindUi] = useState<FindUiState>(CLOSED_FIND);
  const { theme } = useTheme();

  const openFind = useCallback(
    (showReplace: boolean, reseedFromSelection = false) => {
      if (findBarRef.current && !reseedFromSelection) {
        findBarRef.current.focus();
        setFindUi((state) => ({
          ...state,
          open: true,
          replaceVisible: showReplace || state.replaceVisible,
          requestId: state.requestId + 1,
        }));
        return;
      }

      const seedQuery = editorRef.current
        ? selectionSearchText(editorRef.current)
        : "";
      findBarRef.current?.focus(seedQuery || undefined);
      setFindUi((state) => ({
        open: true,
        replaceVisible: showReplace || (state.open && state.replaceVisible),
        requestId: state.requestId + 1,
        seedQuery,
      }));
    },
    [],
  );

  const closeFind = useCallback(() => {
    setFindUi((state) => ({ ...state, open: false }));
    requestAnimationFrame(() => editorRef.current?.focus());
  }, []);

  useEffect(() => {
    applyEditorTheme(theme);
  }, [theme]);

  useEffect(() => {
    const tab = useTabsStore
      .getState()
      .tabs.find((t): t is FileTab => t.id === tabId && t.kind === "file");

    const model = monaco.editor.createModel(
      tab?.content ?? "",
      undefined,
      monaco.Uri.from({ scheme: "inmemory", path: `/${tabId}/${title}` }),
    );
    model.detectIndentation(true, INDENT_SIZE);

    const editor = monaco.editor.create(hostRef.current!, {
      model,
      fontFamily: monoFontFamily(),
      fontSize: editorFontSize(useZoomStore.getState().level),
      automaticLayout: true,
      renderWhitespace: "boundary",
      scrollBeyondLastLine: false,
      minimap: { enabled: true },
      fixedOverflowWidgets: true,
    });
    editorRef.current = editor;
    setEditorInstance(editor);

    editor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyS, () => {
      void useTabsStore.getState().saveFile(tabId);
    });

    const findActions = [
      editor.addAction({
        id: "actions.find",
        label: "Find",
        keybindings: [monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyF],
        run: () => openFind(false),
      }),
      editor.addAction({
        id: "editor.action.startFindReplaceAction",
        label: "Replace",
        keybindings: [
          ...(!IS_MACOS ? [monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyH] : []),
          monaco.KeyMod.CtrlCmd | monaco.KeyMod.Alt | monaco.KeyCode.KeyF,
        ],
        run: () => openFind(true),
      }),
      editor.addAction({
        id: "editor.action.nextMatchFindAction",
        label: "Find Next",
        keybindings: [
          monaco.KeyCode.F3,
          ...(IS_MACOS ? [monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyG] : []),
        ],
        run: () => {
          if (findBarRef.current) findBarRef.current.move(1);
          else openFind(false);
        },
      }),
      editor.addAction({
        id: "editor.action.previousMatchFindAction",
        label: "Find Previous",
        keybindings: [
          monaco.KeyMod.Shift | monaco.KeyCode.F3,
          ...(IS_MACOS
            ? [
                monaco.KeyMod.CtrlCmd |
                  monaco.KeyMod.Shift |
                  monaco.KeyCode.KeyG,
              ]
            : []),
        ],
        run: () => {
          if (findBarRef.current) findBarRef.current.move(-1);
          else openFind(false);
        },
      }),
      ...(IS_MACOS
        ? [
            editor.addAction({
              id: "actions.findWithSelection",
              label: "Find With Selection",
              keybindings: [monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyE],
              run: () => openFind(false, true),
            }),
          ]
        : []),
    ];

    const contentSub = editor.onDidChangeModelContent(() => {
      useTabsStore.getState().updateFileContent(tabId, model.getValue());
    });
    const unsubscribeZoom = useZoomStore.subscribe((s) => {
      editor.updateOptions({ fontSize: editorFontSize(s.level) });
    });
    const unsubscribeFont = useFontStore.subscribe((s) => {
      editor.updateOptions({ fontFamily: monoFontFamily(s.family) });
    });

    registerFileEditor(tabId, editor);
    if (useTabsStore.getState().activeId === tabId) editor.focus();

    return () => {
      findActions.forEach((action) => action.dispose());
      unsubscribeFont();
      unsubscribeZoom();
      contentSub.dispose();
      unregisterFileEditor(tabId);
      editorRef.current = null;
      setEditorInstance((current) => (current === editor ? null : current));
      editor.dispose();
      model.dispose();
    };
  }, [openFind, tabId, title]);

  const onKeyDownCapture = (event: ReactKeyboardEvent<HTMLDivElement>) => {
    const key = event.key.toLowerCase();
    const command = event.metaKey || event.ctrlKey;
    const stop = () => {
      event.preventDefault();
      event.stopPropagation();
    };

    if (
      command &&
      !event.shiftKey &&
      ((key === "h" && !IS_MACOS && !event.altKey) ||
        (key === "f" && event.altKey))
    ) {
      stop();
      openFind(true);
    } else if (command && key === "f" && !event.altKey && !event.shiftKey) {
      stop();
      openFind(false);
    } else if (key === "f3" && !command && !event.altKey) {
      stop();
      if (findUi.open) findBarRef.current?.move(event.shiftKey ? -1 : 1);
      else openFind(false);
    } else if (
      IS_MACOS &&
      command &&
      !event.altKey &&
      ((key === "g" && findUi.open) || (key === "e" && !event.shiftKey))
    ) {
      stop();
      if (key === "g") findBarRef.current?.move(event.shiftKey ? -1 : 1);
      else openFind(false, true);
    } else if (event.key === "Escape" && findUi.open) {
      stop();
      closeFind();
    }
  };

  return (
    <div
      className="relative min-h-0 flex-1 overflow-hidden"
      onKeyDownCapture={onKeyDownCapture}
    >
      <div ref={hostRef} className="h-full w-full" />
      {findUi.open && editorInstance && (
        <FileFindBar
          ref={findBarRef}
          editor={editorInstance}
          replaceVisible={findUi.replaceVisible}
          requestId={findUi.requestId}
          seedQuery={findUi.seedQuery}
          onReplaceVisibleChange={(replaceVisible) =>
            setFindUi((state) => ({ ...state, replaceVisible }))
          }
          onClose={closeFind}
        />
      )}
    </div>
  );
}
