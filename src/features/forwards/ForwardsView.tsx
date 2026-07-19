import { useEffect, useMemo, useState } from "react";
import { Network, Pencil, Play, Plus, Square, Trash2 } from "lucide-react";

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

const PUBLIC_FORWARDING_ADMIN_COMMAND = `test "$(id -u)" = 0 && sageport_run= || sageport_run=sudo
$sageport_run install -d -m 0755 /etc/ssh/sshd_config.d &&
echo 'GatewayPorts clientspecified' | $sageport_run tee /etc/ssh/sshd_config.d/00-00-sageport-gateway-ports.conf >/dev/null &&
$sageport_run sshd -t &&
$sageport_run sshd -T | grep -qx 'gatewayports clientspecified' &&
$sageport_run sh -c 'systemctl reload sshd 2>/dev/null || systemctl reload ssh 2>/dev/null || service sshd reload 2>/dev/null || service ssh reload'`;
const promptedPublicForwardingGenerations = new Map<string, number>();

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

  useEffect(() => {
    if (confirmState) return;
    const forward = forwards.find((candidate) => {
      const state = runtime[candidate.id];
      return (
        (state?.status === "active" || state?.status === "error") &&
        state.publicBindRestricted &&
        promptedPublicForwardingGenerations.get(candidate.id) !==
          state.generation
      );
    });
    if (!forward) return;
    const state = runtime[forward.id];
    let cancelled = false;
    queueMicrotask(() => {
      if (cancelled) return;
      promptedPublicForwardingGenerations.set(forward.id, state.generation);
      setConfirmState({
        title: t("forwards.gatewayPorts.title"),
        description: (
          <span className="block min-w-0 max-w-full space-y-3">
            <span className="block break-words">
              {t("forwards.gatewayPorts.description", {
                name: forward.label,
                endpoint: formatForwardEndpoint(
                  forward.bindHost,
                  forward.bindPort,
                ),
              })}
            </span>
            <code className="block max-h-64 w-full min-w-0 max-w-full select-text overflow-auto whitespace-pre rounded-md bg-terminal-background p-3 text-left font-mono text-xs leading-relaxed text-terminal-foreground">
              {PUBLIC_FORWARDING_ADMIN_COMMAND}
            </code>
            <span className="block">
              {t("forwards.gatewayPorts.restartHint")}
            </span>
          </span>
        ),
        cancelLabel: t("common.close"),
        contentClassName: "max-w-2xl overflow-x-hidden",
        actions: [
          {
            label: t("forwards.gatewayPorts.copyCommand"),
            onSelect: async () => {
              try {
                await navigator.clipboard.writeText(
                  PUBLIC_FORWARDING_ADMIN_COMMAND,
                );
                toast.success(t("forwards.gatewayPorts.commandCopied"));
              } catch (err) {
                toast.error(
                  t("forwards.gatewayPorts.copyError"),
                  errorMessage(err),
                );
                return false;
              }
            },
          },
        ],
      });
    });
    return () => {
      cancelled = true;
    };
  }, [confirmState, forwards, runtime, t]);

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
          label: t("forwards.delete.action"),
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
    const prefix = forward.kind === "remote" ? "R" : "L";
    return `${prefix} ${formatForwardEndpoint(forward.bindHost, forward.bindPort)} → ${formatForwardEndpoint(forward.targetHost ?? "", forward.targetPort ?? 0)}`;
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
            aria-label={t("forwards.new")}
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
                      <span
                        className={cn(
                          "absolute -bottom-0.5 -right-0.5 size-2 rounded-full ring-2 ring-surface group-hover:ring-list-hover group-focus-within:ring-list-hover",
                          active
                            ? "bg-success"
                            : errored
                              ? "bg-destructive"
                              : "bg-muted-foreground/55",
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
                        aria-label={
                          active ? t("forwards.stop") : t("forwards.start")
                        }
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
