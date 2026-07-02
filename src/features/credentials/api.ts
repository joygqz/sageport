import {
  useMutation,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";

import { ipc } from "@/lib/ipc";
import type {
  IdentityInput,
  SnippetInput,
  SshKeyGenerateInput,
  SshKeyInput,
} from "@/types/models";

const keys = {
  sshKeys: ["keys"] as const,
  identities: ["identities"] as const,
  snippets: ["snippets"] as const,
};

export function useSshKeys() {
  return useQuery({ queryKey: keys.sshKeys, queryFn: ipc.keys.list });
}

export function useIdentities() {
  return useQuery({ queryKey: keys.identities, queryFn: ipc.identities.list });
}

export function useSnippets() {
  return useQuery({ queryKey: keys.snippets, queryFn: ipc.snippets.list });
}

export function useCreateSshKey() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: SshKeyInput) => ipc.keys.create(input),
    onSuccess: () => qc.invalidateQueries({ queryKey: keys.sshKeys }),
  });
}

export function useDeleteSshKey() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => ipc.keys.remove(id),
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

/** Reads a key file (and sibling `.pub`) for prefilling the import form; doesn't persist. */
export function useImportSshKeyFile() {
  return useMutation({
    mutationFn: (path: string) => ipc.keys.importFile(path),
  });
}

export function useCreateIdentity() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: IdentityInput) => ipc.identities.create(input),
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

export function useCreateSnippet() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: SnippetInput) => ipc.snippets.create(input),
    onSuccess: () => qc.invalidateQueries({ queryKey: keys.snippets }),
  });
}

export function useDeleteSnippet() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => ipc.snippets.remove(id),
    onSuccess: () => qc.invalidateQueries({ queryKey: keys.snippets }),
  });
}
