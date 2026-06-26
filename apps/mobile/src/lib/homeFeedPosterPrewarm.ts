import {
  collectFeedVideoPosterCandidates,
  feedRenderKey,
  isInferredPosterUriForVideo,
  isLikelySyntheticPosterPath,
  isVideoPost,
  resolveSavedFeedVideoPosterUri,
  resolveStablePosterVideoUrl,
  resolveVideoUri,
} from "@/src/components/homeFeed/homeFeedUtils";
import { isHomeFeedNearEnd } from "@/src/components/homeFeed/homeFeedPagination";
import {
  hydrateMediaPosterCache,
  mediaPosterCacheKey,
  peekCachedMediaPosterByPostId,
  prefetchMediaPosterImages,
  rememberMediaPoster,
  resolveCachedMediaPoster,
} from "@/src/lib/mediaPosterCache";
import {
  generateVideoPosterFrame,
  resolveVideoDurationMs,
} from "@/src/lib/mediaVideoPoster";
import { probePosterUrlReachability } from "@/src/lib/videoGridThumbnail";
import {
  assertPosterVisibleMissingAllowed,
  markPosterPostIdSessionGenerated,
  markPosterPostIdSessionSatisfied,
  notePosterFeedKeyChanged,
  notePosterVisibleSignatureChanged,
  recordPosterVisibleGenerationAttempt,
  shouldBlockPosterFrameGeneration,
  isPosterPostIdSessionSatisfied,
  consumePosterVisibleWindowChanged,
} from "@/src/lib/homeFeedPosterSession";
import {
  buildRawPosterInitialSignature,
  describePosterFeedIdentity,
  describePosterVisibleIdentity,
  diffNormalizedPosterIds,
  normalizePosterFeedPostId,
  posterFeedIdentitySetsEqual,
} from "@/src/lib/homeFeedPosterIdentity";

function isLiveNavBackgroundPaused() {
  return Boolean((globalThis as any).__KRISTO_HOME_FEED_LIVE_NAV_PAUSED__);
}

const INITIAL_VIDEO_COUNT = 8;
const SCROLL_VIDEO_COUNT = 2;
/** Approximate on-screen feed window — all items in this range get visible priority. */
export const VISIBLE_PRIORITY_COUNT = 8;
const VISIBLE_FRAME_GEN_CONCURRENCY = 2;
const BACKGROUND_FRAME_GEN_CONCURRENCY = 1;
const VISIBLE_MISSING_RECHECK_MS = 500;
const VISIBLE_POSTER_FAILED_RETRY_MS = 30_000;
const VISIBLE_POSTER_MISSING_LOG_MS = 10_000;

const attemptedKeys = new Set<string>();
const failedKeys = new Set<string>();
/** Posters that resolved successfully this session — blocks visible re-queue. */
const satisfiedPosterKeys = new Set<string>();
const visibleGenQueuedKeys = new Set<string>();
const inflight = new Map<string, Promise<boolean>>();

let nextScrollPrewarmOrdinal = 0;
let lastInitialFeedKey = "";
let lastInitialFeedSignature = "";
let lastScrollPrewarmAt = 0;
let initialPrewarmCompletedFeedKey = "";
let lastVisibleWarmSignature = "";

const SCROLL_PREWARM_COOLDOWN_MS = 4000;

let visibleRunId = 0;
let backgroundRunId = 0;
let visibleDrainPromise: Promise<void> | null = null;
let backgroundDrainPromise: Promise<void> | null = null;
let visibleGenerationComplete = false;
const backgroundQueue: any[] = [];
const backgroundKeySet = new Set<string>();

let visibleGenActive = 0;
const visibleGenPending: Array<{
  item: any;
  runId: number;
  resolve: (ok: boolean) => void;
}> = [];

let backgroundGenActive = 0;
const backgroundGenPending: Array<{
  item: any;
  runId: number;
  resolve: (ok: boolean) => void;
}> = [];

let visibleRecheckTimer: ReturnType<typeof setInterval> | null = null;
const visiblePosterFailedAt = new Map<string, number>();
const visiblePosterMissingLoggedAt = new Map<string, number>();
let visibleRecheckContext: {
  rows: any[];
  startIndex: number;
  count: number;
  runId: number;
} | null = null;

export type PrewarmPriority = "visible" | "background";

type PrewarmOneOpts = {
  allowFrameGen?: boolean;
  priority?: PrewarmPriority;
  runId?: number;
};

function logPosterPrewarmSkipped(reason: string, extra: Record<string, unknown> = {}) {
  console.log("KRISTO_POSTER_PREWARM_SKIPPED_ALREADY_RUNNING", { reason, ...extra });
}

function posterVideoUrl(item: any) {
  return resolveStablePosterVideoUrl(item);
}

function isVisiblePosterGenerationPending(postId: string, videoUrl: string): boolean {
  const key = prewarmKey(postId, videoUrl);
  if (!key) return false;
  if (visibleGenQueuedKeys.has(key) || inflight.has(key)) return true;
  return visibleGenPending.some((job) => {
    const jobKey = prewarmKey(String(job.item?.id || "").trim(), posterVideoUrl(job.item));
    return jobKey === key;
  });
}

function isVisiblePosterInFailedCooldown(postId: string, videoUrl: string): boolean {
  const key = prewarmKey(postId, videoUrl);
  if (!key || !failedKeys.has(key)) return false;
  const failedAt = visiblePosterFailedAt.get(key) || 0;
  return failedAt > 0 && Date.now() - failedAt < VISIBLE_POSTER_FAILED_RETRY_MS;
}

function noteVisiblePosterFailed(postId: string, videoUrl: string) {
  const key = prewarmKey(postId, videoUrl);
  if (!key) return;
  failedKeys.add(key);
  visiblePosterFailedAt.set(key, Date.now());
}

