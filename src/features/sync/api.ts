import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { ipc } from "@/lib/ipc";
import type {
  SyncOAuthEvent,
  SyncProviderKind,
  SyncProviderSettings,
} from "@/types/models";

const statusKey = ["sync", "status"] as const;
const versionsKey = ["sync", "versions"] as const;

export function useSyncStatus() {
  return useQuery({
    queryKey: statusKey,
    queryFn: ipc.sync.status,
    refetchInterval: 30_000,
    refetchOnWindowFocus: true,
  });
}

export function useSyncOAuthStart() {
  return useMutation({
    mutationFn: ({
      provider,
      onEvent,
    }: {
      provider: SyncProviderKind;
      onEvent: (e: SyncOAuthEvent) => void;
    }) => ipc.sync.oauthStart(provider, onEvent),
  });
}

export function useSyncConnect() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: {
      provider: SyncProviderKind;
      settings?: SyncProviderSettings;
      passphrase: string;
      force: boolean;
    }) => ipc.sync.connect(input),

    onSettled: () => {
      void qc.invalidateQueries();
    },
  });
}

export function useSyncDisconnect() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => ipc.sync.disconnect(),
    onSuccess: () => {
      qc.removeQueries({ queryKey: versionsKey });
      return qc.invalidateQueries({ queryKey: ["sync"] });
    },
  });
}

export function useSyncPush() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => ipc.sync.push(),

    onSettled: () => {
      void qc.invalidateQueries();
    },
  });
}

export function useSyncVersions(enabled: boolean) {
  return useQuery({
    queryKey: versionsKey,
    queryFn: ipc.sync.listVersions,
    enabled,
    retry: false,
  });
}

export function useSyncRestoreVersion() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => ipc.sync.restoreVersion(id),

    onSettled: () => {
      void qc.invalidateQueries();
    },
  });
}

export function useSyncFileExport() {
  return useMutation({
    mutationFn: ({ path, passphrase }: { path: string; passphrase: string }) =>
      ipc.sync.fileExport(path, passphrase),
  });
}

export function useSyncFileImport() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ path, passphrase }: { path: string; passphrase: string }) =>
      ipc.sync.fileImport(path, passphrase),
    onSuccess: () => {
      void qc.invalidateQueries();
    },
  });
}
