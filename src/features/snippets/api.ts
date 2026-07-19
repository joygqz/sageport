import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { ipc } from "@/lib/ipc";
import type { SnippetInput } from "@/types/models";

export const snippetsKey = ["snippets"] as const;
const commandHistoryKey = ["commandHistory"] as const;

export function useSnippets() {
  return useQuery({ queryKey: snippetsKey, queryFn: ipc.snippets.list });
}

export function useCreateSnippet() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: SnippetInput) => ipc.snippets.create(input),
    onSuccess: () => qc.invalidateQueries({ queryKey: snippetsKey }),
  });
}

export function useUpdateSnippet() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, input }: { id: string; input: SnippetInput }) =>
      ipc.snippets.update(id, input),
    onSuccess: () => qc.invalidateQueries({ queryKey: snippetsKey }),
  });
}

export function useDeleteSnippet() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => ipc.snippets.remove(id),
    onSuccess: () => qc.invalidateQueries({ queryKey: snippetsKey }),
  });
}

export function useCommandHistory(
  hostId: string | null,
  query: string,
  enabled: boolean,
) {
  return useQuery({
    queryKey: [...commandHistoryKey, hostId, query],
    queryFn: () => ipc.history.list(hostId, query, 500),
    enabled,
  });
}

export function useClearCommandHistory() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ipc.history.clear,
    onSuccess: () => qc.invalidateQueries({ queryKey: commandHistoryKey }),
  });
}
