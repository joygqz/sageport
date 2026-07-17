import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { ipc } from "@/lib/ipc";
import type { SftpBookmarkInput, TransferHistoryEntry } from "@/types/models";

const historyKey = ["sftp", "transferHistory"] as const;
export const bookmarkKey = ["sftp", "bookmarks"] as const;

export function useBookmarks() {
  return useQuery({ queryKey: bookmarkKey, queryFn: ipc.bookmarks.list });
}

export function useCreateBookmark() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: SftpBookmarkInput) => ipc.bookmarks.create(input),
    onSuccess: () => qc.invalidateQueries({ queryKey: bookmarkKey }),
  });
}

export function useDeleteBookmark() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => ipc.bookmarks.remove(id),
    onSuccess: () => qc.invalidateQueries({ queryKey: bookmarkKey }),
  });
}

export function useTransferHistory(enabled: boolean) {
  return useQuery({
    queryKey: historyKey,
    queryFn: () => ipc.sftp.historyList(),
    enabled,
    staleTime: 0,
  });
}

export function useDeleteTransferHistory() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => ipc.sftp.historyDelete(id),
    onSuccess: () => qc.invalidateQueries({ queryKey: historyKey }),
  });
}

export function useClearTransferHistory() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => ipc.sftp.historyClear(),
    onSuccess: () => qc.invalidateQueries({ queryKey: historyKey }),
  });
}

export function useRetryTransfer() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (entry: TransferHistoryEntry) =>
      ipc.sftp.transfer(
        crypto.randomUUID(),
        {
          connectionId: entry.sourceConnectionId,
          path: entry.sourcePath,
        },
        { connectionId: entry.destConnectionId, path: entry.destPath },
      ),
    onSuccess: () => qc.invalidateQueries({ queryKey: historyKey }),
  });
}
