import { useEffect, useMemo, useState } from "react";
import {
  Circle,
  Network,
  Pencil,
  Play,
  Plus,
  Square,
  Trash2,
} from "lucide-react";

import { useHostKeyStore } from "@/features/terminal/host-key";
import { usePasswordPromptStore } from "@/features/terminal/password-prompt";

import {
  Button,
  ConfirmDialog,
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuTrigger,
  EmptyState,
  ErrorState,
  LoadingState,
  Tooltip,
  type ConfirmState,
} from "@/components/ui";
import { useI18n } from "@/i18n";
import { ipc } from "@/lib/ipc";
import { cn } from "@/lib/utils";
import { errorMessage, toast } from "@/lib/toast";
import type { PortForward } from "@/types/models";
import {
  PanelContent,
  PANEL_HEADER_ACTION_CLASS,
  PANEL_LIST_ACTION_CLASS,
  PANEL_LIST_CLASS,
  PANEL_LIST_ICON_CLASS,
  PANEL_LIST_ITEM_CLASS,
} from "@/workbench/PanelHeader";
import { SideBarView } from "@/workbench/SideBarView";
import { SideBarFilter } from "@/workbench/SideBarFilter";
import { useForwards, useDeleteForward } from "./api";
import { ForwardFormDialog } from "./ForwardFormDialog";
import { formatForwardEndpoint } from "./forwardForm";
import { bridgeForwardEvents, useForwardStore } from "./store";

