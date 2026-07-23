import { Bookmark, BookmarkPlus, Trash2 } from "lucide-react";

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
    <DropdownMenu>
      <Tooltip content={t("sftp.bookmarks.title")}>
        <DropdownMenuTrigger asChild>
          <Button size="icon" variant="ghost" className="size-6">
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
            <button
              type="button"
              aria-label={t("sftp.bookmarks.delete")}
              onClick={(e) => {
                e.stopPropagation();
                void deleteBookmark.mutateAsync(bookmark.id).catch((err) => {
                  toast.error(
                    t("sftp.bookmarks.deleteError"),
                    errorMessage(err),
                  );
                });
              }}
              className="bookmark-action pointer-events-none -ml-2 flex h-4 w-0 shrink-0 items-center justify-center overflow-hidden rounded text-muted-foreground opacity-0 outline-none transition-[color,opacity] hover:text-danger focus-visible:pointer-events-auto focus-visible:ml-0 focus-visible:w-4 focus-visible:opacity-100 focus-visible:ring-2 focus-visible:ring-ring/60 group-hover/bm:pointer-events-auto group-hover/bm:ml-0 group-hover/bm:w-4 group-hover/bm:opacity-100 group-focus/bm:pointer-events-auto group-focus/bm:ml-0 group-focus/bm:w-4 group-focus/bm:opacity-100"
            >
              <Trash2 className="size-3" />
            </button>
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
