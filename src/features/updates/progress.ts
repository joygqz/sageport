import type { UpdateStatus } from "@/types/models";

export function updateDownloadProgress(state: UpdateStatus): number | null {
  if (state.status !== "downloading") return null;

  if (state.total !== null && state.total > 0) {
    return Math.min(
      100,
      Math.max(0, Math.round((state.downloaded / state.total) * 100)),
    );
  }

  // The updater does not know the content length until the first chunk arrives.
  // Keep the newly-started download at zero instead of showing an indeterminate
  // bar that looks like progress has already been made.
  return state.downloaded === 0 ? 0 : null;
}
