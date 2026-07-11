import { Terminal as XTerm, type ITheme } from "@xterm/xterm";
import { ClipboardAddon } from "@xterm/addon-clipboard";
import { FitAddon } from "@xterm/addon-fit";
import { SearchAddon } from "@xterm/addon-search";
import { Unicode11Addon } from "@xterm/addon-unicode11";
import { WebLinksAddon } from "@xterm/addon-web-links";
import { WebglAddon } from "@xterm/addon-webgl";
import { openUrl } from "@tauri-apps/plugin-opener";
import "@xterm/xterm/css/xterm.css";

import type { ThemeDefinition } from "@/themes";

export function terminalTheme(theme: ThemeDefinition): ITheme {
  return {
    ...theme.terminal,
    cursorAccent: theme.terminal.background,
    scrollbarSliderBackground: `${theme.colors.mutedForeground}4d`,
    scrollbarSliderHoverBackground: `${theme.colors.mutedForeground}80`,
    scrollbarSliderActiveBackground: `${theme.colors.mutedForeground}99`,
  };
}

export interface TerminalInstance {
  term: XTerm;
  fit: FitAddon;
  search: SearchAddon;
}

export function createTerminal(opts: {
  fontFamily: string;
  fontSize: number;
  theme: ITheme;
}): TerminalInstance {
  const term = new XTerm({
    allowProposedApi: true,
    fontFamily: opts.fontFamily,
    fontSize: opts.fontSize,
    lineHeight: 1.25,
    theme: opts.theme,
    scrollback: 10_000,
    macOptionIsMeta: true,
    minimumContrastRatio: 1.1,
    rescaleOverlappingGlyphs: true,
  });

  const fit = new FitAddon();
  const search = new SearchAddon();
  term.loadAddon(fit);
  term.loadAddon(search);
  term.loadAddon(new ClipboardAddon());
  term.loadAddon(
    new WebLinksAddon((event, uri) => {
      if (!event.metaKey && !event.ctrlKey) return;
      void openUrl(uri).catch(() => {});
    }),
  );
  const unicode = new Unicode11Addon();
  term.loadAddon(unicode);
  term.unicode.activeVersion = "11";

  return { term, fit, search };
}

export function attachWebglRenderer(term: XTerm) {
  try {
    const webgl = new WebglAddon();
    webgl.onContextLoss(() => webgl.dispose());
    term.loadAddon(webgl);
  } catch {}
}
