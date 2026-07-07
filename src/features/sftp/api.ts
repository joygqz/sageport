import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { ipc } from "@/lib/ipc";

const historyKey = ["sftp", "transferHistory"] as const;

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
