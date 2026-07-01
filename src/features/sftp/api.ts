import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { ipc } from "@/lib/ipc";

const historyKey = ["sftp", "transferHistory"] as const;

/** Newest-first transfer history; only fetched while the dialog is open. Always
 * refetched on open (`staleTime: 0`) so a transfer that just finished shows up
 * immediately instead of using the global 30s cache. */
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
