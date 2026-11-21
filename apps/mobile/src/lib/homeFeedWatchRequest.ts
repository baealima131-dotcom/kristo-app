/**
 * A screen outside the Home Feed (e.g. the Video Account Overview) asks the Home Feed to open a
 * video in its existing Watch screen. The request carries the full feed row, is consumed once by
 * HomeFeedScreen when it is focused again, and expires after a few seconds.
 * No second player: Watch stays the one hosted by HomeFeedScreen.
 */

export const HOME_FEED_WATCH_REQUEST_TTL_MS = 10_000;

export type HomeFeedWatchRequest = {
  item: any;
  postId: string;
  source: string;
  createdAt: number;
};

let pending: HomeFeedWatchRequest | null = null;

export function queueHomeFeedWatchRequest(item: any, source: string): boolean {
  const postId = String(item?.id || "").trim();
  if (!postId) return false;
  pending = { item, postId, source, createdAt: Date.now() };
  console.log("KRISTO_WATCH_REQUEST_QUEUED", { postId, source });
  return true;
}

/** Returns the request once (and clears it); null when there is none or it expired. */
export function consumeHomeFeedWatchRequest(now = Date.now()): HomeFeedWatchRequest | null {
  const next = pending;
  pending = null;
  if (!next) return null;
  if (now - next.createdAt > HOME_FEED_WATCH_REQUEST_TTL_MS) {
    console.log("KRISTO_WATCH_REQUEST_EXPIRED", { postId: next.postId, ageMs: now - next.createdAt });
    return null;
  }
  return next;
}
