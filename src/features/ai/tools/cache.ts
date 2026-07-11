import { credentialKeys } from "@/features/credentials/api";
import { forwardKeys } from "@/features/forwards/api";
import { hostKeys } from "@/features/hosts/api";
import { snippetsKey } from "@/features/snippets/api";
import { bookmarkKey } from "@/features/sftp/api";
import { queryClient } from "@/lib/query";

export function invalidateHosts(id?: string): void {
  void queryClient.invalidateQueries({ queryKey: hostKeys.hosts });
  if (id) void queryClient.invalidateQueries({ queryKey: hostKeys.detail(id) });
}

export function invalidateGroups(): void {
  void queryClient.invalidateQueries({ queryKey: hostKeys.groups });
}

export function invalidateSnippets(): void {
  void queryClient.invalidateQueries({ queryKey: snippetsKey });
}

export function invalidateForwards(): void {
  void queryClient.invalidateQueries({ queryKey: forwardKeys.list });
}

export function invalidateBookmarks(): void {
  void queryClient.invalidateQueries({ queryKey: bookmarkKey });
}

export function invalidateIdentities(): void {
  void queryClient.invalidateQueries({ queryKey: credentialKeys.identities });
}

export function invalidateSshKeys(): void {
  void queryClient.invalidateQueries({ queryKey: credentialKeys.sshKeys });
}
