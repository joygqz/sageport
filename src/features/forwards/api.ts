import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { ipc } from "@/lib/ipc";
import type { PortForwardInput } from "@/types/models";

export const forwardKeys = {
  list: ["forwards"] as const,
};

export function useForwards() {
  return useQuery({ queryKey: forwardKeys.list, queryFn: ipc.forwards.list });
}

export function useCreateForward() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: PortForwardInput) => ipc.forwards.create(input),
    onSuccess: () => qc.invalidateQueries({ queryKey: forwardKeys.list }),
  });
}

export function useUpdateForward() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, input }: { id: string; input: PortForwardInput }) =>
      ipc.forwards.update(id, input),
    onSuccess: () => qc.invalidateQueries({ queryKey: forwardKeys.list }),
  });
}

export function useDeleteForward() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => ipc.forwards.remove(id),
    onSuccess: () => qc.invalidateQueries({ queryKey: forwardKeys.list }),
  });
}
