import { Loader2, PlugZap, ServerCrash } from "lucide-react";

import { Button } from "@/components/ui";
import { useI18n } from "@/i18n";
import { useTabsStore, type TerminalTab } from "@/workbench/tabs";
import { TerminalView } from "./TerminalView";

/**
 * One terminal editor: the xterm canvas inside a gutter painted with the
 * terminal background (so the padding is invisible), plus a full-pane
 * overlay for the non-interactive states (connecting / error / closed).
 */
export function TerminalEditor({ tab }: { tab: TerminalTab }) {
  const reconnect = useTabsStore((s) => s.reconnectTerminal);

  return (
    <div className="relative h-full w-full bg-terminal-background p-2">
      <TerminalView
        sessionId={tab.id}
        hostId={tab.hostId}
        attempt={tab.attempt}
      />
      <StatusOverlay tab={tab} onReconnect={() => reconnect(tab.id)} />
    </div>
  );
}

/**
 * Overlays the terminal while it has no live connection. Rendering status
 * here instead of writing lines into the terminal buffer keeps the
 * scrollback clean and always offers a recovery action.
 */
function StatusOverlay({
  tab,
  onReconnect,
}: {
  tab: TerminalTab;
  onReconnect: () => void;
}) {
  const { t } = useI18n();

  if (tab.status === "connecting") {
    return (
      <Shell>
        <Loader2 className="size-7 animate-spin text-primary" />
        <p className="text-sm font-medium text-foreground">
          {t("terminal.connecting", { host: tab.title })}
        </p>
      </Shell>
    );
  }

  if (tab.status === "error") {
    return (
      <Shell>
        <span className="flex size-12 items-center justify-center rounded-full bg-destructive/10 text-destructive">
          <ServerCrash className="size-6" />
        </span>
        <p className="text-sm font-semibold text-foreground">
          {t("terminal.connectFailed")}
        </p>
        {tab.error && (
          <p className="max-w-md break-words text-center font-mono text-xs leading-relaxed text-destructive">
            {tab.error}
          </p>
        )}
        <Button size="sm" variant="outline" onClick={onReconnect}>
          {t("terminal.reconnect")}
        </Button>
      </Shell>
    );
  }

  if (tab.status === "closed") {
    return (
      <Shell>
        <span className="flex size-12 items-center justify-center rounded-full bg-muted text-muted-foreground">
          <PlugZap className="size-6" />
        </span>
        <p className="text-sm font-medium text-foreground">
          {t("terminal.closed")}
        </p>
        <Button size="sm" variant="outline" onClick={onReconnect}>
          {t("terminal.reconnect")}
        </Button>
      </Shell>
    );
  }

  return null;
}

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <div className="absolute inset-0 z-10 flex flex-col items-center justify-center gap-3 bg-background/85 backdrop-blur-sm">
      {children}
    </div>
  );
}
