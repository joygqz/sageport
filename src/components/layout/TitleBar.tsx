import { FolderSync, Moon, Settings, Sparkles, Sun } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Tooltip } from "@/components/ui/tooltip";
import { useI18n } from "@/i18n";
import { cn } from "@/lib/utils";
import { useTheme } from "@/theme/useTheme";
import { WindowHeader } from "./WindowHeader";

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
    <WindowHeader>
      <Tooltip
        content={sftpOpen ? t("titleBar.hideSftp") : t("titleBar.showSftp")}
      >
        <Button
          variant="ghost"
          size="icon"
          className={cn("size-7", sftpOpen && "bg-accent text-accent-foreground")}
          onClick={onToggleSftp}
        >
          <FolderSync />
        </Button>
      </Tooltip>
      <Tooltip content={aiOpen ? t("titleBar.hideAi") : t("titleBar.showAi")}>
        <Button
          variant="ghost"
          size="icon"
          className={cn("size-7", aiOpen && "bg-accent text-accent-foreground")}
          onClick={onToggleAi}
        >
          <Sparkles />
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
    </WindowHeader>
  );
}
