import { Loader2, PlugZap, ServerCrash } from "lucide-react";

import { Button } from "@/components/ui/button";
import { useI18n } from "@/i18n";
import type { SessionStatus } from "./sessionStore";

/**
 * Full-pane overlay that communicates a session's non-interactive states
 * (connecting / error / closed) on top of its xterm instance. For `connected`
 * and `idle` it renders nothing, leaving the live terminal fully visible.
 *
 * This replaces the old approach of writing status lines into the terminal
 * buffer, which scrolled away and offered no recovery path.
 */
export function SessionOverlay({
  status,
  title,
  error,
  onReconnect,
}: {
  status: SessionStatus;
  title: string;
  error?: string;
  onReconnect: () => void;
}) {
  const { t } = useI18n();

  if (status === "connecting") {
    return (
      <Shell>
        <Loader2 className="size-7 animate-spin text-primary" />
        <p className="text-sm font-medium text-foreground">
          {t("workspace.connecting", { host: title })}
        </p>
      </Shell>
    );
  }

  if (status === "error") {
    return (
      <Shell>
        <span className="flex size-12 items-center justify-center rounded-full bg-destructive/10 text-destructive">
          <ServerCrash className="size-6" />
        </span>
        <p className="text-sm font-semibold text-foreground">
          {t("workspace.connectFailed")}
        </p>
        {error && (
          <p className="max-w-md break-words text-center font-mono text-xs leading-relaxed text-destructive">
            {error}
          </p>
        )}
        <Button size="sm" variant="outline" onClick={onReconnect}>
          {t("workspace.reconnect")}
        </Button>
      </Shell>
    );
  }

  if (status === "closed") {
    return (
      <Shell>
        <span className="flex size-12 items-center justify-center rounded-full bg-muted text-muted-foreground">
          <PlugZap className="size-6" />
        </span>
        <p className="text-sm font-medium text-foreground">
          {t("workspace.closed")}
        </p>
        <Button size="sm" variant="outline" onClick={onReconnect}>
          {t("workspace.reconnect")}
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
