import { ipc } from "@/lib/ipc";
import type { AiModelLimits } from "@/types/models";

const SUCCESS_TTL_MS = 5 * 60_000;
const FAILURE_TTL_MS = 30_000;
export const MAX_MODEL_LIMIT_CACHE_ENTRIES = 100;

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
  if (cached && cached.expiresAt > now) {
    cache.delete(model);
    cache.set(model, cached);
    return cached.promise;
  }
  if (cached) cache.delete(model);
  for (const [key, entry] of cache) {
    if (entry.expiresAt <= now) cache.delete(key);
  }
  while (cache.size >= MAX_MODEL_LIMIT_CACHE_ENTRIES) {
    const oldest = cache.keys().next().value;
    if (oldest === undefined) break;
    cache.delete(oldest);
  }

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
