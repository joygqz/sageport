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
import type { PaneSide, SftpTab } from "./store";
import { useSftpStore } from "./store";

function baseName(path: string): string {
  const trimmed = path.replace(/\/+$/, "");
  const name = trimmed.split("/").pop();
  return name && name.length > 0 ? name : path;
}

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
      .mutateAsync({ hostId, label: baseName(tab.cwd), path: tab.cwd })
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
          disabled={!tab.cwd || !!current}
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
              aria-label={t("common.delete")}
              onClick={(e) => {
                e.stopPropagation();
                void deleteBookmark.mutateAsync(bookmark.id).catch(() => {});
              }}
              className="shrink-0 rounded p-0.5 text-muted-foreground opacity-0 outline-none transition-[color,opacity] hover:text-danger focus-visible:ring-2 focus-visible:ring-ring/35 group-hover/bm:opacity-100 group-focus/bm:opacity-100"
            >
              <Trash2 className="size-3" />
            </button>
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