function clearVisiblePosterFailure(postId: string, videoUrl: string) {
  const key = prewarmKey(postId, videoUrl);
  if (!key) return;
  failedKeys.delete(key);
  visiblePosterFailedAt.delete(key);
  visiblePosterMissingLoggedAt.delete(key);
}

function prewarmKey(postId: string, videoUrl: string) {
  const id = String(postId || "").trim();
  const url = String(videoUrl || "").trim().split("?")[0];
  return id && url ? `${id}:${url}` : "";
}

function describeRowIds(rows: any[], startIndex = 0, count = 8) {
  return rows
    .slice(Math.max(0, startIndex), Math.max(0, startIndex) + Math.max(0, count))
    .map((row) => ({
      id: String(row?.id || "").trim() || null,
      normalizedId: normalizePosterFeedPostId(row) || null,
      renderKey: feedRenderKey(row) || String(row?.id || "").trim() || null,
    }));
}

function logPosterSessionSignatureChange(args: {
  kind: "feed" | "visible" | "initial";
  reason: string;
  previousKey?: string;
  nextKey?: string;
  previousSignature?: string;
  nextSignature?: string;
  previousRowIds?: string[];
  nextRowIds?: string[];
  resetSkipped?: boolean;
  extra?: Record<string, unknown>;
}) {
  const previousRowIds = args.previousRowIds || [];
  const nextRowIds = args.nextRowIds || [];
  const diff = diffNormalizedPosterIds(previousRowIds.join("|"), nextRowIds.join("|"));
  console.log("POSTER_SESSION_SIGNATURE_CHANGE", {
    kind: args.kind,
    reason: args.reason,
    previousFeedKey: args.previousKey || null,
    nextFeedKey: args.nextKey || null,
    normalizedPreviousFeedKey: args.kind === "feed" ? args.previousKey || null : null,
    normalizedNextFeedKey: args.kind === "feed" ? args.nextKey || null : null,
    previousVisibleSignature: args.kind === "visible" ? args.previousSignature || null : null,
    nextVisibleSignature: args.kind === "visible" ? args.nextSignature || null : null,
    normalizedPreviousVisibleSignature:
      args.kind === "visible" ? args.previousSignature || null : null,
    normalizedNextVisibleSignature:
      args.kind === "visible" ? args.nextSignature || null : null,
    previousInitialFeedSignature:
      args.kind === "initial" ? args.previousSignature || null : null,
    nextInitialFeedSignature:
      args.kind === "initial" ? args.nextSignature || null : null,
    normalizedPreviousInitialSignature:
      args.kind === "initial" ? args.previousSignature || null : null,
    normalizedNextInitialSignature:
      args.kind === "initial" ? args.nextSignature || null : null,
    previousRowIds,
    nextRowIds,
    removedRowIds: diff.removed,
    addedRowIds: diff.added,
    resetSkipped: args.resetSkipped === true,
    ...args.extra,
  });
}

function markPosterSatisfied(
  postId: string,
  videoUrl: string,
  reason: string,
  extra: Record<string, unknown> = {}
) {
  const key = prewarmKey(postId, videoUrl);
  if (!key) return;
  const already = satisfiedPosterKeys.has(key);
  satisfiedPosterKeys.add(key);
  attemptedKeys.add(key);
  failedKeys.delete(key);
  visibleGenQueuedKeys.delete(key);
  markPosterPostIdSessionSatisfied(postId, reason, {
    posterUri: typeof extra.cached === "string" ? extra.cached : typeof extra.posterUri === "string" ? extra.posterUri : undefined,
  });
  if (!already) {
    console.log("POSTER_VISIBLE_SATISFIED", {
      postId: postId || null,
      videoUrl: String(videoUrl || "").trim().split("?")[0] || null,
      reason,
      ...extra,
    });
  }
}

function diagnosePosterRequeue(
  item: any,
  context: string,
  extra: Record<string, unknown> = {}
) {
  const postId = String(item?.id || "").trim();
  const stableVideoUrl = posterVideoUrl(item);
  const playbackVideoUrl = resolveVideoUri(item);
  const key = prewarmKey(postId, stableVideoUrl);
  const cachedStable = resolveCachedMediaPoster(postId, stableVideoUrl);
  const cachedPlayback = resolveCachedMediaPoster(postId, playbackVideoUrl);
  const cachedByPostId = peekCachedMediaPosterByPostId(postId);

  console.log("POSTER_VISIBLE_REQUEUE_DIAG", {
    context,
    postId: postId || null,
    stableVideoUrl: stableVideoUrl || null,
    playbackVideoUrl: playbackVideoUrl || null,
    cacheKeyStable: mediaPosterCacheKey(postId, stableVideoUrl) || null,
    cacheKeyPlayback: mediaPosterCacheKey(postId, playbackVideoUrl) || null,
    cachedStable: cachedStable || null,
    cachedPlayback: cachedPlayback || null,
    cachedByPostId: cachedByPostId || null,
    satisfied: key ? satisfiedPosterKeys.has(key) : false,
    attempted: key ? attemptedKeys.has(key) : false,
    failed: key ? failedKeys.has(key) : false,
    visibleQueued: key ? visibleGenQueuedKeys.has(key) : false,
    visibleRunId,
    ...extra,
  });
}

function isVideoProcessing(item: any) {
  const status = String(item?.mediaStatus || "").trim().toLowerCase();
  return status === "processing" || status === "uploading";
}

export function itemHasHomeFeedPoster(item: any): boolean {
  const postId = String(item?.id || "").trim();
  const videoUrl = posterVideoUrl(item);
  if (!postId || !videoUrl) return false;
  const cached = resolveCachedMediaPoster(postId, videoUrl);
  if (cached) {
    markPosterSatisfied(postId, videoUrl, "cache-hit", { cached });
    return true;
  }
  const savedMetadataPoster = resolveSavedFeedVideoPosterUri(item, videoUrl);
  if (savedMetadataPoster) {
    markPosterSatisfied(postId, videoUrl, "metadata-hit", { posterUri: savedMetadataPoster });
    return true;
  }
  return false;
}

