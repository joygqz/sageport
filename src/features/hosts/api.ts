import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { ipc } from "@/lib/ipc";
import type {
  GroupInput,
  Host,
  HostHealthCheck,
  HostInput,
} from "@/types/models";

export const hostKeys = {
  hosts: ["hosts"] as const,
  groups: ["groups"] as const,
  detail: (id: string) => ["host", id] as const,
};

export function useHosts() {
  return useQuery({ queryKey: hostKeys.hosts, queryFn: ipc.hosts.list });
}

export function useGroups() {
  return useQuery({ queryKey: hostKeys.groups, queryFn: ipc.groups.list });
}

export function useCreateHost() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: HostInput) => ipc.hosts.create(input),
    onSuccess: () => qc.invalidateQueries({ queryKey: hostKeys.hosts }),
  });
}

export function useUpdateHost() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, input }: { id: string; input: HostInput }) =>
      ipc.hosts.update(id, input),
    onSuccess: (_data, { id }) => {
      qc.invalidateQueries({ queryKey: hostKeys.hosts });
      qc.invalidateQueries({ queryKey: hostKeys.detail(id) });
    },
  });
}

export function useMoveHost() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, groupId }: { id: string; groupId: string | null }) =>
      ipc.hosts.move(id, groupId),
    onMutate: async ({ id, groupId }) => {
      await Promise.all([
        qc.cancelQueries({ queryKey: hostKeys.hosts }),
        qc.cancelQueries({ queryKey: hostKeys.detail(id) }),
      ]);
      const previous = qc.getQueryData<Host[]>(hostKeys.hosts);
      const previousHost = qc.getQueryData<Host>(hostKeys.detail(id));
      qc.setQueryData<Host[]>(hostKeys.hosts, (current) =>
        current?.map((host) => (host.id === id ? { ...host, groupId } : host)),
      );
      qc.setQueryData<Host>(hostKeys.detail(id), (current) =>
        current ? { ...current, groupId } : current,
      );
      return { previous, previousHost };
    },
    onError: (_err, _vars, context) => {
      if (context?.previous) qc.setQueryData(hostKeys.hosts, context.previous);
      if (context?.previousHost) {
        qc.setQueryData(hostKeys.detail(_vars.id), context.previousHost);
      }
    },
    onSuccess: (host) => qc.setQueryData(hostKeys.detail(host.id), host),
    onSettled: (_data, _error, { id }) => {
      qc.invalidateQueries({ queryKey: hostKeys.hosts });
      qc.invalidateQueries({ queryKey: hostKeys.detail(id) });
    },
  });
}

export function useSetHostOsHint() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, osHint }: { id: string; osHint: string }) =>
      ipc.hosts.setOsHint(id, osHint),
    onSuccess: (host) => {
      qc.setQueryData<Host[]>(hostKeys.hosts, (current) =>
        current?.map((item) => (item.id === host.id ? host : item)),
      );
      qc.setQueryData(hostKeys.detail(host.id), host);
    },
  });
}

export function useDeleteHost() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => ipc.hosts.remove(id),
    onSuccess: () => qc.invalidateQueries({ queryKey: hostKeys.hosts }),
  });
}

export function useCheckHostHealth() {
  return useMutation({
    mutationFn: ({
      hostIds,
      onResult,
    }: {
      hostIds?: string[];
      onResult?: (result: HostHealthCheck) => void;
    }) => ipc.hosts.checkHealth(hostIds, onResult),
  });
}

export function useCreateGroup() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: GroupInput) => ipc.groups.create(input),
    onSuccess: () => qc.invalidateQueries({ queryKey: hostKeys.groups }),
  });
}

export function useUpdateGroup() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, input }: { id: string; input: GroupInput }) =>
      ipc.groups.update(id, input),
    onSuccess: () => qc.invalidateQueries({ queryKey: hostKeys.groups }),
  });
}

export function useDeleteGroup() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, deleteHosts }: { id: string; deleteHosts: boolean }) =>
      ipc.groups.remove(id, deleteHosts),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: hostKeys.groups });
      qc.invalidateQueries({ queryKey: hostKeys.hosts });
    },
  });
}
