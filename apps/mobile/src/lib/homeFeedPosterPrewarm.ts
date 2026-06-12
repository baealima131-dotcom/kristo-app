import {
  collectFeedVideoPosterCandidates,
  isVideoPost,
  resolveVideoUri,
} from "@/src/components/homeFeed/homeFeedUtils";
import { isHomeFeedNearEnd } from "@/src/components/homeFeed/homeFeedPagination";
import {
  hydrateMediaPosterCache,
  prefetchMediaPosterImages,
  rememberMediaPoster,
  resolveCachedMediaPoster,
} from "@/src/lib/mediaPosterCache";
import {
  generateVideoPosterFrame,
  resolveVideoDurationMs,
} from "@/src/lib/mediaVideoPoster";
import { probePosterUrlReachability } from "@/src/lib/videoGridThumbnail";
import { shouldDeferBackgroundMediaJobs } from "@/src/lib/homeFeedWatchPlaybackPriority";

const INITIAL_VIDEO_COUNT = 20;
const SCROLL_VIDEO_COUNT = 10;
const PREWARM_CONCURRENCY = 2;

const attemptedKeys = new Set<string>();
const failedKeys = new Set<string>();
const inflight = new Map<string, Promise<boolean>>();

let nextScrollPrewarmOrdinal = 0;
let lastInitialFeedKey = "";
let lastScrollPrewarmAt = 0;

const SCROLL_PREWARM_COOLDOWN_MS = 4000;

function prewarmKey(postId: string, videoUrl: string) {
  const id = String(postId || "").trim();
  const url = String(videoUrl || "").trim().split("?")[0];
  return id && url ? `${id}:${url}` : "";
}

function isVideoProcessing(item: any) {
  const status = String(item?.mediaStatus || "").trim().toLowerCase();
  return status === "processing" || status === "uploading";
}

async function runWithConcurrency<T>(
  items: T[],
  concurrency: number,
  worker: (item: T) => Promise<void>
) {
  if (!items.length) return;
  let index = 0;
  const runners = Array.from({ length: Math.min(concurrency, items.length) }, async () => {
    while (index < items.length) {
      const current = items[index];
      index += 1;
      await worker(current);
    }
  });
  await Promise.all(runners);
}

/** Ordered video posts from a feed slice — skips non-video rows. */
export function sliceHomeFeedVideoPosts(
  rows: any[],
  startOrdinal = 0,
  count = INITIAL_VIDEO_COUNT
): any[] {
  const out: any[] = [];
  let ordinal = 0;

  for (const row of rows) {
    if (!isVideoPost(row)) continue;
    if (ordinal < startOrdinal) {
      ordinal += 1;
      continue;
    }
    out.push(row);
    ordinal += 1;
    if (out.length >= count) break;
  }

  return out;
}

async function resolveReachablePosterUri(
  item: any,
  postId: string,
  videoUrl: string
): Promise<string> {
  for (const candidate of collectFeedVideoPosterCandidates(item, postId)) {
    const cached = resolveCachedMediaPoster(postId, videoUrl);
    if (cached && cached.split("?")[0] === candidate.split("?")[0]) {
      return cached;
    }
    const probe = await probePosterUrlReachability(candidate);
    if (probe.reachable) return candidate;
  }
  return "";
}

async function prewarmOneHomeFeedVideoPoster(item: any): Promise<boolean> {
  if (shouldDeferBackgroundMediaJobs()) return false;

  const postId = String(item?.id || "").trim();
  const videoUrl = resolveVideoUri(item);
  const key = prewarmKey(postId, videoUrl);
  if (!key) return false;

  if (isVideoProcessing(item)) {
    attemptedKeys.add(key);
    return false;
  }

  const cached = resolveCachedMediaPoster(postId, videoUrl);
  if (cached) {
    prefetchMediaPosterImages([cached]);
    attemptedKeys.add(key);
    failedKeys.delete(key);
    return true;
  }

  const reachablePoster = await resolveReachablePosterUri(item, postId, videoUrl);
  if (reachablePoster) {
    await rememberMediaPoster({
      postId,
      videoUrl,
      posterUri: reachablePoster,
      source: reachablePoster.startsWith("file://") ? "generated" : "remote",
      persistFile: false,
    });
    attemptedKeys.add(key);
    failedKeys.delete(key);
    return true;
  }

  const generated = await generateVideoPosterFrame({
    postId,
    videoUrl,
    durationMs: resolveVideoDurationMs(item),
    mode: "home-feed",
  });

  attemptedKeys.add(key);
  if (!generated) {
    failedKeys.add(key);
    return false;
  }

  failedKeys.delete(key);
  return true;
}

