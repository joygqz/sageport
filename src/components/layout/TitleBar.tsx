import { Bot, FolderSync, Moon, Search, Settings, Sun } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Kbd } from "@/components/ui/kbd";
import { Tooltip } from "@/components/ui/tooltip";
import { useI18n } from "@/i18n";
import { useTheme } from "@/theme/useTheme";

export function TitleBar({
  onOpenCommand,
  onOpenSettings,
  onToggleAi,
  aiOpen,
  onToggleSftp,
  sftpOpen,
}: {
  onOpenCommand: () => void;
  onOpenSettings: () => void;
  onToggleAi: () => void;
  aiOpen: boolean;
  onToggleSftp: () => void;
  sftpOpen: boolean;
}) {
  const { t } = useI18n();
  const { resolved, setMode } = useTheme();

  return (
    <header
      data-tauri-drag-region
      className="flex h-11 shrink-0 items-center gap-2 border-b border-border bg-surface pl-20 pr-3"
    >
      <button
        onClick={onOpenCommand}
        className="mx-auto flex h-7 w-80 max-w-[45%] items-center gap-2 rounded-md bg-background px-2.5 text-xs text-muted-foreground transition-colors hover:text-foreground"
      >
        <Search className="size-3.5" />
        <span>{t("titleBar.searchPlaceholder")}</span>
        <Kbd className="ml-auto">⌘K</Kbd>
      </button>

      <div className="flex items-center gap-1" data-tauri-drag-region>
        <Tooltip
          content={sftpOpen ? t("titleBar.hideSftp") : t("titleBar.showSftp")}
        >
          <Button
            variant={sftpOpen ? "secondary" : "ghost"}
            size="icon"
            onClick={onToggleSftp}
          >
            <FolderSync />
          </Button>
        </Tooltip>
        <Tooltip content={aiOpen ? t("titleBar.hideAi") : t("titleBar.showAi")}>
          <Button
            variant={aiOpen ? "secondary" : "ghost"}
            size="icon"
            onClick={onToggleAi}
          >
            <Bot />
          </Button>
        </Tooltip>
        <Tooltip content={t("titleBar.toggleTheme")}>
          <Button
            variant="ghost"
            size="icon"
            onClick={() => setMode(resolved === "dark" ? "light" : "dark")}
          >
            {resolved === "dark" ? <Sun /> : <Moon />}
          </Button>
        </Tooltip>
        <Tooltip content={t("titleBar.settings")}>
          <Button variant="ghost" size="icon" onClick={onOpenSettings}>
            <Settings />
          </Button>
        </Tooltip>
      </div>
    </header>
  );
}
