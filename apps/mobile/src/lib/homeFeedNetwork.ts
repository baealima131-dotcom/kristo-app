import { peekHomeFeedRowsCacheSavedAt, peekHomeFeedRowsCacheSync } from "@/src/components/homeFeed/homeFeedRowsCache";
import { isMoreTabTransitionBlocking } from "./refreshCoordinator";

/** Minimum interval between global Home Feed API refreshes (unless forced). */
export const HOME_FEED_REFRESH_TTL_MS = 45_000;

/** Minimum interval between church schedule slot polls for the same church. */
export const HOME_FEED_SLOT_POLL_MIN_MS = 12_000;

/** Reuse video HEAD/range warm results for this long. */
export const HOME_FEED_VIDEO_HEAD_TTL_MS = 15 * 60_000;

export type HomeFeedRefreshMode = "skip" | "background" | "required";

type NetworkTraceCounters = {
  apiRequests: number;
  cacheSkips: number;
  dedupeJoins: number;
  staleCancelled: number;
  swrBackground: number;
  slotPollSkips: number;
  posterSkips: number;
  videoHeadSkips: number;
};

const counters: NetworkTraceCounters = {
  apiRequests: 0,
  cacheSkips: 0,
  dedupeJoins: 0,
  staleCancelled: 0,
  swrBackground: 0,
  slotPollSkips: 0,
  posterSkips: 0,
  videoHeadSkips: 0,
};

let lastSuccessfulFetchAt = 0;
let fetchGeneration = 0;
let feedFetchInflight: Promise<any[]> | null = null;

const slotPollLastAt = new Map<string, number>();
const videoHeadWarmedAt = new Map<string, number>();

export function bumpHomeFeedFetchGeneration(reason = "unfocus"): number {
  if (isMoreTabTransitionBlocking()) {
    logHomeFeedNetworkTrace({
      event: "cancel-generation-skipped",
      reason: "more-tab-transition-blocked",
      generation: fetchGeneration,
    });
    return fetchGeneration;
  }
  fetchGeneration += 1;
  logHomeFeedNetworkTrace({ event: "cancel-generation", reason, generation: fetchGeneration });
  return fetchGeneration;
}

export function getHomeFeedFetchGeneration() {
  return fetchGeneration;
}

export function getHomeFeedFetchInflight() {
  return feedFetchInflight;
}

export function setHomeFeedFetchInflight(promise: Promise<any[]> | null) {
  feedFetchInflight = promise;
}

export function noteHomeFeedFetchSuccess() {
  lastSuccessfulFetchAt = Date.now();
}

export function homeFeedNetworkAnchorMs() {
  const savedAt = peekHomeFeedRowsCacheSavedAt() || 0;
  return Math.max(lastSuccessfulFetchAt, savedAt);
}

export function isHomeFeedNetworkFresh(now = Date.now()) {
  const anchor = homeFeedNetworkAnchorMs();
  return anchor > 0 && now - anchor < HOME_FEED_REFRESH_TTL_MS;
}

export function shouldHardRefreshHomeFeed(reason: string, force?: boolean) {
  if (force) return true;
  return (
    reason.includes("schedule-dirty") ||
    reason.includes("post-delete") ||
    reason.startsWith("slot-claim") ||
    reason === "claim-slot-focus"
  );
}

export function resolveHomeFeedRefreshMode(reason: string, force?: boolean): HomeFeedRefreshMode {
  if (isMoreTabTransitionBlocking() && !shouldHardRefreshHomeFeed(reason, force)) {
    return "skip";
  }
  if (shouldHardRefreshHomeFeed(reason, force)) return "required";
  if (isHomeFeedNetworkFresh()) return "skip";

  const hasCachedRows =
    peekHomeFeedRowsCacheSync().length > 0 || lastSuccessfulFetchAt > 0;
  if (hasCachedRows) return "background";
  return "required";
}

export function shouldThrottleSlotPoll(churchId: string, now = Date.now()) {
  const cid = String(churchId || "").trim();
  if (!cid) return true;
  const last = slotPollLastAt.get(cid) || 0;
  return last > 0 && now - last < HOME_FEED_SLOT_POLL_MIN_MS;
}

export function markSlotPollStarted(churchId: string, now = Date.now()) {
  const cid = String(churchId || "").trim();
  if (!cid) return;
  slotPollLastAt.set(cid, now);
}

export function wasVideoHeadRecentlyWarmed(videoUrl: string, now = Date.now()) {
  const key = String(videoUrl || "").trim().split("?")[0];
  if (!key) return false;
  const warmedAt = videoHeadWarmedAt.get(key) || 0;
  if (!warmedAt) return false;
  if (now - warmedAt > HOME_FEED_VIDEO_HEAD_TTL_MS) {
    videoHeadWarmedAt.delete(key);
    return false;
  }
  return true;
}

export function markVideoHeadWarmed(videoUrl: string, now = Date.now()) {
  const key = String(videoUrl || "").trim().split("?")[0];
  if (!key) return;
  videoHeadWarmedAt.set(key, now);
}

export function logHomeFeedNetworkTrace(payload: Record<string, unknown>) {
  const event = String(payload.event || "");
  if (event === "api-request") counters.apiRequests += 1;
  if (event === "cache-skip") counters.cacheSkips += 1;
  if (event === "dedupe-join") counters.dedupeJoins += 1;
  if (event === "stale-cancelled") counters.staleCancelled += 1;
  if (event === "swr-background") counters.swrBackground += 1;
  if (event === "slot-poll-throttled") counters.slotPollSkips += 1;
  if (event === "poster-skip-cached") counters.posterSkips += 1;
  if (event === "video-head-skip-cached") counters.videoHeadSkips += 1;

  console.log("KRISTO_HOME_FEED_NETWORK_TRACE", {
    ts: Date.now(),
    cacheAgeMs: (() => {
      const anchor = homeFeedNetworkAnchorMs();
      return anchor > 0 ? Math.max(0, Date.now() - anchor) : null;
    })(),
    counters: { ...counters },
    ...payload,
  });
}
