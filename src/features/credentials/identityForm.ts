import type { AuthType } from "@/types/models";

export function identityPasswordSubmissionValue({
  authType,
  value,
  clearSavedPassword,
}: {
  authType: AuthType;
  value: string;
  clearSavedPassword: boolean;
}): string | null | undefined {
  if (authType !== "password") return null;
  if (clearSavedPassword) return "";
  return value || undefined;
}
