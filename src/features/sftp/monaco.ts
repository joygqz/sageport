import * as monaco from "monaco-editor/esm/vs/editor/edcore.main";
import EditorWorker from "monaco-editor/esm/vs/editor/editor.worker?worker";

import "monaco-editor/esm/vs/basic-languages/abap/abap.contribution";
import "monaco-editor/esm/vs/basic-languages/apex/apex.contribution";
import "monaco-editor/esm/vs/basic-languages/azcli/azcli.contribution";
import "monaco-editor/esm/vs/basic-languages/bat/bat.contribution";
import "monaco-editor/esm/vs/basic-languages/bicep/bicep.contribution";
import "monaco-editor/esm/vs/basic-languages/cameligo/cameligo.contribution";
import "monaco-editor/esm/vs/basic-languages/clojure/clojure.contribution";
import "monaco-editor/esm/vs/basic-languages/coffee/coffee.contribution";
import "monaco-editor/esm/vs/basic-languages/cpp/cpp.contribution";
import "monaco-editor/esm/vs/basic-languages/csharp/csharp.contribution";
import "monaco-editor/esm/vs/basic-languages/csp/csp.contribution";
import "monaco-editor/esm/vs/basic-languages/css/css.contribution";
import "monaco-editor/esm/vs/basic-languages/cypher/cypher.contribution";
import "monaco-editor/esm/vs/basic-languages/dart/dart.contribution";
import "monaco-editor/esm/vs/basic-languages/dockerfile/dockerfile.contribution";
import "monaco-editor/esm/vs/basic-languages/ecl/ecl.contribution";
import "monaco-editor/esm/vs/basic-languages/elixir/elixir.contribution";
import "monaco-editor/esm/vs/basic-languages/flow9/flow9.contribution";
import "monaco-editor/esm/vs/basic-languages/fsharp/fsharp.contribution";
import "monaco-editor/esm/vs/basic-languages/freemarker2/freemarker2.contribution";
import "monaco-editor/esm/vs/basic-languages/go/go.contribution";
import "monaco-editor/esm/vs/basic-languages/graphql/graphql.contribution";
import "monaco-editor/esm/vs/basic-languages/handlebars/handlebars.contribution";
import "monaco-editor/esm/vs/basic-languages/hcl/hcl.contribution";
import "monaco-editor/esm/vs/basic-languages/html/html.contribution";
import "monaco-editor/esm/vs/basic-languages/ini/ini.contribution";
import "monaco-editor/esm/vs/basic-languages/java/java.contribution";
import "monaco-editor/esm/vs/basic-languages/javascript/javascript.contribution";
import "monaco-editor/esm/vs/basic-languages/julia/julia.contribution";
import "monaco-editor/esm/vs/basic-languages/kotlin/kotlin.contribution";
import "monaco-editor/esm/vs/basic-languages/less/less.contribution";
import "monaco-editor/esm/vs/basic-languages/lexon/lexon.contribution";
import "monaco-editor/esm/vs/basic-languages/lua/lua.contribution";
import "monaco-editor/esm/vs/basic-languages/liquid/liquid.contribution";
import "monaco-editor/esm/vs/basic-languages/m3/m3.contribution";
import "monaco-editor/esm/vs/basic-languages/markdown/markdown.contribution";
import "monaco-editor/esm/vs/basic-languages/mdx/mdx.contribution";
import "monaco-editor/esm/vs/basic-languages/mips/mips.contribution";
import "monaco-editor/esm/vs/basic-languages/msdax/msdax.contribution";
import "monaco-editor/esm/vs/basic-languages/mysql/mysql.contribution";
import "monaco-editor/esm/vs/basic-languages/objective-c/objective-c.contribution";
import "monaco-editor/esm/vs/basic-languages/pascal/pascal.contribution";
import "monaco-editor/esm/vs/basic-languages/pascaligo/pascaligo.contribution";
import "monaco-editor/esm/vs/basic-languages/perl/perl.contribution";
import "monaco-editor/esm/vs/basic-languages/pgsql/pgsql.contribution";
import "monaco-editor/esm/vs/basic-languages/php/php.contribution";
import "monaco-editor/esm/vs/basic-languages/pla/pla.contribution";
import "monaco-editor/esm/vs/basic-languages/postiats/postiats.contribution";
import "monaco-editor/esm/vs/basic-languages/powerquery/powerquery.contribution";
import "monaco-editor/esm/vs/basic-languages/powershell/powershell.contribution";
import "monaco-editor/esm/vs/basic-languages/protobuf/protobuf.contribution";
import "monaco-editor/esm/vs/basic-languages/pug/pug.contribution";
import "monaco-editor/esm/vs/basic-languages/python/python.contribution";
import "monaco-editor/esm/vs/basic-languages/qsharp/qsharp.contribution";
import "monaco-editor/esm/vs/basic-languages/r/r.contribution";
import "monaco-editor/esm/vs/basic-languages/razor/razor.contribution";
import "monaco-editor/esm/vs/basic-languages/redis/redis.contribution";
import "monaco-editor/esm/vs/basic-languages/redshift/redshift.contribution";
import "monaco-editor/esm/vs/basic-languages/restructuredtext/restructuredtext.contribution";
import "monaco-editor/esm/vs/basic-languages/ruby/ruby.contribution";
import "monaco-editor/esm/vs/basic-languages/rust/rust.contribution";
import "monaco-editor/esm/vs/basic-languages/sb/sb.contribution";
import "monaco-editor/esm/vs/basic-languages/scala/scala.contribution";
import "monaco-editor/esm/vs/basic-languages/scheme/scheme.contribution";
import "monaco-editor/esm/vs/basic-languages/scss/scss.contribution";
import "monaco-editor/esm/vs/basic-languages/shell/shell.contribution";
import "monaco-editor/esm/vs/basic-languages/solidity/solidity.contribution";
import "monaco-editor/esm/vs/basic-languages/sophia/sophia.contribution";
import "monaco-editor/esm/vs/basic-languages/sparql/sparql.contribution";
import "monaco-editor/esm/vs/basic-languages/sql/sql.contribution";
import "monaco-editor/esm/vs/basic-languages/st/st.contribution";
import "monaco-editor/esm/vs/basic-languages/swift/swift.contribution";
import "monaco-editor/esm/vs/basic-languages/systemverilog/systemverilog.contribution";
import "monaco-editor/esm/vs/basic-languages/tcl/tcl.contribution";
import "monaco-editor/esm/vs/basic-languages/twig/twig.contribution";
import "monaco-editor/esm/vs/basic-languages/typescript/typescript.contribution";
import "monaco-editor/esm/vs/basic-languages/typespec/typespec.contribution";
import "monaco-editor/esm/vs/basic-languages/vb/vb.contribution";
import "monaco-editor/esm/vs/basic-languages/wgsl/wgsl.contribution";
import "monaco-editor/esm/vs/basic-languages/xml/xml.contribution";
import "monaco-editor/esm/vs/basic-languages/yaml/yaml.contribution";

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
  monaco.editor.defineTheme(EDITOR_THEME, {
    base: theme.appearance === "dark" ? "vs-dark" : "vs",
    inherit: true,
    rules: [],
    colors: {
      "editor.background": terminal.background,
      "editor.foreground": terminal.foreground,
      "editorCursor.foreground": terminal.cursor,
      "editor.selectionBackground": terminal.selectionBackground,
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
      "input.background": colors.input,
      "input.foreground": colors.foreground,
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
