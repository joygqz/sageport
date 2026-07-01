import {
  useMutation,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";

import { ipc } from "@/lib/ipc";
import type { GroupInput, HostInput } from "@/types/models";

export const hostKeys = {
  hosts: ["hosts"] as const,
  groups: ["groups"] as const,
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
    onSuccess: () => qc.invalidateQueries({ queryKey: hostKeys.hosts }),
  });
}

export function useDeleteHost() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => ipc.hosts.remove(id),
    onSuccess: () => qc.invalidateQueries({ queryKey: hostKeys.hosts }),
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
    mutationFn: (id: string) => ipc.groups.remove(id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: hostKeys.groups });
      qc.invalidateQueries({ queryKey: hostKeys.hosts });
    },
  });
}
