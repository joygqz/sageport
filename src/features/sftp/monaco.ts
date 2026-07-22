import * as monaco from "monaco-editor/editor";
import EditorWorker from "monaco-editor/editor/editor.worker?worker";

import "monaco-editor/basic-languages/monaco.contribution";

import type { ThemeDefinition } from "@/themes";

self.MonacoEnvironment = {
  getWorker: () => new EditorWorker(),
};

const EDITOR_THEME = "sageport";

let appliedThemeId: string | null = null;

export function applyEditorTheme(theme: ThemeDefinition) {
  if (appliedThemeId === theme.id) return;
  appliedThemeId = theme.id;

  const { colors, terminal } = theme;
  const token = (color: string) => color.replace(/^#/, "");
  monaco.editor.defineTheme(EDITOR_THEME, {
    base: theme.appearance === "dark" ? "vs-dark" : "vs",
    inherit: true,
    rules: [
      {
        token: "comment",
        foreground: token(terminal.brightBlack),
        fontStyle: "italic",
      },
      { token: "string", foreground: token(terminal.green) },
      { token: "number", foreground: token(terminal.yellow) },
      { token: "keyword", foreground: token(terminal.magenta) },
      { token: "type", foreground: token(terminal.cyan) },
      { token: "type.identifier", foreground: token(terminal.cyan) },
      { token: "function", foreground: token(terminal.blue) },
      { token: "tag", foreground: token(terminal.red) },
      { token: "attribute.name", foreground: token(terminal.yellow) },
      { token: "invalid", foreground: token(terminal.red) },
    ],
    colors: {
      "editor.background": terminal.background,
      "editor.foreground": terminal.foreground,
      "editorCursor.foreground": terminal.cursor,
      "editor.selectionBackground": terminal.selectionBackground,
      "editor.selectionHighlightBackground": `${colors.primary}33`,
      "editor.findMatchBackground": `${terminal.yellow}66`,
      "editor.findMatchHighlightBackground": `${terminal.yellow}33`,
      "editor.findRangeHighlightBackground": `${colors.primary}22`,
      "editor.lineHighlightBackground": `${colors.listHover}99`,
      "editorLineNumber.foreground": colors.mutedForeground,
      "editorLineNumber.activeForeground": colors.foreground,
      "editorWhitespace.foreground": `${colors.mutedForeground}66`,
      "editorWidget.background": colors.popover,
      "editorWidget.foreground": colors.popoverForeground,
      "editorWidget.border": colors.border,
      "editorSuggestWidget.background": colors.popover,
      "editorSuggestWidget.border": colors.border,
      "editorSuggestWidget.selectedBackground": colors.listActive,
      "editorSuggestWidget.selectedForeground": colors.listActiveForeground,
      "editorHoverWidget.background": colors.popover,
      "editorHoverWidget.border": colors.border,
      "input.background": colors.surface,
      "input.foreground": colors.foreground,
      "input.border": colors.input,
      focusBorder: colors.ring,
      "list.hoverBackground": colors.listHover,
      "list.activeSelectionBackground": colors.listActive,
      "list.activeSelectionForeground": colors.listActiveForeground,
      "list.focusBackground": colors.listActive,
      "list.focusForeground": colors.listActiveForeground,
      "quickInput.background": colors.popover,
      "quickInput.foreground": colors.popoverForeground,
      "quickInputList.focusBackground": colors.listActive,
      "quickInputList.focusForeground": colors.listActiveForeground,
      "menu.background": colors.popover,
      "menu.foreground": colors.popoverForeground,
      "menu.selectionBackground": colors.listActive,
      "menu.selectionForeground": colors.listActiveForeground,
      "menu.separatorBackground": colors.border,
      "scrollbarSlider.background": `${colors.mutedForeground}4d`,
      "scrollbarSlider.hoverBackground": `${colors.mutedForeground}80`,
      "scrollbarSlider.activeBackground": `${colors.mutedForeground}99`,
      "minimap.background": terminal.background,
    },
  });
  monaco.editor.setTheme(EDITOR_THEME);
}

export { monaco };
