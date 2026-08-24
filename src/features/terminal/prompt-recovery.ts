const RECOVERY_ATTEMPTS = 3;
const RECOVERY_RETRY_MS = 100;

export async function recoverPendingPrompts<T>(
  load: () => Promise<T[]>,
  accept: (event: T) => void,
  onError: (error: unknown) => void,
): Promise<void> {
  for (let attempt = 1; attempt <= RECOVERY_ATTEMPTS; attempt += 1) {
    try {
      for (const event of await load()) accept(event);
      return;
    } catch (error) {
      if (attempt === RECOVERY_ATTEMPTS) {
        onError(error);
        return;
      }
      await new Promise<void>((resolve) =>
        globalThis.setTimeout(resolve, RECOVERY_RETRY_MS * attempt),
      );
    }
  }
}
