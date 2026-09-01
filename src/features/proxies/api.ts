import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { ipc } from "@/lib/ipc";
import type { ProxyProfileInput } from "@/types/models";

export const proxyKeys = {
  state: ["proxies"] as const,
};

export function useProxyState() {
  return useQuery({ queryKey: proxyKeys.state, queryFn: ipc.proxies.state });
}

export function useCreateProxy() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: ProxyProfileInput) => ipc.proxies.create(input),
    onSuccess: () =>
      queryClient.invalidateQueries({ queryKey: proxyKeys.state }),
  });
}

export function useUpdateProxy() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, input }: { id: string; input: ProxyProfileInput }) =>
      ipc.proxies.update(id, input),
    onSuccess: () =>
      queryClient.invalidateQueries({ queryKey: proxyKeys.state }),
  });
}

export function useDeleteProxy() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => ipc.proxies.remove(id),
    onSuccess: () =>
      queryClient.invalidateQueries({ queryKey: proxyKeys.state }),
  });
}

export function useSetActiveProxy() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: string | null) => ipc.proxies.setActive(id),
    onSuccess: () =>
      queryClient.invalidateQueries({ queryKey: proxyKeys.state }),
  });
}
