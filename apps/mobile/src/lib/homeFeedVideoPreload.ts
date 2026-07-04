import { isVideoPost } from "@/src/components/homeFeed/homeFeedUtils";
import { resolveHomeFeedVideoUri } from "@/src/lib/homeFeedVideoUri";
import {
  collectVideoFeedIndexes,
  resolveActiveVideoRank,
} from "@/src/lib/homeFeedVideoWindow";
import { shouldDeferBackgroundMediaJobs } from "@/src/lib/homeFeedWatchPlaybackPriority";
import { isHomeFeedLazyMediaPrewarmEnabled } from "@/src/lib/homeFeedVideoMode";

/** ~30% of the visible window, capped at 1–2 upcoming videos. */
export const HOME_FEED_PRELOAD_BUFFER_FRACTION = 0.3;
export const HOME_FEED_PRELOAD_MAX_AHEAD = 2;
export const HOME_FEED_PRELOAD_MIN_AHEAD = 1;
export const HOME_FEED_PRELOAD_MAX_CONCURRENT = 2;
const PRELOAD_RANGE_BYTES = "bytes=0-65535";
const PRELOAD_TIMEOUT_MS = 8000;

type PreloadTask = {
  url: string;
  postId: string;
  rankDelta: number;
  generation: number;
  controller: AbortController;
};

const warmedUrls = new Set<string>();
const inflightTasks = new Map<string, PreloadTask>();
const pendingTargets: HomeFeedPreloadTarget[] = [];

let queueGeneration = 0;

function normalizeUrl(url: string): string {
  return String(url || "").trim().split("?")[0];
}

function isNetworkUrl(url: string): boolean {
  const trimmed = String(url || "").trim();
  return Boolean(trimmed) && /^https?:\/\//i.test(trimmed);
}

export function computeHomeFeedPreloadAheadCount(visibleCount: number): number {
  const safeVisible = Math.max(1, visibleCount);
  const fromFraction = Math.ceil(safeVisible * HOME_FEED_PRELOAD_BUFFER_FRACTION);
  return Math.max(
    HOME_FEED_PRELOAD_MIN_AHEAD,
    Math.min(HOME_FEED_PRELOAD_MAX_AHEAD, fromFraction)
  );
}

export function beginHomeFeedVideoPreloadSession(): number {
  queueGeneration += 1;
  cancelAllHomeFeedVideoPreloads("session-begin");
  return queueGeneration;
}

export function endHomeFeedVideoPreloadSession(): void {
  cancelAllHomeFeedVideoPreloads("session-end");
  queueGeneration += 1;
}

function cancelTask(url: string, reason: string) {
  const key = normalizeUrl(url);
  const task = inflightTasks.get(key);
  if (!task) return;
  try {
    task.controller.abort();
  } catch {}
  inflightTasks.delete(key);
  console.log("HOME_FEED_PRELOAD_CANCELLED", {
    url: key,
    postId: task.postId || null,
    rankDelta: task.rankDelta,
    reason,
  });
}

export function cancelAllHomeFeedVideoPreloads(reason: string): void {
  for (const url of [...inflightTasks.keys()]) {
    cancelTask(url, reason);
  }
  pendingTargets.length = 0;
}

function drainPreloadQueue(generation: number) {
  while (
    inflightTasks.size < HOME_FEED_PRELOAD_MAX_CONCURRENT &&
    pendingTargets.length > 0 &&
    generation === queueGeneration
  ) {
    const target = pendingTargets.shift();
    if (!target) break;
    void runPreloadTask(target, generation);
  }
}

