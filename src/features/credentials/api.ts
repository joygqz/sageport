import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { ipc } from "@/lib/ipc";
import type {
  IdentityInput,
  SshKeyGenerateInput,
  SshKeyInput,
} from "@/types/models";

const keys = {
  sshKeys: ["keys"] as const,
  identities: ["identities"] as const,
};

export function useSshKeys() {
  return useQuery({ queryKey: keys.sshKeys, queryFn: ipc.keys.list });
}

export function useCreateSshKey() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: SshKeyInput) => ipc.keys.create(input),
    onSuccess: () => qc.invalidateQueries({ queryKey: keys.sshKeys }),
  });
}

export function useGenerateSshKey() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: SshKeyGenerateInput) => ipc.keys.generate(input),
    onSuccess: () => qc.invalidateQueries({ queryKey: keys.sshKeys }),
  });
}

export function useImportSshKeyFile() {
  return useMutation({
    mutationFn: (path: string) => ipc.keys.importFile(path),
  });
}

export function useDeleteSshKey() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => ipc.keys.remove(id),
    onSuccess: () => qc.invalidateQueries({ queryKey: keys.sshKeys }),
  });
}

export function useIdentities() {
  return useQuery({ queryKey: keys.identities, queryFn: ipc.identities.list });
}

export function useCreateIdentity() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: IdentityInput) => ipc.identities.create(input),
    onSuccess: () => qc.invalidateQueries({ queryKey: keys.identities }),
  });
}

export function useUpdateIdentity() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, input }: { id: string; input: IdentityInput }) =>
      ipc.identities.update(id, input),
    onSuccess: () => qc.invalidateQueries({ queryKey: keys.identities }),
  });
}

export function useDeleteIdentity() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => ipc.identities.remove(id),
    onSuccess: () => qc.invalidateQueries({ queryKey: keys.identities }),
  });
}
