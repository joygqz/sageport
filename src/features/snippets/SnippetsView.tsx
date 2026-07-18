import { useMemo, useState } from "react";
import {
  Pencil,
  Play,
  Plus,
  History,
  Server,
  SquareTerminal,
  Terminal,
  Trash2,
} from "lucide-react";

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
import { errorMessage, toast } from "@/lib/toast";
import { cn } from "@/lib/utils";
import type { Snippet } from "@/types/models";
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
import { useTabsStore } from "@/workbench/tabs";
import { useDeleteSnippet, useSnippets } from "./api";
import { BatchRunDialog } from "./BatchRunDialog";
import { CommandHistoryDialog } from "./CommandHistoryDialog";
import { SnippetFormDialog } from "./SnippetFormDialog";
import { SnippetRunDialog } from "./SnippetRunDialog";
import { parseVariables } from "./variables";

export function SnippetsView() {
  const { t } = useI18n();
  const { data: snippets = [], isLoading, isError, refetch } = useSnippets();
  const deleteSnippet = useDeleteSnippet();
  const sendToTerminal = useTabsStore((s) => s.sendToTerminal);

  const [form, setForm] = useState<{ open: boolean; snippet: Snippet | null }>({
    open: false,
    snippet: null,
  });
  const [confirmState, setConfirmState] = useState<ConfirmState | null>(null);
  const [runRequest, setRunRequest] = useState<{
    snippet: Snippet;
    target: "terminal" | "batch";
  } | null>(null);
  const [batchCommand, setBatchCommand] = useState<string | null>(null);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [query, setQuery] = useState("");
  const searching = query.trim().length > 0;

  const filteredSnippets = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return snippets;
    return snippets.filter((snippet) =>
      [snippet.name, snippet.command, snippet.description ?? ""].some((value) =>
        value.toLowerCase().includes(q),
      ),
    );
  }, [query, snippets]);

  const send = (command: string) => {
    const result = sendToTerminal(command);
    if (result === "sent") {
      toast.success(t("snippets.sent"));
    } else {
      toast.error(
        t(
          result === "not-connected"
            ? "snippets.notConnected"
            : "snippets.noTerminal",
        ),
      );
    }
  };

  const dispatchRun = (target: "terminal" | "batch", command: string) => {
    if (target === "batch") setBatchCommand(command);
    else send(command);
  };

  const run = (snippet: Snippet, target: "terminal" | "batch" = "terminal") => {
    if (parseVariables(snippet.command).length > 0) {
      setRunRequest({ snippet, target });
    } else {
      dispatchRun(target, snippet.command);
    }
  };

  const requestDelete = (snippet: Snippet) => {
    setConfirmState({
      title: t("snippets.delete.title"),
      description: t("common.deleteConfirm", { name: snippet.name }),
      cancelLabel: t("common.cancel"),
      actions: [
        {
          label: t("snippets.delete.action"),
          variant: "destructive",
          onSelect: () =>
            void deleteSnippet.mutateAsync(snippet.id).catch((err) => {
              toast.error(t("snippets.delete.error"), errorMessage(err));
            }),
        },
      ],
    });
  };

  return (
    <SideBarView
      title={t("snippets.viewTitle")}
      actions={
        <>
          <Tooltip content={t("snippets.history.title")}>
            <Button
              size="icon"
              variant="ghost"
              className={PANEL_HEADER_ACTION_CLASS}
              onClick={() => setHistoryOpen(true)}
            >
              <History className="size-4" />
            </Button>
          </Tooltip>
          <Tooltip content={t("snippets.new")}>
            <Button
              size="icon"
              variant="ghost"
              className={PANEL_HEADER_ACTION_CLASS}
              onClick={() => setForm({ open: true, snippet: null })}
            >
              <Plus className="size-4" />
            </Button>
          </Tooltip>
        </>
      }
      topContent={
        <SideBarFilter
          itemCount={snippets.length}
          value={query}
          onChange={setQuery}
          placeholder={t("snippets.filterPlaceholder")}
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
        ) : filteredSnippets.length === 0 ? (
          <EmptyState
            icon={SquareTerminal}
            title={
              searching ? t("snippets.noMatches") : t("snippets.empty.title")
            }
            description={
              searching ? undefined : t("snippets.empty.description")
            }
            action={
              !searching && (
                <Button
                  size="sm"
                  onClick={() => setForm({ open: true, snippet: null })}
                >
                  <Plus /> {t("snippets.new")}
                </Button>
              )
            }
            fill={!searching}
          />
        ) : (
          filteredSnippets.map((snippet) => (
            <ContextMenu key={snippet.id}>
              <ContextMenuTrigger asChild>
                <div
                  onDoubleClick={(event) => {
                    if ((event.target as HTMLElement).closest("button")) return;
                    run(snippet);
                  }}
                  className={cn(PANEL_LIST_ITEM_CLASS, "cursor-pointer")}
                >
                  <div className={PANEL_LIST_ICON_CLASS}>
                    <Terminal className="size-4" strokeWidth={1.7} />
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium text-foreground">
                      {snippet.name}
                    </p>
                    <p className="truncate font-mono text-2xs text-muted-foreground">
                      {snippet.command}
                    </p>
                  </div>
                  <Tooltip content={t("snippets.run")}>
                    <button
                      type="button"
                      onClick={() => run(snippet)}
                      className={PANEL_LIST_ACTION_CLASS}
                    >
                      <Play className="size-3.5" />
                    </button>
                  </Tooltip>
                </div>
              </ContextMenuTrigger>
              <ContextMenuContent>
                <ContextMenuItem onSelect={() => run(snippet)}>
                  <Play /> {t("snippets.run")}
                </ContextMenuItem>
                <ContextMenuItem onSelect={() => run(snippet, "batch")}>
                  <Server /> {t("snippets.batch.action")}
                </ContextMenuItem>
                <ContextMenuItem
                  onSelect={() => setForm({ open: true, snippet })}
                >
                  <Pencil /> {t("common.edit")}
                </ContextMenuItem>
                <ContextMenuSeparator />
                <ContextMenuItem
                  destructive
                  onSelect={() => requestDelete(snippet)}
                >
                  <Trash2 /> {t("common.delete")}
                </ContextMenuItem>
              </ContextMenuContent>
            </ContextMenu>
          ))
        )}
      </PanelContent>

      <SnippetFormDialog
        open={form.open}
        snippet={form.snippet}
        onClose={() => setForm((s) => ({ ...s, open: false }))}
      />
      <ConfirmDialog
        state={confirmState}
        onClose={() => setConfirmState(null)}
      />
      <SnippetRunDialog
        snippet={runRequest?.snippet ?? null}
        onClose={() => setRunRequest(null)}
        onRun={(command) =>
          dispatchRun(runRequest?.target ?? "terminal", command)
        }
      />
      <BatchRunDialog
        open={batchCommand !== null}
        initialCommand={batchCommand ?? ""}
        onClose={() => setBatchCommand(null)}
      />
      <CommandHistoryDialog open={historyOpen} onOpenChange={setHistoryOpen} />
    </SideBarView>
  );
}
