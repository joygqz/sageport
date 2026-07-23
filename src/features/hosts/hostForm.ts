import type { AuthType } from "@/types/models";

export function passwordSubmissionValue({
  authType,
  value,
  edited,
}: {
  authType: AuthType;
  value: string;
  edited: boolean;
}): string | null | undefined {
  if (authType !== "password") return null;
  if (!edited) return undefined;
  return value;
}