export function ForwardsView() {
  const { t } = useI18n();
  const { data: forwards = [], isLoading, isError, refetch } = useForwards();
  const deleteForward = useDeleteForward();
  const runtime = useForwardStore((s) => s.runtime);

  const [form, setForm] = useState<{
    open: boolean;
    forward: PortForward | null;
  }>({ open: false, forward: null });
  const [confirmState, setConfirmState] = useState<ConfirmState | null>(null);
  const [query, setQuery] = useState("");
  const searching = query.trim().length > 0;

  useEffect(() => {
    void bridgeForwardEvents().catch((err) => {
      toast.error(t("forwards.statusError"), errorMessage(err));
    });
  }, [t]);

  const isActive = (id: string) => {
    const status = runtime[id]?.status;
    return status === "active" || status === "starting";
  };

  const toggle = async (forward: PortForward) => {
    if (isActive(forward.id)) {
      useHostKeyStore.getState().rejectSession(forward.id);
      usePasswordPromptStore.getState().cancelSession(forward.id);
      try {
        await ipc.forwards.stop(forward.id);
      } catch (err) {
        toast.error(t("forwards.stopError"), errorMessage(err));
      }
    } else {
      try {
        await ipc.forwards.start(forward.id);
      } catch (err) {
        toast.error(t("forwards.startError"), errorMessage(err));
      }
    }
  };

  const requestDelete = (forward: PortForward) => {
    setConfirmState({
      title: t("forwards.delete.title"),
      description: t("common.deleteConfirm", { name: forward.label }),
      cancelLabel: t("common.cancel"),
      actions: [
        {
          label: t("common.delete"),
          variant: "destructive",
          onSelect: () =>
            void deleteForward.mutateAsync(forward.id).catch((err) => {
              toast.error(t("forwards.delete.error"), errorMessage(err));
            }),
        },
      ],
    });
  };

  const describe = (forward: PortForward) => {
    if (forward.kind === "dynamic") {
      return `SOCKS ${formatForwardEndpoint(forward.bindHost, forward.bindPort)}`;
    }
    return `${formatForwardEndpoint(forward.bindHost, forward.bindPort)} → ${formatForwardEndpoint(forward.targetHost ?? "", forward.targetPort ?? 0)}`;
  };

  const filteredForwards = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return forwards;
    return forwards.filter((forward) =>
      [forward.label, forward.kind, describe(forward)].some((value) =>
        value.toLowerCase().includes(q),
      ),
    );
  }, [forwards, query]);

  return (
    <SideBarView
      title={t("forwards.viewTitle")}
      actions={
        <Tooltip content={t("forwards.new")}>
          <Button
            size="icon"
            variant="ghost"
            className={PANEL_HEADER_ACTION_CLASS}
            onClick={() => setForm({ open: true, forward: null })}
          >
            <Plus className="size-4" />
          </Button>
        </Tooltip>
      }
      topContent={
        <SideBarFilter
          itemCount={forwards.length}
          value={query}
          onChange={setQuery}
          placeholder={t("forwards.filterPlaceholder")}
        />
      }
    >
      <PanelContent className={PANEL_LIST_CLASS}>
        {isLoading ? (
          <LoadingState label={t("common.loading")} fill />
        ) : isError ? (
          <ErrorState
            title={t("common.loadError")}
            retryLabel={t("common.retry")}
            onRetry={() => void refetch()}
            fill
          />
        ) : filteredForwards.length === 0 ? (
          <EmptyState
            icon={Network}
            title={
              searching ? t("forwards.noMatches") : t("forwards.empty.title")
            }
            description={
              searching ? undefined : t("forwards.empty.description")
            }
            action={
              !searching && (
                <Button
                  size="sm"
                  onClick={() => setForm({ open: true, forward: null })}
                >
                  <Plus /> {t("forwards.new")}
                </Button>
              )
            }
            fill={!searching}
          />
        ) : (
          filteredForwards.map((forward) => {
            const active = isActive(forward.id);
            const errored = runtime[forward.id]?.status === "error";
            const statusMessage = errored
              ? runtime[forward.id]?.message
              : undefined;
            return (
              <ContextMenu key={forward.id}>
                <ContextMenuTrigger asChild>
                  <div
                    className={cn(PANEL_LIST_ITEM_CLASS, "cursor-pointer")}
                    title={statusMessage}
                    onDoubleClick={(event) => {
                      if ((event.target as HTMLElement).closest("button"))
                        return;
                      void toggle(forward);
                    }}
                  >
                    <div
                      className={cn(
                        PANEL_LIST_ICON_CLASS,
                        "relative",
                        active && "bg-success/10 text-success",
                        errored && "bg-danger/10 text-danger",
                      )}
                    >
                      <Network className="size-4" strokeWidth={1.7} />
                      <Circle
                        className={cn(
                          "absolute -bottom-0.5 -right-0.5 size-2 fill-current ring-2 ring-surface group-hover:ring-list-hover group-focus-within:ring-list-hover",
                          active
                            ? "text-success"
                            : errored
                              ? "text-destructive"
                              : "text-muted-foreground/55",
                        )}
                      />
                    </div>
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-medium text-foreground">
                        {forward.label}
                      </p>
                      <p
                        className={cn(
                          "truncate text-2xs text-muted-foreground",
                          !statusMessage && "font-mono",
                          errored && "text-danger",
                        )}
                      >
                        {statusMessage ??
                          (runtime[forward.id]?.status === "starting"
                            ? t("forwards.starting")
                            : describe(forward))}
                      </p>
                    </div>
                    <Tooltip
                      content={
                        active ? t("forwards.stop") : t("forwards.start")
                      }
                    >
                      <button
                        type="button"
                        onClick={() => void toggle(forward)}
                        className={PANEL_LIST_ACTION_CLASS}
                      >
                        {active ? (
                          <Square className="size-3.5" />
                        ) : (
                          <Play className="size-3.5" />
                        )}
                      </button>
                    </Tooltip>
                  </div>
                </ContextMenuTrigger>
                <ContextMenuContent>
                  <ContextMenuItem onSelect={() => void toggle(forward)}>
                    {active ? <Square /> : <Play />}
                    {active ? t("forwards.stop") : t("forwards.start")}
                  </ContextMenuItem>
                  <ContextMenuItem
                    onSelect={() => setForm({ open: true, forward })}
                  >
                    <Pencil />
                    {t("common.edit")}
                  </ContextMenuItem>
                  <ContextMenuSeparator />
                  <ContextMenuItem
                    destructive
                    onSelect={() => requestDelete(forward)}
                  >
                    <Trash2 />
                    {t("common.delete")}
                  </ContextMenuItem>
                </ContextMenuContent>
              </ContextMenu>
            );
          })
        )}
      </PanelContent>

      <ForwardFormDialog
        open={form.open}
        forward={form.forward}
        onClose={() => setForm((s) => ({ ...s, open: false }))}
      />
      <ConfirmDialog
        state={confirmState}
        onClose={() => setConfirmState(null)}
      />
    </SideBarView>
  );
}