export function itemNeedsVisiblePosterGeneration(item: any): boolean {
  const postId = String(item?.id || "").trim();
  const videoUrl = posterVideoUrl(item);
  if (!postId || !videoUrl || isVideoProcessing(item)) return false;
  if (isPosterPostIdSessionSatisfied(postId)) return false;
  const key = prewarmKey(postId, videoUrl);
  if (key && satisfiedPosterKeys.has(key)) return false;
  return !itemHasHomeFeedPoster(item);
}

function logVisibleMissing(item: any, extra: Record<string, unknown> = {}): boolean {
  const context = String(
    extra.source || (extra.recheck ? "visible-recheck" : "visible-missing")
  );
  if (!assertPosterVisibleMissingAllowed(item, context)) {
    return false;
  }

  const postId = String(item?.id || "").trim();
  const videoUrl = posterVideoUrl(item);
  console.log("POSTER_VISIBLE_MISSING", {
    postId: postId || null,
    videoUrl: videoUrl || null,
    ...extra,
  });
  diagnosePosterRequeue(item, "visible-missing", extra);
  return true;
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

function pumpVisibleGenQueue() {
  while (visibleGenActive < VISIBLE_FRAME_GEN_CONCURRENCY && visibleGenPending.length > 0) {
    const job = visibleGenPending.shift()!;
    if (job.runId !== visibleRunId) {
      job.resolve(false);
      continue;
    }
    visibleGenActive += 1;
    void executeVisibleFrameGen(job.item, job.runId)
      .then((ok) => job.resolve(ok))
      .catch(() => job.resolve(false))
      .finally(() => {
        const postId = String(job.item?.id || "").trim();
        const videoUrl = posterVideoUrl(job.item);
        const key = prewarmKey(postId, videoUrl);
        if (key) visibleGenQueuedKeys.delete(key);
        visibleGenActive = Math.max(0, visibleGenActive - 1);
        pumpVisibleGenQueue();
        maybeStartBackgroundDrain();
      });
  }
}

function enqueueVisibleFrameGen(item: any, runId: number, urgent = false): Promise<boolean> {
  const postId = String(item?.id || "").trim();
  const videoUrl = posterVideoUrl(item);
  const key = prewarmKey(postId, videoUrl);
  if (!key) return Promise.resolve(false);

  if (itemHasHomeFeedPoster(item)) {
    return Promise.resolve(true);
  }

  if (satisfiedPosterKeys.has(key)) {
    return Promise.resolve(true);
  }

  if (visibleGenQueuedKeys.has(key)) {
    return Promise.resolve(false);
  }

  if (isVisiblePosterInFailedCooldown(postId, videoUrl)) {
    return Promise.resolve(false);
  }

  failedKeys.delete(key);
  visiblePosterFailedAt.delete(key);
  visibleGenQueuedKeys.add(key);

  return new Promise<boolean>((resolve) => {
    const job = { item, runId, resolve };
    if (urgent) {
      visibleGenPending.unshift(job);
    } else {
      visibleGenPending.push(job);
    }
    pumpVisibleGenQueue();
  });
}

function pauseBackgroundFrameGenForVisible(reason: string) {
  if (backgroundGenActive > 0 || backgroundGenPending.length > 0 || backgroundDrainPromise) {
    backgroundRunId += 1;
    backgroundGenPending.length = 0;
    console.log("POSTER_GEN_BACKGROUND_CANCELLED", {
      reason,
      runId: backgroundRunId,
      cause: "visible-priority",
    });
  }
}

function pumpBackgroundGenQueue() {
  if (visibleGenActive > 0 || visibleGenPending.length > 0) return;
  while (backgroundGenActive < BACKGROUND_FRAME_GEN_CONCURRENCY && backgroundGenPending.length > 0) {
    const job = backgroundGenPending.shift()!;
    if (job.runId !== backgroundRunId) {
      job.resolve(false);
      continue;
    }
    backgroundGenActive += 1;
    void executeBackgroundFrameGen(job.item, job.runId)
      .then((ok) => job.resolve(ok))
      .catch(() => job.resolve(false))
      .finally(() => {
        backgroundGenActive = Math.max(0, backgroundGenActive - 1);
        pumpBackgroundGenQueue();
      });
  }
}

function enqueueBackgroundFrameGen(item: any, runId: number): Promise<boolean> {
  return new Promise((resolve) => {
    backgroundGenPending.push({ item, runId, resolve });
    pumpBackgroundGenQueue();
  });
}

function cancelBackgroundPosterGeneration(reason: string) {
  if (!backgroundQueue.length && !backgroundDrainPromise && !backgroundGenPending.length) {
    return;
  }
  backgroundRunId += 1;
  const queuedPostIds = backgroundQueue
    .map((item) => String(item?.id || "").trim())
    .filter(Boolean);
  backgroundQueue.length = 0;
  backgroundKeySet.clear();
  backgroundGenPending.length = 0;
  console.log("POSTER_GEN_BACKGROUND_CANCELLED", {
    reason,
    runId: backgroundRunId,
    queuedPostIds,
    queuedCount: queuedPostIds.length,
  });
}

function stopVisiblePosterRecheck() {
  if (visibleRecheckTimer) {
    clearInterval(visibleRecheckTimer);
    visibleRecheckTimer = null;
  }
  visibleRecheckContext = null;
}

function startVisiblePosterRecheck(rows: any[], startIndex: number, count: number, runId: number) {
  stopVisiblePosterRecheck();
  visibleRecheckContext = { rows, startIndex, count, runId };

  visibleRecheckTimer = setInterval(() => {
    const ctx = visibleRecheckContext;
    if (!ctx || ctx.runId !== visibleRunId) {
      stopVisiblePosterRecheck();
      return;
    }

    const items = collectVisibleVideoPosts(ctx.rows, ctx.startIndex, ctx.count);
    const missing = items.filter((item) => itemNeedsVisiblePosterGeneration(item));
    if (!missing.length) {
      stopVisiblePosterRecheck();
      return;
    }

    let queuedAny = false;
    for (const item of missing) {
      const postId = String(item?.id || "").trim();
      const videoUrl = posterVideoUrl(item);
      const key = prewarmKey(postId, videoUrl);

      if (itemHasHomeFeedPoster(item)) {
        clearVisiblePosterFailure(postId, videoUrl);
        continue;
      }

      if (!key || isVisiblePosterGenerationPending(postId, videoUrl)) {
        continue;
      }

      if (isVisiblePosterInFailedCooldown(postId, videoUrl)) {
        continue;
      }

      const now = Date.now();
      const lastLog = visiblePosterMissingLoggedAt.get(key) || 0;
      if (now - lastLog >= VISIBLE_POSTER_MISSING_LOG_MS) {
        visiblePosterMissingLoggedAt.set(key, now);
        if (!logVisibleMissing(item, { recheck: true, runId: ctx.runId })) {
          continue;
        }
      }

      pauseBackgroundFrameGenForVisible("visible-recheck");
      queuedAny = true;
      void queueHomeFeedPosterPrewarm(item, { priority: "visible" });
    }

    if (!queuedAny && missing.every((item) => {
      const postId = String(item?.id || "").trim();
      const videoUrl = posterVideoUrl(item);
      return (
        itemHasHomeFeedPoster(item) ||
        isVisiblePosterGenerationPending(postId, videoUrl) ||
        isVisiblePosterInFailedCooldown(postId, videoUrl)
      );
    })) {
      stopVisiblePosterRecheck();
    }
  }, VISIBLE_MISSING_RECHECK_MS);
}

function enqueueBackgroundItems(items: any[]): number {
  let added = 0;
  for (const item of items) {
    const postId = String(item?.id || "").trim();
    const videoUrl = posterVideoUrl(item);
    const key = prewarmKey(postId, videoUrl);
    if (!key || isVideoProcessing(item)) continue;
    if (backgroundKeySet.has(key)) continue;
    if (itemHasHomeFeedPoster(item)) continue;
    backgroundQueue.push(item);
    backgroundKeySet.add(key);
    added += 1;
  }
  return added;
}

function maybeStartBackgroundDrain() {
  if (!visibleGenerationComplete) return;
  if (visibleGenActive > 0 || visibleGenPending.length > 0) return;
  void drainBackgroundPosterGeneration(visibleRunId);
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

function partitionPosterCandidates(candidates: string[], videoUrl: string) {
  const real: string[] = [];
  const inferred: string[] = [];
  for (const candidate of candidates) {
    if (
      isInferredPosterUriForVideo(candidate, videoUrl) ||
      isLikelySyntheticPosterPath(candidate)
    ) {
      inferred.push(candidate);
      continue;
    }
    real.push(candidate);
  }
  return { real, inferred };
}

/** Fire-and-forget Image.prefetch for metadata/cache candidates (skip inferred guesses). */
export function prefetchHomeFeedPosterMetadata(item: any): void {
  const postId = String(item?.id || "").trim();
  const videoUrl = posterVideoUrl(item);
  if (!videoUrl) return;

  const cached = resolveCachedMediaPoster(postId, videoUrl);
  if (cached) {
    prefetchMediaPosterImages([cached]);
    return;
  }

  const { real } = partitionPosterCandidates(
    collectFeedVideoPosterCandidates(item, postId),
    videoUrl
  );
  if (real.length) prefetchMediaPosterImages(real);
}

async function resolveReachablePosterUri(
  item: any,
  postId: string,
  videoUrl: string
): Promise<string> {
  const candidates = collectFeedVideoPosterCandidates(item, postId);
  const { real, inferred } = partitionPosterCandidates(candidates, videoUrl);

  for (const candidate of real) {
    const cached = resolveCachedMediaPoster(postId, videoUrl);
    if (cached && cached.split("?")[0] === candidate.split("?")[0]) {
      return cached;
    }
  }

  if (real.length) {
    const probeResults = await Promise.all(
      real.map(async (candidate) => {
        const probe = await probePosterUrlReachability(candidate);
        return probe.reachable ? candidate : "";
      })
    );
    const reachable = probeResults.find(Boolean);
    if (reachable) return reachable;
  }

  for (const candidate of inferred) {
    const probe = await probePosterUrlReachability(candidate);
    if (probe.reachable) return candidate;
  }

  return "";
}

async function prewarmOneHomeFeedVideoPosterFastPath(item: any): Promise<boolean> {
  const postId = String(item?.id || "").trim();
  const videoUrl = posterVideoUrl(item);
  const key = prewarmKey(postId, videoUrl);
  if (!key) return false;

  if (isVideoProcessing(item)) {
    attemptedKeys.add(key);
    return false;
  }

  const cached = resolveCachedMediaPoster(postId, videoUrl);
  if (cached) {
    prefetchMediaPosterImages([cached]);
    markPosterSatisfied(postId, videoUrl, "fast-path-cache", { posterUri: cached });
    return true;
  }

  prefetchHomeFeedPosterMetadata(item);

  const savedMetadataPoster = resolveSavedFeedVideoPosterUri(item, videoUrl);
  if (savedMetadataPoster) {
    await rememberMediaPoster({
      postId,
      videoUrl,
      posterUri: savedMetadataPoster,
      source: "remote",
      persistFile: false,
    });
    prefetchMediaPosterImages([savedMetadataPoster]);
    markPosterSatisfied(postId, videoUrl, "fast-path-metadata", { posterUri: savedMetadataPoster });
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
    markPosterSatisfied(postId, videoUrl, "fast-path-reachable", { posterUri: reachablePoster });
    return true;
  }

  return false;
}

async function executeVisibleFrameGen(item: any, runId: number): Promise<boolean> {
  const postId = String(item?.id || "").trim();
  const videoUrl = posterVideoUrl(item);
  const key = prewarmKey(postId, videoUrl);
  if (!key || runId !== visibleRunId) return false;

  if (itemHasHomeFeedPoster(item)) {
    return true;
  }

  if (satisfiedPosterKeys.has(key) || shouldBlockPosterFrameGeneration(item, "visible-frame-gen")) {
    return true;
  }

  const genAttempt = recordPosterVisibleGenerationAttempt(item, "visible-generate-start", {
    keySatisfied: satisfiedPosterKeys.has(key),
    visibleWindowChanged: consumePosterVisibleWindowChanged(),
  });
  if (genAttempt.blocked) {
    return itemHasHomeFeedPoster(item);
  }

  diagnosePosterRequeue(item, "visible-generate-start", { runId, attempt: genAttempt.attempt });

  console.log("POSTER_VISIBLE_GENERATE_START", {
    postId: postId || null,
    videoUrl: videoUrl || null,
    runId,
    attempt: genAttempt.attempt,
    active: visibleGenActive,
    pending: visibleGenPending.length,
  });

  let generated = "";
  try {
    generated =
      (await generateVideoPosterFrame({
        postId,
        videoUrl,
        durationMs: resolveVideoDurationMs(item),
        mode: "home-feed",
      })) || "";
  } catch {
    generated = "";
  }

  if (runId !== visibleRunId) {
    if (generated) {
      markPosterSatisfied(postId, videoUrl, "stale-run-generated", { runId, posterUri: generated });
    }
    return Boolean(generated);
  }

  attemptedKeys.add(key);

  if (generated) {
    clearVisiblePosterFailure(postId, videoUrl);
    markPosterSatisfied(postId, videoUrl, "visible-generated", { runId, posterUri: generated });
    markPosterPostIdSessionGenerated(postId, { posterUri: generated, source: "visible-generated" });
    console.log("POSTER_VISIBLE_GENERATE_DONE", {
      postId: postId || null,
      videoUrl: videoUrl || null,
      runId,
      posterUri: generated,
    });
    return true;
  }

  noteVisiblePosterFailed(postId, videoUrl);
  console.log("POSTER_VISIBLE_GENERATE_FAILED", {
    postId: postId || null,
    videoUrl: videoUrl || null,
    runId,
  });
  return false;
}

async function executeBackgroundFrameGen(item: any, runId: number): Promise<boolean> {
  const postId = String(item?.id || "").trim();
  const videoUrl = posterVideoUrl(item);
  const key = prewarmKey(postId, videoUrl);
  if (!key || runId !== backgroundRunId) return false;

  if (itemHasHomeFeedPoster(item)) {
    return true;
  }

  let generated = "";
  try {
    generated =
      (await generateVideoPosterFrame({
        postId,
        videoUrl,
        durationMs: resolveVideoDurationMs(item),
        mode: "home-feed",
      })) || "";
  } catch {
    generated = "";
  }

  attemptedKeys.add(key);
  if (generated) {
    markPosterSatisfied(postId, videoUrl, "background-generated", { posterUri: generated });
    return true;
  }
  failedKeys.add(key);
  return false;
}

async function prewarmOneHomeFeedVideoPoster(
  item: any,
  opts?: PrewarmOneOpts
): Promise<boolean> {
  const fast = await prewarmOneHomeFeedVideoPosterFastPath(item);
  if (fast) return true;
  if (opts?.allowFrameGen === false) return false;

  const priority = opts?.priority || "background";
  const runId = opts?.runId ?? (priority === "visible" ? visibleRunId : backgroundRunId);

  if (priority === "visible") {
    return enqueueVisibleFrameGen(item, runId, true);
  }

  return enqueueBackgroundFrameGen(item, runId);
}

async function runVisiblePosterGeneration(items: any[], runId: number) {
  visibleGenerationComplete = false;

  const videos = items.filter((item) => isVideoPost(item) && !isVideoProcessing(item));

  console.log("POSTER_GEN_VISIBLE_START", {
    count: videos.length,
    runId,
    postIds: videos.map((row) => String(row?.id || "").trim()).filter(Boolean),
    concurrency: VISIBLE_FRAME_GEN_CONCURRENCY,
  });

  console.log("KRISTO_HOME_FEED_POSTER_PREWARM_START", {
    phase: "visible-priority",
    count: videos.length,
    runId,
  });

  await hydrateMediaPosterCache();

  await Promise.all(
    videos.map(async (item) => {
      if (runId !== visibleRunId) return;
      await prewarmOneHomeFeedVideoPosterFastPath(item);
    })
  );

  if (runId !== visibleRunId) return;

  const missing = videos.filter((item) => itemNeedsVisiblePosterGeneration(item));
  for (const item of missing) {
    logVisibleMissing(item, { runId, batch: "visible-start" });
  }

  await runWithConcurrency(missing, VISIBLE_FRAME_GEN_CONCURRENCY, async (item) => {
    if (runId !== visibleRunId) return;
    await enqueueVisibleFrameGen(item, runId);
  });

  if (runId !== visibleRunId) return;

  visibleGenerationComplete = true;

  console.log("POSTER_GEN_VISIBLE_DONE", {
    count: videos.length,
    missingResolved: missing.length,
    runId,
  });

  maybeStartBackgroundDrain();
}

async function drainBackgroundPosterGeneration(afterVisibleRunId: number) {
  if (afterVisibleRunId !== visibleRunId) return;
  if (!visibleGenerationComplete) return;
  if (visibleGenActive > 0 || visibleGenPending.length > 0) return;
  if (!backgroundQueue.length) return;
  if (backgroundDrainPromise) return backgroundDrainPromise;

  const runId = backgroundRunId;

  backgroundDrainPromise = (async () => {
    console.log("POSTER_GEN_BACKGROUND_START", {
      count: backgroundQueue.length,
      runId,
      concurrency: BACKGROUND_FRAME_GEN_CONCURRENCY,
    });

    console.log("KRISTO_HOME_FEED_POSTER_PREWARM_START", {
      phase: "background",
      count: backgroundQueue.length,
      runId,
    });

    while (backgroundQueue.length > 0) {
      if (
        runId !== backgroundRunId ||
        afterVisibleRunId !== visibleRunId ||
        visibleGenActive > 0 ||
        visibleGenPending.length > 0
      ) {
        console.log("POSTER_GEN_BACKGROUND_CANCELLED", {
          runId,
          reason: "visible-resumed",
          remaining: backgroundQueue.length,
        });
        return;
      }

      const item = backgroundQueue.shift()!;
      const postId = String(item?.id || "").trim();
      const videoUrl = posterVideoUrl(item);
      const key = prewarmKey(postId, videoUrl);
      if (key) backgroundKeySet.delete(key);

      const fast = await prewarmOneHomeFeedVideoPosterFastPath(item);
      if (fast) continue;

      await enqueueBackgroundFrameGen(item, runId);
    }

    console.log("POSTER_GEN_BACKGROUND_DONE", { runId });
  })().finally(() => {
    backgroundDrainPromise = null;
  });

  return backgroundDrainPromise;
}

async function maybeDrainBackgroundQueue() {
  if (backgroundDrainPromise) return backgroundDrainPromise;
  if (!backgroundQueue.length) return;
  if (!visibleGenerationComplete) return;
  if (visibleGenActive > 0 || visibleGenPending.length > 0) return;
  return drainBackgroundPosterGeneration(visibleRunId);
}

/** Prewarm a single row — visible priority jumps the frame-gen queue. */
export function queueHomeFeedPosterPrewarm(
  item: any,
  opts?: { priority?: PrewarmPriority }
): Promise<boolean> {
  if (isLiveNavBackgroundPaused()) return Promise.resolve(false);

  const priority = opts?.priority || "background";
  const postId = String(item?.id || "").trim();
  const videoUrl = posterVideoUrl(item);
  const key = prewarmKey(postId, videoUrl);
  if (!key || isVideoProcessing(item)) return Promise.resolve(false);

  if (itemHasHomeFeedPoster(item)) {
    return Promise.resolve(true);
  }

  if (isPosterPostIdSessionSatisfied(postId)) {
    return Promise.resolve(true);
  }

  if (priority === "visible" && shouldBlockPosterFrameGeneration(item, "queue-visible")) {
    return Promise.resolve(true);
  }

  const pending = inflight.get(key);
  if (pending) return pending;

  const promise = (async () => {
    try {
      await hydrateMediaPosterCache();
      if (itemHasHomeFeedPoster(item)) return true;
      const fast = await prewarmOneHomeFeedVideoPosterFastPath(item);
      if (fast) return true;
      if (priority === "visible") {
        if (isVisiblePosterGenerationPending(postId, videoUrl)) {
          return false;
        }
        if (isVisiblePosterInFailedCooldown(postId, videoUrl)) {
          return false;
        }
        const now = Date.now();
        const lastLog = visiblePosterMissingLoggedAt.get(key) || 0;
        if (now - lastLog >= VISIBLE_POSTER_MISSING_LOG_MS) {
          visiblePosterMissingLoggedAt.set(key, now);
          if (!logVisibleMissing(item, { source: "queue-visible" })) return true;
        }
        pauseBackgroundFrameGenForVisible("visible-queue");
        return enqueueVisibleFrameGen(item, visibleRunId, true);
      }
      return prewarmOneHomeFeedVideoPoster(item, {
        allowFrameGen: true,
        priority: "background",
        runId: backgroundRunId,
      });
    } catch {
      attemptedKeys.add(key);
      noteVisiblePosterFailed(postId, videoUrl);
      return false;
    }
  })();

  inflight.set(key, promise);
  void promise.finally(() => {
    inflight.delete(key);
  });

  return promise;
}

/** Enqueue background poster work — does not start until visible queue finishes. */
export async function prewarmHomeFeedVideoPosters(items: any[]) {
  const videos = items.filter((item) => isVideoPost(item) && !isVideoProcessing(item));
  if (!videos.length) return;

  for (const item of videos) prefetchHomeFeedPosterMetadata(item);
  const added = enqueueBackgroundItems(videos);
  if (!added) return;

  await maybeDrainBackgroundQueue();
}

function collectVisibleVideoPosts(rows: any[], startIndex: number, count: number): any[] {
  if (!rows.length || count <= 0) return [];

  const out: any[] = [];
  const end = Math.min(rows.length, Math.max(0, startIndex) + count);

  for (let i = Math.max(0, startIndex); i < end; i += 1) {
    const row = rows[i];
    if (isVideoPost(row) && !isVideoProcessing(row)) out.push(row);
  }

  return out;
}

/**
 * Immediate high-priority prewarm for all on-screen rows.
 * Cancels in-flight background generation when the viewport moves.
 */
export function prewarmVisibleHomeFeedVideoPosters(
  rows: any[],
  startIndex = 0,
  count = VISIBLE_PRIORITY_COUNT
): void {
  if (isLiveNavBackgroundPaused()) return;

  const windowCount = Math.max(1, Math.min(count, rows.length - Math.max(0, startIndex)));
  const items = collectVisibleVideoPosts(rows, startIndex, windowCount);
  if (!items.length) return;

  const visibleIdentity = describePosterVisibleIdentity(items);
  const signature = visibleIdentity.normalizedVisibleSignature || "";
  const previousVisibleSignature = lastVisibleWarmSignature;
  const visibleRowIds = visibleIdentity.normalizedRowIds;
  notePosterVisibleSignatureChanged(signature);
  if (signature && posterFeedIdentitySetsEqual(signature, lastVisibleWarmSignature)) {
    const allSatisfied = items.every((item) => !itemNeedsVisiblePosterGeneration(item));
    if (allSatisfied) {
      logPosterPrewarmSkipped("visible-window-satisfied", {
        signature,
        count: items.length,
      });
      return;
    }
    if (visibleDrainPromise || visibleGenActive > 0 || visibleGenPending.length > 0) {
      logPosterPrewarmSkipped("visible-window-inflight", {
        signature,
        active: visibleGenActive,
        pending: visibleGenPending.length,
      });
      return;
    }
  }

  if (previousVisibleSignature && !posterFeedIdentitySetsEqual(previousVisibleSignature, signature)) {
    logPosterSessionSignatureChange({
      kind: "visible",
      reason: "visible-priority-scroll",
      previousSignature: previousVisibleSignature,
      nextSignature: signature,
      previousRowIds: previousVisibleSignature.split("|").filter(Boolean),
      nextRowIds: visibleRowIds,
      extra: {
        rawNextVisibleSignature: visibleIdentity.rawVisibleSignature,
        normalizedNextVisibleSignature: signature || null,
        startIndex,
        windowCount,
        visibleRows: describeRowIds(rows, startIndex, windowCount),
      },
    });
  }

  lastVisibleWarmSignature = signature;
  cancelBackgroundPosterGeneration("visible-priority-scroll");
  visibleRunId += 1;
  const runId = visibleRunId;
  visibleGenQueuedKeys.clear();

  startVisiblePosterRecheck(rows, startIndex, windowCount, runId);

  visibleDrainPromise = runVisiblePosterGeneration(items, runId).finally(() => {
    if (visibleDrainPromise && runId === visibleRunId) {
      visibleDrainPromise = null;
    }
  });
}

/** Prewarm feed posters: all visible on screen first, then background batch. */
export function startInitialHomeFeedPosterPrewarm(rows: any[]) {
  if (isLiveNavBackgroundPaused()) return;

  if (!rows.length) return;

  const feedIdentity = describePosterFeedIdentity(rows);
  const feedKey = feedIdentity.normalizedFeedKey || "";
  const rawFeedKey = feedIdentity.rawFeedKey || "";
  const rawInitialSignature = feedIdentity.rawInitialSignature || "";
  const nextInitialSignature = feedIdentity.normalizedInitialSignature || "";
  const nextInitialRowIds = feedIdentity.normalizedRowIds;

  if (feedKey && posterFeedIdentitySetsEqual(feedKey, initialPrewarmCompletedFeedKey)) {
    logPosterPrewarmSkipped("initial-already-completed", {
      feedKey,
      rawFeedKey,
      normalizedFeedKey: feedKey,
    });
    return;
  }

  if (feedKey && !posterFeedIdentitySetsEqual(feedKey, lastInitialFeedKey)) {
    const previousFeedKey = lastInitialFeedKey;
    const previousInitialSignature = lastInitialFeedSignature;
    logPosterSessionSignatureChange({
      kind: "feed",
      reason: "initial-feed-changed",
      previousKey: previousFeedKey,
      nextKey: feedKey,
      previousRowIds: previousFeedKey.split("|").filter(Boolean),
      nextRowIds: nextInitialRowIds,
      extra: {
        rawFeedKey,
        normalizedFeedKey: feedKey,
        rawInitialSignature,
        normalizedInitialSignature: nextInitialSignature,
        previousInitialFeedSignature: previousInitialSignature || null,
        nextInitialFeedSignature: nextInitialSignature || null,
        topRows: describeRowIds(rows, 0, 8),
      },
    });
    if (
      previousInitialSignature &&
      !posterFeedIdentitySetsEqual(previousInitialSignature, nextInitialSignature)
    ) {
      logPosterSessionSignatureChange({
        kind: "initial",
        reason: "initial-feed-signature-changed",
        previousSignature: previousInitialSignature,
        nextSignature: nextInitialSignature,
        previousRowIds: previousInitialSignature.split("|").filter(Boolean),
        nextRowIds: nextInitialRowIds,
        extra: {
          rawInitialSignature,
          normalizedInitialSignature: nextInitialSignature,
          topRows: describeRowIds(rows, 0, 8),
        },
      });
    }
    const feedReloaded = notePosterFeedKeyChanged(feedKey);
    lastInitialFeedKey = feedKey;
    lastInitialFeedSignature = nextInitialSignature;
    nextScrollPrewarmOrdinal = 0;
    initialPrewarmCompletedFeedKey = "";
    cancelBackgroundPosterGeneration("initial-feed-changed");
    if (feedReloaded) {
      console.log("POSTER_SESSION_FEED_RELOAD_NOTED", {
        previousFeedKey: previousFeedKey || null,
        nextFeedKey: feedKey,
        rawFeedKey,
        normalizedFeedKey: feedKey,
        previousInitialFeedSignature: previousInitialSignature || null,
        nextInitialFeedSignature: nextInitialSignature || null,
        rawInitialSignature,
        normalizedInitialSignature: nextInitialSignature,
        rowIds: nextInitialRowIds,
        resetSkipped: false,
      });
    }
  } else if (feedKey) {
    notePosterFeedKeyChanged(feedKey);
    lastInitialFeedSignature = nextInitialSignature;
  }

  const batch = sliceHomeFeedVideoPosts(rows, 0, INITIAL_VIDEO_COUNT);
  nextScrollPrewarmOrdinal = Math.max(nextScrollPrewarmOrdinal, batch.length);

  for (const item of batch) prefetchHomeFeedPosterMetadata(item);

  console.log("KRISTO_HOME_FEED_POSTER_PREWARM_START", {
    phase: "initial",
    batchCount: batch.length,
    nextScrollPrewarmOrdinal,
    feedKey: feedKey || null,
    rawFeedKey: rawFeedKey || null,
    normalizedFeedKey: feedKey || null,
  });

  prewarmVisibleHomeFeedVideoPosters(rows, 0, VISIBLE_PRIORITY_COUNT);

  const visibleItems = collectVisibleVideoPosts(rows, 0, VISIBLE_PRIORITY_COUNT);
  const visibleKeys = new Set(
    visibleItems
      .map((item) => prewarmKey(String(item?.id || "").trim(), posterVideoUrl(item)))
      .filter(Boolean)
  );

  const backgroundQueued = enqueueBackgroundItems(
    batch.filter((item) => {
      const key = prewarmKey(String(item?.id || "").trim(), posterVideoUrl(item));
      return Boolean(key && !visibleKeys.has(key));
    })
  );

  console.log("KRISTO_HOME_FEED_POSTER_PREWARM_START", {
    phase: "initial-background-queued",
    visibleCount: visibleItems.length,
    backgroundQueued,
    feedKey: feedKey || null,
  });

  void visibleDrainPromise?.then(() => {
    if (feedKey) initialPrewarmCompletedFeedKey = feedKey;
  });
}

/** Prewarm the next video posts when the user nears the end of loaded content. */
export function prewarmHomeFeedPostersOnNearEnd(
  rows: any[],
  activeIndex: number,
  visibleCount: number
) {
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

/** Reset initial prewarm guard when feed content materially changes (refresh / pagination). */
export function resetHomeFeedPosterPrewarmForFeedRefresh(rows: any[]) {
  const feedIdentity = describePosterFeedIdentity(rows);
  const key = feedIdentity.normalizedFeedKey || "";
  const rawFeedKey = feedIdentity.rawFeedKey || "";
  const rawInitialSignature = feedIdentity.rawInitialSignature || "";
  const normalizedInitialSignature = feedIdentity.normalizedInitialSignature || "";

  if (!key) return;

  if (posterFeedIdentitySetsEqual(key, lastInitialFeedKey)) {
    console.log("POSTER_SESSION_FEED_REFRESH_SKIPPED", {
      rawFeedKey: rawFeedKey || null,
      normalizedFeedKey: key,
      rawInitialSignature: rawInitialSignature || null,
      normalizedInitialSignature: normalizedInitialSignature || null,
      resetSkipped: true,
      reason: "normalized-identity-unchanged",
      previousNormalizedFeedKey: lastInitialFeedKey || null,
    });
    return;
  }

  const previousFeedKey = lastInitialFeedKey;
  const previousInitialSignature = lastInitialFeedSignature;
  logPosterSessionSignatureChange({
    kind: "feed",
    reason: "feed-refresh",
    previousKey: previousFeedKey,
    nextKey: key,
    previousRowIds: previousFeedKey.split("|").filter(Boolean),
    nextRowIds: feedIdentity.normalizedRowIds,
    extra: {
      rawFeedKey: rawFeedKey || null,
      normalizedFeedKey: key,
      rawInitialSignature: rawInitialSignature || null,
      normalizedInitialSignature: normalizedInitialSignature || null,
      previousInitialFeedSignature: previousInitialSignature || null,
      nextInitialFeedSignature: normalizedInitialSignature || null,
      resetSkipped: false,
    },
  });
  const feedReloaded = notePosterFeedKeyChanged(key);
  lastInitialFeedKey = key;
  lastInitialFeedSignature = normalizedInitialSignature;
  initialPrewarmCompletedFeedKey = "";
  nextScrollPrewarmOrdinal = 0;
  lastVisibleWarmSignature = "";
  cancelBackgroundPosterGeneration("feed-refresh");
  stopVisiblePosterRecheck();
  if (feedReloaded) {
    console.log("POSTER_SESSION_FEED_RELOAD_NOTED", {
      source: "feed-refresh",
      previousFeedKey: previousFeedKey || null,
      nextFeedKey: key,
      rawFeedKey: rawFeedKey || null,
      normalizedFeedKey: key,
      previousInitialFeedSignature: previousInitialSignature || null,
      nextInitialFeedSignature: normalizedInitialSignature || null,
      rawInitialSignature: rawInitialSignature || null,
      normalizedInitialSignature: normalizedInitialSignature || null,
      rowIds: feedIdentity.normalizedRowIds,
      resetSkipped: false,
    });
  }
}

export function isHomeFeedPosterPrewarmPending(postId: string, videoUrl: string): boolean {
  const key = prewarmKey(postId, videoUrl);
  return Boolean(key && inflight.has(key));
}

export function notifyVisibleHomeFeedPosterFocus(
  rows: any[],
  startIndex = 0,
  count = VISIBLE_PRIORITY_COUNT
) {
  prewarmVisibleHomeFeedVideoPosters(rows, startIndex, count);
}

/** Stop visible/background poster generation when Live Room navigation starts. */
export function pauseHomeFeedPosterWorkForLiveNavigation(reason = "live-navigation") {
  visibleRunId += 1;
  backgroundRunId += 1;
  visibleGenPending.length = 0;
  visibleGenQueuedKeys.clear();
  backgroundGenPending.length = 0;
  backgroundQueue.length = 0;
  backgroundKeySet.clear();
  visibleGenerationComplete = true;
  lastVisibleWarmSignature = "";
  stopVisiblePosterRecheck();
  cancelBackgroundPosterGeneration(reason);
}
