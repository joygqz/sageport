import { useEffect, useRef } from "react";

import { HardDrive, Server } from "lucide-react";

import { Spinner } from "@/components/ui";
import { useTheme } from "@/themes";
import { useTabsStore, type FileTab } from "@/workbench/tabs";
import { useZoomStore, zoomFactor } from "@/workbench/zoom";
import { registerFileEditor, unregisterFileEditor } from "./editor-registry";
import { applyEditorTheme, monaco } from "./monaco";

const FONT_BASE = 13;
const INDENT_SIZE = 2;

function editorFontSize(level: number) {
  return Math.round(FONT_BASE * zoomFactor(level));
}

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
  const { theme } = useTheme();

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
      fontFamily: getComputedStyle(document.documentElement)
        .getPropertyValue("--font-mono")
        .trim(),
      fontSize: editorFontSize(useZoomStore.getState().level),
      automaticLayout: true,
      renderWhitespace: "boundary",
      scrollBeyondLastLine: false,
      minimap: { enabled: true },
      fixedOverflowWidgets: true,
    });

    editor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyS, () => {
      void useTabsStore.getState().saveFile(tabId);
    });

    const contentSub = editor.onDidChangeModelContent(() => {
      useTabsStore.getState().updateFileContent(tabId, model.getValue());
    });
    const unsubscribeZoom = useZoomStore.subscribe((s) => {
      editor.updateOptions({ fontSize: editorFontSize(s.level) });
    });

    registerFileEditor(tabId, editor);
    if (useTabsStore.getState().activeId === tabId) editor.focus();

    return () => {
      unsubscribeZoom();
      contentSub.dispose();
      unregisterFileEditor(tabId);
      editor.dispose();
      model.dispose();
    };
  }, [tabId, title]);

  return <div ref={hostRef} className="min-h-0 flex-1 overflow-hidden" />;
}
