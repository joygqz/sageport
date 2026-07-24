import type { UpdateStatus } from "@/types/models";

export function updateDownloadProgress(state: UpdateStatus): number | null {
  if (state.status !== "downloading") return null;

  if (state.total !== null && state.total > 0) {
    return Math.min(
      100,
      Math.max(0, Math.round((state.downloaded / state.total) * 100)),
    );
  }

  return state.downloaded === 0 ? 0 : null;
}
