export const SCREEN_CACHE_TTL_MS = 45000;

export function isScreenCacheFresh(updatedAt?: number, ttlMs = SCREEN_CACHE_TTL_MS) {
  return Boolean(updatedAt) && Date.now() - Number(updatedAt) < ttlMs;
}
