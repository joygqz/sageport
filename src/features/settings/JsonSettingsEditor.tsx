import { useEffect, useRef } from "react";
import { jsonDefaults } from "monaco-editor/language/json/monaco.contribution";

import { useI18n } from "@/i18n";
import { useTheme } from "@/themes";
import { monoFontFamily, useFontStore } from "@/workbench/font";
import { useZoomStore, zoomFactor } from "@/workbench/zoom";
import { applyEditorTheme, monaco } from "@/features/sftp/monaco";
import { jsonSettingsSchema } from "./jsonSettings";

const FONT_BASE = 13;
const SETTINGS_MODEL_URI = "inmemory://settings/settings.json";
const SETTINGS_SCHEMA_URI = "sageport://schemas/settings.json";

jsonDefaults.setDiagnosticsOptions({
  validate: true,
  allowComments: false,
  enableSchemaRequest: false,
  schemaValidation: "error",
  schemaRequest: "error",
  trailingCommas: "error",
  schemas: [
    {
      uri: SETTINGS_SCHEMA_URI,
      fileMatch: [SETTINGS_MODEL_URI],
      schema: jsonSettingsSchema(),
    },
  ],
});

type CodeEditorInstance = ReturnType<typeof monaco.editor.create>;

function editorFontSize(level: number) {
  return Math.round(FONT_BASE * zoomFactor(level));
}

export function JsonSettingsEditor({
  value,
  onChange,
  onSave,
}: {
  value: string;
  onChange: (value: string) => void;
  onSave: () => void;
}) {
  const { t } = useI18n();
  const { theme } = useTheme();
  const hostRef = useRef<HTMLDivElement>(null);
  const editorRef = useRef<CodeEditorInstance | null>(null);
  const onChangeRef = useRef(onChange);
  const onSaveRef = useRef(onSave);
  const valueRef = useRef(value);

  useEffect(() => {
    onChangeRef.current = onChange;
    onSaveRef.current = onSave;
    valueRef.current = value;
  }, [onChange, onSave, value]);

  useEffect(() => {
    applyEditorTheme(theme);
  }, [theme]);

  useEffect(() => {
    const model = monaco.editor.createModel(
      valueRef.current,
      "json",
      monaco.Uri.parse(SETTINGS_MODEL_URI),
    );
    const editor = monaco.editor.create(hostRef.current!, {
      model,
      ariaLabel: t("settings.json.editorLabel"),
      automaticLayout: true,
      bracketPairColorization: { enabled: true },
      folding: true,
      fontFamily: monoFontFamily(),
      fontSize: editorFontSize(useZoomStore.getState().level),
      formatOnPaste: true,
      formatOnType: true,
      lineNumbersMinChars: 3,
      minimap: { enabled: false },
      renderWhitespace: "boundary",
      renderValidationDecorations: "on",
      scrollBeyondLastLine: false,
      tabSize: 2,
    });
    editorRef.current = editor;

    editor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyS, () => {
      onSaveRef.current();
    });

    const contentSubscription = editor.onDidChangeModelContent(() => {
      onChangeRef.current(model.getValue());
    });
    const unsubscribeZoom = useZoomStore.subscribe((state) => {
      editor.updateOptions({ fontSize: editorFontSize(state.level) });
    });
    const unsubscribeFont = useFontStore.subscribe((state) => {
      editor.updateOptions({ fontFamily: monoFontFamily(state.family) });
    });

    editor.focus();

    return () => {
      unsubscribeFont();
      unsubscribeZoom();
      contentSubscription.dispose();
      editorRef.current = null;
      editor.dispose();
      model.dispose();
    };
  }, [t]);

  useEffect(() => {
    const model = editorRef.current?.getModel();
    if (model && model.getValue() !== value) {
      model.setValue(value);
    }
  }, [value]);

  return (
    <div
      ref={hostRef}
      className="h-[28rem] min-h-72 w-full overflow-hidden bg-terminal-background"
    />
  );
}
