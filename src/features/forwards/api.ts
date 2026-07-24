import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { ipc } from "@/lib/ipc";
import type { PortForwardInput } from "@/types/models";
import { useForwardStore } from "./store";

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
    // Runtime status is owned by the backend: forwards_update emits an
    // authoritative status after saving (restart events for an active forward,
    // otherwise "stopped"). Don't clear it here — doing so raced those events
    // and could leave the UI closed/stuck while the forward is really running.
    onSuccess: () => qc.invalidateQueries({ queryKey: forwardKeys.list }),
  });
}

export function useDeleteForward() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => ipc.forwards.remove(id),
    onSuccess: (_, id) => {
      useForwardStore.getState().remove(id);
      return qc.invalidateQueries({ queryKey: forwardKeys.list });
    },
  });
}
