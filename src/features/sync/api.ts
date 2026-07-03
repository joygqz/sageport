import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { ipc } from "@/lib/ipc";
import type { SyncConnectOutcome } from "@/types/models";

const syncKey = ["sync", "config"] as const;
const versionsKey = ["sync", "versions"] as const;

export function useSyncConfig() {
  return useQuery({ queryKey: syncKey, queryFn: ipc.sync.getConfig });
}

export function useSyncConnect() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({
      token,
      passphrase,
      force,
    }: {
      token: string;
      passphrase: string;
      force: boolean;
    }) => ipc.sync.connect(token, passphrase, force),
    onSuccess: (outcome: SyncConnectOutcome) => {
      if (outcome.status !== "connected") return;
      // A successful connect may have merged in an existing remote backup.
      qc.invalidateQueries();
    },
  });
}

export function useSyncDisconnect() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => ipc.sync.disconnect(),
    onSuccess: () => qc.invalidateQueries({ queryKey: syncKey }),
  });
}

export function useSyncPush() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => ipc.sync.push(),
    // A push may create the gist and/or merge in remote rows.
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: syncKey });
      qc.invalidateQueries({ queryKey: versionsKey });
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
    mutationFn: (sha: string) => ipc.sync.restoreVersion(sha),
    // A restore replaces every entity table wholesale, so every cached
    // query (host list, groups, ...) must refetch.
    onSuccess: () => {
      qc.invalidateQueries();
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
      qc.invalidateQueries();
    },
  });
}
