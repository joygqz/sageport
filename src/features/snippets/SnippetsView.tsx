import { useState } from "react";
import { Pencil, Play, Plus, SquareTerminal, Trash2 } from "lucide-react";

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
import { errorMessage, toast } from "@/lib/toast";
import type { Snippet } from "@/types/models";
import { SideBarView } from "@/workbench/SideBarView";
import { useTabsStore } from "@/workbench/tabs";
import { useDeleteSnippet, useSnippets } from "./api";
import { SnippetFormDialog } from "./SnippetFormDialog";

/**
 * Snippets view: saved commands that run in the current terminal with one
 * click or a double-click on the row.
 */
export function SnippetsView() {
  const { t } = useI18n();
  const { data: snippets = [] } = useSnippets();
  const deleteSnippet = useDeleteSnippet();
  const sendToTerminal = useTabsStore((s) => s.sendToTerminal);

  const [form, setForm] = useState<{ open: boolean; snippet: Snippet | null }>({
    open: false,
    snippet: null,
  });
  const [confirmState, setConfirmState] = useState<ConfirmState | null>(null);

  const run = (snippet: Snippet) => {
    if (sendToTerminal(snippet.command)) {
      toast.success(t("snippets.sent"));
    } else {
      toast.error(t("snippets.noTerminal"));
    }
  };

  const requestDelete = (snippet: Snippet) => {
    setConfirmState({
      title: t("snippets.delete.title"),
      description: t("snippets.delete.description", { name: snippet.name }),
      cancelLabel: t("common.cancel"),
      actions: [
        {
          label: t("common.delete"),
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
        <Tooltip content={t("snippets.new")}>
          <Button
            size="icon"
            variant="ghost"
            className="size-6"
            onClick={() => setForm({ open: true, snippet: null })}
          >
            <Plus className="size-4" />
          </Button>
        </Tooltip>
      }
    >
      <div className="px-1 pb-4">
        {snippets.length === 0 ? (
          <EmptyState
            icon={SquareTerminal}
            title={t("snippets.empty.title")}
            description={t("snippets.empty.description")}
            action={
              <Button
                size="sm"
                onClick={() => setForm({ open: true, snippet: null })}
              >
                <Plus /> {t("snippets.new")}
              </Button>
            }
          />
        ) : (
          snippets.map((snippet) => (
            <ContextMenu key={snippet.id}>
              <ContextMenuTrigger asChild>
                <div
                  onDoubleClick={() => run(snippet)}
                  className="group flex cursor-pointer items-center gap-2 rounded-md px-2 py-1.5 hover:bg-list-hover"
                >
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm">{snippet.name}</p>
                    <p className="truncate font-mono text-2xs text-muted-foreground">
                      {snippet.command}
                    </p>
                  </div>
                  <Tooltip content={t("snippets.run")}>
                    <button
                      onClick={() => run(snippet)}
                      className="shrink-0 rounded p-1 text-muted-foreground opacity-0 transition-opacity hover:bg-accent hover:text-accent-foreground group-hover:opacity-100"
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
      </div>

      <SnippetFormDialog
        open={form.open}
        snippet={form.snippet}
        onClose={() => setForm((s) => ({ ...s, open: false }))}
      />
      <ConfirmDialog
        state={confirmState}
        onClose={() => setConfirmState(null)}
      />
    </SideBarView>
  );
}
