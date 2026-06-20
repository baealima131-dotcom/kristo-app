export const SCREEN_CACHE_TTL_MS = 45000;
/** Fast re-check for church profile block on Church Overview focus. */
export const CHURCH_OVERVIEW_PROFILE_REFRESH_MS = 4000;

export function isScreenCacheFresh(updatedAt?: number, ttlMs = SCREEN_CACHE_TTL_MS) {
  return Boolean(updatedAt) && Date.now() - Number(updatedAt) < ttlMs;
}
