import { Bookmark, BookmarkPlus, Pencil, Trash2 } from "lucide-react";
import { useState } from "react";

import {
  Button,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
  Tooltip,
} from "@/components/ui";
import { useI18n } from "@/i18n";
import { errorMessage, toast } from "@/lib/toast";
import { useBookmarks, useCreateBookmark, useDeleteBookmark } from "./api";
import { BookmarkRenameDialog } from "./BookmarkRenameDialog";
import {
  pathBaseName,
  useSftpStore,
  type PaneSide,
  type SftpTab,
} from "./store";

export function BookmarkMenu({ side, tab }: { side: PaneSide; tab: SftpTab }) {
  const { t } = useI18n();
  const { data: bookmarks = [] } = useBookmarks();
  const createBookmark = useCreateBookmark();
  const deleteBookmark = useDeleteBookmark();
  const navigate = useSftpStore((s) => s.navigate);
  const [menuOpen, setMenuOpen] = useState(false);
  const [editing, setEditing] = useState<(typeof bookmarks)[number] | null>(
    null,
  );

  const hostId = tab.hostId ?? null;
  const scoped = bookmarks.filter((b) => (b.hostId ?? null) === hostId);
  const current = scoped.find((b) => b.path === tab.cwd);

  const addCurrent = () => {
    if (!tab.cwd) return;
    void createBookmark
      .mutateAsync({ hostId, label: pathBaseName(tab.cwd), path: tab.cwd })
      .catch((err) =>
        toast.error(t("sftp.bookmarks.error"), errorMessage(err)),
      );
  };

  return (
    <>
      <DropdownMenu open={menuOpen} onOpenChange={setMenuOpen}>
        <Tooltip content={t("sftp.bookmarks.title")}>
          <DropdownMenuTrigger asChild>
            <Button
              size="icon"
              variant="ghost"
              className="size-[var(--compact-control-size)]"
            >
              <Bookmark
                className="size-3.5"
                fill={current ? "currentColor" : "none"}
              />
            </Button>
          </DropdownMenuTrigger>
        </Tooltip>
        <DropdownMenuContent
          align="start"
          className="max-h-80 min-w-52 overflow-auto"
        >
          <DropdownMenuItem
            onSelect={addCurrent}
            disabled={!tab.cwd || !!current || createBookmark.isPending}
          >
            <BookmarkPlus /> {t("sftp.bookmarks.add")}
          </DropdownMenuItem>
          {scoped.length > 0 && <DropdownMenuSeparator />}
          {scoped.map((bookmark) => (
            <DropdownMenuItem
              key={bookmark.id}
              className="group/bm justify-between gap-2"
              onSelect={() => void navigate(side, tab.id, bookmark.path)}
            >
              <span className="min-w-0 flex-1 truncate">{bookmark.label}</span>
              <span className="bookmark-action pointer-events-none -ml-2 flex w-0 shrink-0 items-center gap-1 overflow-hidden opacity-0 transition-[width,opacity] group-hover/bm:pointer-events-auto group-hover/bm:ml-0 group-hover/bm:w-9 group-hover/bm:opacity-100 group-focus-within/bm:pointer-events-auto group-focus-within/bm:ml-0 group-focus-within/bm:w-9 group-focus-within/bm:opacity-100 group-focus/bm:pointer-events-auto group-focus/bm:ml-0 group-focus/bm:w-9 group-focus/bm:opacity-100">
                <button
                  type="button"
                  aria-label={t("sftp.bookmarks.rename")}
                  onClick={(event) => {
                    event.stopPropagation();
                    setMenuOpen(false);
                    setEditing(bookmark);
                  }}
                  className="flex size-4 items-center justify-center rounded text-muted-foreground outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/60"
                >
                  <Pencil className="size-3" />
                </button>
                <button
                  type="button"
                  aria-label={t("sftp.bookmarks.delete")}
                  onClick={(event) => {
                    event.stopPropagation();
                    setMenuOpen(false);
                    void deleteBookmark
                      .mutateAsync(bookmark.id)
                      .catch((err) => {
                        toast.error(
                          t("sftp.bookmarks.deleteError"),
                          errorMessage(err),
                        );
                      });
                  }}
                  className="flex size-4 items-center justify-center rounded text-muted-foreground outline-none hover:text-danger focus-visible:ring-2 focus-visible:ring-ring/60"
                >
                  <Trash2 className="size-3" />
                </button>
              </span>
            </DropdownMenuItem>
          ))}
        </DropdownMenuContent>
      </DropdownMenu>
      <BookmarkRenameDialog
        bookmark={editing}
        onClose={() => setEditing(null)}
      />
    </>
  );
}
