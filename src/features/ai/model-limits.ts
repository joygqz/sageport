import { ipc } from "@/lib/ipc";
import type { AiModelLimits } from "@/types/models";

const SUCCESS_TTL_MS = 5 * 60_000;
const FAILURE_TTL_MS = 30_000;

interface CacheEntry {
  promise: Promise<AiModelLimits | null>;
  expiresAt: number;
}

const cache = new Map<string, CacheEntry>();

export function clearModelLimitsCache(): void {
  cache.clear();
}

export function resolveModelLimits(
  model: string,
): Promise<AiModelLimits | null> {
  const now = Date.now();
  const cached = cache.get(model);
  if (cached && cached.expiresAt > now) return cached.promise;

  const entry: CacheEntry = {
    promise: Promise.resolve(null),
    expiresAt: now + FAILURE_TTL_MS,
  };
  entry.promise = ipc.ai
    .modelLimits(model)
    .then((limits) => {
      entry.expiresAt = Date.now() + SUCCESS_TTL_MS;
      return limits;
    })
    .catch(() => {
      entry.expiresAt = Date.now() + FAILURE_TTL_MS;
      return null;
    });
  cache.set(model, entry);
  return entry.promise;
}