async function runPreloadTask(target: HomeFeedPreloadTarget, generation: number) {
  const url = String(target.url || "").trim();
  const key = normalizeUrl(url);
  if (!key || !isNetworkUrl(url) || generation !== queueGeneration) return;
  if (warmedUrls.has(key) || inflightTasks.has(key)) return;

  const controller = new AbortController();
  const task: PreloadTask = {
    url: key,
    postId: target.postId,
    rankDelta: target.rankDelta,
    generation,
    controller,
  };
  inflightTasks.set(key, task);

  console.log("HOME_FEED_PRELOAD_STARTED", {
    url: key,
    postId: target.postId || null,
    rankDelta: target.rankDelta,
    generation,
  });

  const timer = setTimeout(() => controller.abort(), PRELOAD_TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      method: "GET",
      headers: { Range: PRELOAD_RANGE_BYTES },
      signal: controller.signal,
    });
    clearTimeout(timer);
    if (generation !== queueGeneration) {
      console.log("HOME_FEED_PRELOAD_CANCELLED", {
        url: key,
        reason: "stale-generation",
      });
      return;
    }
    if (res.ok || res.status === 206) {
      warmedUrls.add(key);
      console.log("HOME_FEED_PRELOAD_COMPLETED", {
        url: key,
        postId: target.postId || null,
        status: res.status,
      });
    }
  } catch (error: any) {
    clearTimeout(timer);
    if (controller.signal.aborted || generation !== queueGeneration) {
      console.log("HOME_FEED_PRELOAD_CANCELLED", {
        url: key,
        reason: controller.signal.aborted ? "aborted" : "stale-generation",
      });
      return;
    }
    console.log("HOME_FEED_PRELOAD_CANCELLED", {
      url: key,
      reason: String(error?.message || "fetch-failed"),
    });
  } finally {
    inflightTasks.delete(key);
    if (generation === queueGeneration) {
      drainPreloadQueue(generation);
    }
  }
}

export type HomeFeedPreloadTarget = {
  postId: string;
  url: string;
  rankDelta: number;
};

export function collectHomeFeedPreloadTargets(
  rows: any[],
  activeIndex: number,
  visibleCount: number
): HomeFeedPreloadTarget[] {
  if (!Array.isArray(rows) || !rows.length) return [];

  const videoIndexes = collectVideoFeedIndexes(rows);
  if (!videoIndexes.length) return [];

  const activeRank = resolveActiveVideoRank(videoIndexes, activeIndex);
  const maxAhead = computeHomeFeedPreloadAheadCount(visibleCount);
  const targets: HomeFeedPreloadTarget[] = [];
  const seen = new Set<string>();

  for (let delta = 1; delta <= maxAhead; delta += 1) {
    const rank = activeRank + delta;
    if (rank < 0 || rank >= videoIndexes.length) continue;
    const row = rows[videoIndexes[rank]];
    if (!row || !isVideoPost(row)) continue;
    const url = resolveHomeFeedVideoUri(row);
    const key = normalizeUrl(url);
    if (!isNetworkUrl(url) || !key || seen.has(key)) continue;
    seen.add(key);
    targets.push({
      postId: String(row?.id || "").trim(),
      url,
      rankDelta: delta,
    });
  }

  return targets;
}

/**
 * Keep only near-viewport video byte preloads (~30% / next 1–2 videos).
 * Cancels stale tasks when the user scrolls away or scrolls quickly.
 */
export function syncHomeFeedVideoPreloadQueue(params: {
  rows: any[];
  activeIndex: number;
  visibleCount: number;
}): void {
  if (isHomeFeedLazyMediaPrewarmEnabled()) return;
  if (shouldDeferBackgroundMediaJobs()) return;
  if (!Array.isArray(params.rows) || !params.rows.length) return;

  const visibleCount = Math.max(1, Math.min(params.visibleCount, params.rows.length));
  const targets = collectHomeFeedPreloadTargets(params.rows, params.activeIndex, visibleCount);
  const allowedUrls = new Set(targets.map((t) => normalizeUrl(t.url)));
  const maxAhead = computeHomeFeedPreloadAheadCount(visibleCount);

  for (const [url, task] of [...inflightTasks.entries()]) {
    if (!allowedUrls.has(url) || Math.abs(task.rankDelta) > maxAhead) {
      cancelTask(url, "scroll-away");
    }
  }

  pendingTargets.length = 0;

  console.log("HOME_FEED_PRELOAD_QUEUE", {
    activeIndex: params.activeIndex,
    visibleCount,
    maxAhead,
    queued: targets.length,
    inflight: inflightTasks.size,
  });

  for (const target of targets) {
    const key = normalizeUrl(target.url);
    if (!key || warmedUrls.has(key) || inflightTasks.has(key)) continue;
    if (pendingTargets.some((entry) => normalizeUrl(entry.url) === key)) continue;
    pendingTargets.push(target);
  }

  drainPreloadQueue(queueGeneration);
}

export function wasHomeFeedVideoPreloadWarmed(url: string): boolean {
  return warmedUrls.has(normalizeUrl(url));
}

export function __resetHomeFeedVideoPreloadForTest(): void {
  warmedUrls.clear();
  cancelAllHomeFeedVideoPreloads("test-reset");
  queueGeneration = 0;
}