/** Idempotent background prewarm for a single feed video row. */
export function queueHomeFeedPosterPrewarm(item: any): Promise<boolean> {
  if (shouldDeferBackgroundMediaJobs()) return Promise.resolve(false);

  const postId = String(item?.id || "").trim();
  const videoUrl = resolveVideoUri(item);
  const key = prewarmKey(postId, videoUrl);
  if (!key || isVideoProcessing(item)) return Promise.resolve(false);

  if (resolveCachedMediaPoster(postId, videoUrl)) {
    attemptedKeys.add(key);
    failedKeys.delete(key);
    return Promise.resolve(true);
  }

  const pending = inflight.get(key);
  if (pending) return pending;

  const promise = (async () => {
    try {
      await hydrateMediaPosterCache();
      return prewarmOneHomeFeedVideoPoster(item);
    } catch {
      attemptedKeys.add(key);
      failedKeys.add(key);
      return false;
    } finally {
      inflight.delete(key);
    }
  })();

  inflight.set(key, promise);
  return promise;
}

export async function prewarmHomeFeedVideoPosters(
  items: any[],
  opts?: { concurrency?: number }
) {
  if (shouldDeferBackgroundMediaJobs()) return;

  const videos = items.filter((item) => isVideoPost(item) && !isVideoProcessing(item));
  if (!videos.length) return;

  await hydrateMediaPosterCache();
  await runWithConcurrency(videos, opts?.concurrency ?? PREWARM_CONCURRENCY, async (item) => {
    if (shouldDeferBackgroundMediaJobs()) return;
    await queueHomeFeedPosterPrewarm(item);
  });
}

/** Prewarm the first 20 video posts as soon as feed rows are available. */
export function startInitialHomeFeedPosterPrewarm(rows: any[]) {
  if (shouldDeferBackgroundMediaJobs()) return;
  if (!rows.length) return;

  const feedKey = rows
    .slice(0, 8)
    .map((row) => String(row?.id || "").trim())
    .filter(Boolean)
    .join("|");

  if (feedKey && feedKey !== lastInitialFeedKey) {
    lastInitialFeedKey = feedKey;
    nextScrollPrewarmOrdinal = 0;
  }

  const batch = sliceHomeFeedVideoPosts(rows, 0, INITIAL_VIDEO_COUNT);
  nextScrollPrewarmOrdinal = Math.max(nextScrollPrewarmOrdinal, batch.length);

  console.log("KRISTO_HOME_FEED_POSTER_PREWARM_START", {
    phase: "initial",
    count: batch.length,
    nextScrollPrewarmOrdinal,
  });

  void prewarmHomeFeedVideoPosters(batch);
}

/** Prewarm the next 10 video posts when the user nears the end of loaded content. */
export function prewarmHomeFeedPostersOnNearEnd(
  rows: any[],
  activeIndex: number,
  visibleCount: number
) {
  if (shouldDeferBackgroundMediaJobs()) return;
  if (!rows.length || !isHomeFeedNearEnd(activeIndex, visibleCount)) return;

  const now = Date.now();
  if (now - lastScrollPrewarmAt < SCROLL_PREWARM_COOLDOWN_MS) return;

  const batch = sliceHomeFeedVideoPosts(rows, nextScrollPrewarmOrdinal, SCROLL_VIDEO_COUNT);
  if (!batch.length) return;

  lastScrollPrewarmAt = now;
  const fromOrdinal = nextScrollPrewarmOrdinal;
  nextScrollPrewarmOrdinal += batch.length;

  console.log("KRISTO_HOME_FEED_POSTER_PREWARM_START", {
    phase: "scroll",
    count: batch.length,
    fromOrdinal,
    nextScrollPrewarmOrdinal,
    activeIndex,
    visibleCount,
  });

  void prewarmHomeFeedVideoPosters(batch);
}

export function isHomeFeedPosterPrewarmFailed(postId: string, videoUrl: string): boolean {
  const key = prewarmKey(postId, videoUrl);
  return Boolean(key && failedKeys.has(key));
}

export function isHomeFeedPosterPrewarmPending(postId: string, videoUrl: string): boolean {
  const key = prewarmKey(postId, videoUrl);
  return Boolean(key && inflight.has(key));
}
