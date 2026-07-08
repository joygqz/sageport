import { useEffect, useState } from "react";
import { Circle, Network, Play, Plus, Square } from "lucide-react";

import { useHostKeyStore } from "@/features/terminal/host-key";

import {
  Button,
  ConfirmDialog,
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuTrigger,
  EmptyState,
  Tooltip,
  type ConfirmState,
} from "@/components/ui";
import { useI18n } from "@/i18n";
import { ipc } from "@/lib/ipc";
import { cn } from "@/lib/utils";
import { errorMessage, toast } from "@/lib/toast";
import type { PortForward } from "@/types/models";
import { SideBarView } from "@/workbench/SideBarView";
import { useForwards, useDeleteForward } from "./api";
import { ForwardFormDialog } from "./ForwardFormDialog";
import { bridgeForwardEvents, useForwardStore } from "./store";

export function ForwardsView() {
  const { t } = useI18n();
  const { data: forwards = [] } = useForwards();
  const deleteForward = useDeleteForward();
  const runtime = useForwardStore((s) => s.runtime);

  const [form, setForm] = useState<{
    open: boolean;
    forward: PortForward | null;
  }>({ open: false, forward: null });
  const [confirmState, setConfirmState] = useState<ConfirmState | null>(null);

  useEffect(() => {
    bridgeForwardEvents();
  }, []);

  const isActive = (id: string) => {
    const status = runtime[id]?.status;
    return status === "active" || status === "starting";
  };

  const toggle = (forward: PortForward) => {
    if (isActive(forward.id)) {
      void ipc.forwards.stop(forward.id).catch(() => {});
      useHostKeyStore.getState().rejectSession(forward.id);
    } else {
      void ipc.forwards.start(forward.id).catch((err) => {
        toast.error(t("forwards.startError"), errorMessage(err));
      });
    }
  };

  const requestDelete = (forward: PortForward) => {
    setConfirmState({
      title: t("forwards.delete.title"),
      description: t("forwards.delete.description", { name: forward.label }),
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
      return `SOCKS ${forward.bindHost}:${forward.bindPort}`;
    }
    return `${forward.bindHost}:${forward.bindPort} → ${forward.targetHost}:${forward.targetPort}`;
  };

  return (
    <SideBarView
      title={t("forwards.viewTitle")}
      actions={
        <Tooltip content={t("forwards.new")}>
          <Button
            size="icon"
            variant="ghost"
            className="size-6"
            onClick={() => setForm({ open: true, forward: null })}
          >
            <Plus className="size-4" />
          </Button>
        </Tooltip>
      }
    >
      <div className="px-1 pb-4">
        {forwards.length === 0 ? (
          <EmptyState
            icon={Network}
            title={t("forwards.empty.title")}
            description={t("forwards.empty.description")}
            action={
              <Button
                size="sm"
                onClick={() => setForm({ open: true, forward: null })}
              >
                <Plus /> {t("forwards.new")}
              </Button>
            }
          />
        ) : (
          forwards.map((forward) => {
            const active = isActive(forward.id);
            const errored = runtime[forward.id]?.status === "error";
            const statusMessage = errored
              ? runtime[forward.id]?.message
              : undefined;
            return (
              <ContextMenu key={forward.id}>
                <ContextMenuTrigger asChild>
                  <div
                    className="group flex items-center gap-2 rounded-md px-2 py-1.5 hover:bg-list-hover"
                    title={statusMessage}
                  >
                    <Circle
                      className={cn(
                        "size-2 shrink-0 fill-current",
                        active
                          ? "text-success"
                          : errored
                            ? "text-destructive"
                            : "text-muted-foreground/40",
                      )}
                    />
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm">{forward.label}</p>
                      <p className="truncate font-mono text-2xs text-muted-foreground">
                        {describe(forward)}
                      </p>
                    </div>
                    <Tooltip
                      content={
                        active ? t("forwards.stop") : t("forwards.start")
                      }
                    >
                      <button
                        onClick={() => toggle(forward)}
                        className="shrink-0 rounded p-1 text-muted-foreground opacity-0 transition-opacity hover:bg-accent hover:text-accent-foreground group-hover:opacity-100"
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
                  <ContextMenuItem onSelect={() => toggle(forward)}>
                    {active ? t("forwards.stop") : t("forwards.start")}
                  </ContextMenuItem>
                  <ContextMenuItem
                    onSelect={() => setForm({ open: true, forward })}
                  >
                    {t("common.edit")}
                  </ContextMenuItem>
                  <ContextMenuSeparator />
                  <ContextMenuItem
                    destructive
                    onSelect={() => requestDelete(forward)}
                  >
                    {t("common.delete")}
                  </ContextMenuItem>
                </ContextMenuContent>
              </ContextMenu>
            );
          })
        )}
      </div>

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
