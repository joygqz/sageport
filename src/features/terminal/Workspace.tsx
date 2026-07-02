import { TerminalSquare, X } from "lucide-react";

import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { useI18n } from "@/i18n";
import { cn } from "@/lib/utils";
import { SessionOverlay } from "./SessionOverlay";
import { TerminalView } from "./Terminal";
import {
  useSessionStore,
  type SessionStatus,
  type TerminalSession,
} from "./sessionStore";

const statusColor: Record<SessionStatus, string> = {
  idle: "bg-muted-foreground/40",
  connecting: "bg-warning animate-pulse",
  connected: "bg-success",
  closed: "bg-muted-foreground/40",
  error: "bg-destructive",
};

export function Workspace({ onNewHost }: { onNewHost: () => void }) {
  const { t } = useI18n();
  const { sessions, activeId, setActive, close, reconnect } = useSessionStore();

  if (sessions.length === 0) {
    return (
      <div className="flex min-h-0 flex-1 items-center justify-center overflow-hidden bg-background">
        <EmptyState
          icon={TerminalSquare}
          title={t("workspace.emptyTitle")}
          action={
            <Button size="sm" onClick={onNewHost}>
              {t("common.newHost")}
            </Button>
          }
        />
      </div>
    );
  }

  return (
    <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden bg-background">
      <div className="flex h-9 items-center gap-1 overflow-x-auto border-b border-border bg-surface px-1.5">
        {sessions.map((session) => (
          <TabItem
            key={session.id}
            session={session}
            active={session.id === activeId}
            onSelect={() => setActive(session.id)}
            onClose={() => close(session.id)}
          />
        ))}
      </div>

      {/* The pane and its uniform p-2 gutter share --terminal-background with
          the xterm canvas, so the padding is invisible and the whole area
          swaps color in the same paint as the rest of the theme. */}
      <div className="relative min-h-0 flex-1 bg-terminal-background">
        {sessions.map((session) => (
          <div
            key={session.id}
            className={cn(
              "absolute inset-0 p-2",
              session.id === activeId ? "block" : "hidden",
            )}
          >
            <TerminalView
              sessionId={session.id}
              hostId={session.hostId}
              attempt={session.attempt}
            />
            <SessionOverlay
              status={session.status}
              title={session.title}
              error={session.error}
              onReconnect={() => reconnect(session.id)}
            />
          </div>
        ))}
      </div>
    </div>
  );
}

function TabItem({
  session,
  active,
  onSelect,
  onClose,
}: {
  session: TerminalSession;
  active: boolean;
  onSelect: () => void;
  onClose: () => void;
}) {
  return (
    <div
      onClick={onSelect}
      className={cn(
        "group flex h-7 cursor-default items-center gap-2 rounded-md px-2.5 text-xs font-medium transition-colors",
        active
          ? "bg-background text-foreground"
          : "text-muted-foreground hover:bg-background/50 hover:text-foreground",
      )}
    >
      <span
        className={cn("size-1.5 rounded-full", statusColor[session.status])}
      />
      <span className="max-w-40 truncate">{session.title}</span>
      <button
        onClick={(e) => {
          e.stopPropagation();
          onClose();
        }}
        className="rounded p-0.5 opacity-0 transition-opacity hover:bg-muted group-hover:opacity-100"
      >
        <X className="size-3" />
      </button>
    </div>
  );
}
