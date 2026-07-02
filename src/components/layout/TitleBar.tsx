import { Bot, Folder, Moon, Settings, Sun } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Tooltip } from "@/components/ui/tooltip";
import { useI18n } from "@/i18n";
import { useTheme } from "@/theme/useTheme";

export function TitleBar({
  onOpenSettings,
  onToggleAi,
  aiOpen,
  onToggleSftp,
  sftpOpen,
}: {
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
      className="flex h-9 shrink-0 items-center gap-2 border-b border-border bg-surface pl-20 pr-2"
    >
      <span className="pointer-events-none text-sm font-medium text-surface-foreground">
        Sageport
      </span>
      <div className="ml-auto flex items-center gap-1" data-tauri-drag-region>
        <Tooltip
          content={sftpOpen ? t("titleBar.hideSftp") : t("titleBar.showSftp")}
        >
          <Button
            variant={sftpOpen ? "secondary" : "ghost"}
            size="icon"
            className="size-7"
            onClick={onToggleSftp}
          >
            <Folder />
          </Button>
        </Tooltip>
        <Tooltip content={aiOpen ? t("titleBar.hideAi") : t("titleBar.showAi")}>
          <Button
            variant={aiOpen ? "secondary" : "ghost"}
            size="icon"
            className="size-7"
            onClick={onToggleAi}
          >
            <Bot />
          </Button>
        </Tooltip>
        <Tooltip content={t("titleBar.toggleTheme")}>
          <Button
            variant="ghost"
            size="icon"
            className="size-7"
            onClick={() => setMode(resolved === "dark" ? "light" : "dark")}
          >
            {resolved === "dark" ? <Sun /> : <Moon />}
          </Button>
        </Tooltip>
        <Tooltip content={t("titleBar.settings")}>
          <Button
            variant="ghost"
            size="icon"
            className="size-7"
            onClick={onOpenSettings}
          >
            <Settings />
          </Button>
        </Tooltip>
      </div>
    </header>
  );
}
