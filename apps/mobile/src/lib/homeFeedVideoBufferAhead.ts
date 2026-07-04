import { Image } from "react-native";
import { getHomeFeedPosterLoadTimeoutMs, withPreviewTimeout } from "@/src/lib/videoGridThumbnail";
import {
  isVideoPost,
  resolvePosterUri,
  resolveVideoUri,
} from "@/src/components/homeFeed/homeFeedUtils";

import {
  HOME_FEED_PLAYER_WARM_AHEAD,
  HOME_FEED_PLAYER_WARM_BEHIND,
} from "./homeFeedVideoWindow";
import {
  getFirstHomeFeedVideoPlaybackPlans,
  logHomeFeedVideoQualityTrace,
  resolveHomeFeedVideoPlaybackPlan,
} from "@/src/lib/homeFeedVideoQuality";
import {
  hasHomeFeedVideoWarmKey,
  markHomeFeedVideoWarmKey,
  unmarkHomeFeedVideoWarmKey,
} from "@/src/lib/homeFeedVideoWarmRegistry";
import { isHomeFeedPosterPrewarmDisabled } from "@/src/lib/homeFeedVideoMode";

export { wasHomeFeedVideoUrlBufferedAhead } from "@/src/lib/homeFeedVideoWarmRegistry";
import {
  logHomeFeedNetworkTrace,
  markVideoHeadWarmed,
  wasVideoHeadRecentlyWarmed,
} from "@/src/lib/homeFeedNetwork";
import {
  isHomeFeedActiveFirstFrameReady,
  subscribeHomeFeedActiveFirstFrame,
} from "@/src/lib/homeFeedVideoReadiness";
import { shouldDeferBackgroundMediaJobs } from "@/src/lib/homeFeedWatchPlaybackPriority";

const MAX_VIDEO_CONCURRENCY = 2;
const MAX_POSTER_CONCURRENCY = 2;
const RANGE_BYTES = "bytes=0-65535";
const FIRST_VIDEO_RANGE_BYTES = "bytes=0-393215";
const STARTUP_PREWARM_VIDEO_MAX = 1;

// Startup critical path: the first playable video's startup bytes are warmed
// with a realistic budget so the warm actually LANDS (priming the CDN edge for
// AVPlayer's own range requests). The whole startup-prewarm runs fire-and-forget
// (void), so a larger budget never blocks Home Feed mount — and a 3s budget was
// too tight to ever complete a cold R2 fetch, leaving videoCount:0 / prewarmHit
// false. Matches the buffer-ahead fetch budget below.
const FIRST_VIDEO_WARM_TIMEOUT_MS = 8000;
// Remaining posters/videos warm only after the first frame paints (or this
// fallback elapses) so they never steal bandwidth from the first video.
const BACKGROUND_WARM_AFTER_FIRST_FRAME_MS = 5000;

const STARTUP_COOLDOWN_MS = 3000;
// Staged buffering: active video + next 1–2 only (never the whole feed at once).
const INITIAL_VIDEO_WARM_MAX = 2;
const ACTIVE_INDEX_VIDEO_WARM_MAX = 2;
const WINDOW_EXPAND_VIDEO_WARM_MAX = 2;
const POSTER_WARM_AHEAD_COUNT = 2;

const warmedPosterUrls = new Set<string>();
const inflightVideoUrls = new Set<string>();
const inflightPosterUrls = new Set<string>();

const pendingVideoTasks: Array<() => Promise<void>> = [];
const pendingPosterUrls: string[] = [];
let activeVideoWorkers = 0;
let activePosterWorkers = 0;

let prefetchSessionId = 0;
let prefetchEnabled = false;
let initialFeedReadyAtMs = 0;
let initialFeedReadyActiveIndex = 0;

type NetworkWarmPolicy = "allow" | "posters-only" | "skip";

export type HomeFeedBufferAheadReason =
  | "initial-feed-ready"
  | "active-index"
  | "window-expand";

type BufferAheadTarget = {
  videoUrl: string;
  posterUrl: string;
  rowIndex: number;
};

function normalizeUrl(url: string): string {
  return String(url || "").trim().split("?")[0];
}

function urlHost(raw: string): string {
  const value = String(raw || "").trim();
  if (!value) return "unknown";
  try {
    return new URL(value).host || "unknown";
  } catch {
    return "unknown";
  }
}

function isNetworkVideoUrl(url: string): boolean {
  const trimmed = String(url || "").trim();
  return Boolean(trimmed) && /^https?:\/\//i.test(trimmed);
}

export function beginHomeFeedPrefetchSession(): number {
  prefetchSessionId += 1;
  prefetchEnabled = true;
  initialFeedReadyAtMs = 0;
  initialFeedReadyActiveIndex = 0;
  return prefetchSessionId;
}

export function endHomeFeedPrefetchSession(): void {
  prefetchEnabled = false;
  prefetchSessionId += 1;
  pendingVideoTasks.length = 0;
  pendingPosterUrls.length = 0;
}

function isPrefetchAllowed(sessionId: number): boolean {
  return prefetchEnabled && sessionId === prefetchSessionId;
}

async function resolveNetworkWarmPolicy(): Promise<NetworkWarmPolicy> {
  const conn = (globalThis as any)?.navigator?.connection;
  if (conn) {
    if (conn.onLine === false) return "skip";
    const type = String(conn.type || conn.effectiveType || "").toLowerCase();
    if (type === "wifi" || type === "ethernet") return "allow";
    if (type === "cellular" || type === "2g" || type === "3g" || type === "slow-2g") {
      return "posters-only";
    }
  }
  return "allow";
}

function drainVideoQueue() {
  while (activeVideoWorkers < MAX_VIDEO_CONCURRENCY && pendingVideoTasks.length > 0) {
    const task = pendingVideoTasks.shift();
    if (!task) break;
    activeVideoWorkers += 1;
    void task()
      .catch(() => {})
      .finally(() => {
        activeVideoWorkers -= 1;
        drainVideoQueue();
      });
  }
}

function enqueueVideoTask(task: () => Promise<void>) {
  pendingVideoTasks.push(task);
  drainVideoQueue();
}

function drainPosterQueue(sessionId: number) {
  while (
    activePosterWorkers < MAX_POSTER_CONCURRENCY &&
    pendingPosterUrls.length > 0 &&
    isPrefetchAllowed(sessionId)
  ) {
    const url = pendingPosterUrls.shift();
    if (!url) break;
    if (warmedPosterUrls.has(url) || inflightPosterUrls.has(url)) continue;

    inflightPosterUrls.add(url);
    activePosterWorkers += 1;
    void (async () => {
      try {
        if (!isPrefetchAllowed(sessionId)) return;
        await Image.prefetch(url);
        warmedPosterUrls.add(url);
      } catch {
        warmedPosterUrls.delete(url);
      } finally {
        inflightPosterUrls.delete(url);
        activePosterWorkers -= 1;
        drainPosterQueue(sessionId);
      }
    })();
  }
}

function enqueuePosterWarm(posterUrl: string, sessionId: number) {
  const url = normalizeUrl(posterUrl);
  if (!url) return;
  if (!isPrefetchAllowed(sessionId)) {
    console.log("KRISTO_POSTER_PREFETCH_SKIP", { reason: "session-ended" });
    return;
  }
  if (warmedPosterUrls.has(url)) {
    logHomeFeedNetworkTrace({ event: "poster-skip-cached", posterUrl: url });
    return;
  }
  if (inflightPosterUrls.has(url) || pendingPosterUrls.includes(url)) {
    return;
  }

  pendingPosterUrls.push(url);
  drainPosterQueue(sessionId);
}

type VideoWarmNetworkResult = {
  status: number;
  bytesRange: boolean;
  ms: number;
  contentLength: number | null;
  acceptRanges: string | null;
  contentType: string | null;
};

function readResponseHeader(headers: Headers, name: string): string | null {
  const value = String(headers.get(name) || "").trim();
  return value || null;
}

function parseHeaderContentLength(headers: Headers): number | null {
  const value = Number(headers.get("content-length") || 0);
  return Number.isFinite(value) && value > 0 ? value : null;
}

const VIDEO_WARM_FETCH_TIMEOUT_MS = 8000;

async function warmVideoUrlNetwork(
  videoUrl: string,
  opts?: { rangeHeader?: string; timeoutMs?: number }
): Promise<VideoWarmNetworkResult> {
  const url = String(videoUrl || "").trim();
  const normalized = normalizeUrl(url);
  const startMs = Date.now();
  const rangeHeader = opts?.rangeHeader || RANGE_BYTES;
  const timeoutMs = Math.max(1000, Number(opts?.timeoutMs ?? VIDEO_WARM_FETCH_TIMEOUT_MS));

  if (wasVideoHeadRecentlyWarmed(normalized)) {
    logHomeFeedNetworkTrace({
      event: "video-head-skip-cached",
      videoUrl: normalized,
    });
    return {
      status: 200,
      bytesRange: false,
      ms: 0,
      contentLength: null,
      acceptRanges: null,
      contentType: null,
    };
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  try {
    // Range-first: moov-at-front videos start decoding sooner than HEAD alone.
    const range = await fetch(url, {
      method: "GET",
      headers: { Range: rangeHeader },
      signal: controller.signal,
    });
    if (range.ok || range.status === 206) {
      markVideoHeadWarmed(normalized);
      clearTimeout(timeout);
      return {
        status: range.status,
        bytesRange: true,
        ms: Date.now() - startMs,
        contentLength: parseHeaderContentLength(range.headers),
        acceptRanges: readResponseHeader(range.headers, "accept-ranges"),
        contentType: readResponseHeader(range.headers, "content-type"),
      };
    }
  } catch {}

  try {
    const head = await fetch(url, { method: "HEAD", signal: controller.signal });
    if (head.ok || head.status === 206) {
      markVideoHeadWarmed(normalized);
      clearTimeout(timeout);
      return {
        status: head.status,
        bytesRange: false,
        ms: Date.now() - startMs,
        contentLength: parseHeaderContentLength(head.headers),
        acceptRanges: readResponseHeader(head.headers, "accept-ranges"),
        contentType: readResponseHeader(head.headers, "content-type"),
      };
    }
  } catch {}

  clearTimeout(timeout);
  throw new Error("video-warm-failed");
}

export function wasHomeFeedPosterWarmed(posterUrl: string): boolean {
  const url = normalizeUrl(posterUrl);
  if (!url) return false;
  return warmedPosterUrls.has(url);
}

function collectVideoPostsInRange(
  rows: any[],
  startIndex: number,
  endIndexExclusive: number,
  maxCount: number,
  skipIndices?: Set<number>
): BufferAheadTarget[] {
  const targets: BufferAheadTarget[] = [];
  const end = Math.min(endIndexExclusive, rows.length);

  for (let i = Math.max(0, startIndex); i < end && targets.length < maxCount; i += 1) {
    if (skipIndices?.has(i)) continue;
    const row = rows[i];
    if (!row || !isVideoPost(row)) continue;

    const plan = resolveHomeFeedVideoPlaybackPlan(row);
    const videoUrl = String(plan.startupUri || resolveVideoUri(row) || "").trim();
    if (!isNetworkVideoUrl(videoUrl)) continue;

    const posterUrl = String(resolvePosterUri(row) || "").trim();
    targets.push({ videoUrl, posterUrl, rowIndex: i });
  }

  return targets;
}

function playerWarmSkipIndices(activeIndex: number): Set<number> {
  const skip = new Set<number>();
  for (
    let offset = -HOME_FEED_PLAYER_WARM_BEHIND;
    offset <= HOME_FEED_PLAYER_WARM_AHEAD;
    offset += 1
  ) {
    skip.add(activeIndex + offset);
  }
  return skip;
}

export function selectHomeFeedVideoBufferAheadTargets(
  rows: any[],
  activeIndex: number,
  visibleCount: number,
  reason: HomeFeedBufferAheadReason
): BufferAheadTarget[] {
  const visibleEnd = Math.min(visibleCount, rows.length);
  if (visibleEnd <= 0) return [];

  if (reason === "initial-feed-ready") {
    return collectVideoPostsInRange(rows, 0, visibleEnd, INITIAL_VIDEO_WARM_MAX);
  }

  if (reason === "active-index") {
    const skip = playerWarmSkipIndices(activeIndex);
    const start = activeIndex + 1;
    return collectVideoPostsInRange(rows, start, visibleEnd, ACTIVE_INDEX_VIDEO_WARM_MAX, skip);
  }

  const skip = playerWarmSkipIndices(activeIndex);
  const start = activeIndex + 1;
  return collectVideoPostsInRange(rows, start, visibleEnd, WINDOW_EXPAND_VIDEO_WARM_MAX, skip);
}

function dedupeTargets(targets: BufferAheadTarget[]): BufferAheadTarget[] {
  const seen = new Set<string>();
  const out: BufferAheadTarget[] = [];
  for (const target of targets) {
    const key = normalizeUrl(target.videoUrl);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    out.push(target);
  }
  return out;
}

/** Prefetch posters for active row + next N video rows only. */
export function warmHomeFeedVideoPostersNearActive(
  rows: any[],
  activeIndex: number,
  sessionId = prefetchSessionId
): void {
  if (isHomeFeedPosterPrewarmDisabled()) return;
  if (shouldDeferBackgroundMediaJobs()) return;
  if (!isPrefetchAllowed(sessionId)) {
    console.log("KRISTO_POSTER_PREFETCH_SKIP", { reason: "session-ended" });
    return;
  }
  if (!rows.length) {
    console.log("KRISTO_POSTER_PREFETCH_SKIP", { reason: "empty-rows" });
    return;
  }

  const end = Math.min(rows.length, activeIndex + POSTER_WARM_AHEAD_COUNT + 1);
  const queued: string[] = [];

  for (let i = Math.max(0, activeIndex); i < end; i += 1) {
    const row = rows[i];
    if (!row || !isVideoPost(row)) continue;
    const posterUrl = normalizeUrl(resolvePosterUri(row));
    if (!posterUrl || warmedPosterUrls.has(posterUrl)) continue;
    if (inflightPosterUrls.has(posterUrl) || queued.includes(posterUrl)) continue;
    queued.push(posterUrl);
  }

  if (!queued.length) {
    console.log("KRISTO_POSTER_PREFETCH_SKIP", { reason: "already-warmed" });
    return;
  }

  console.log("KRISTO_POSTER_PREFETCH_START", { queued: queued.length });
  for (const posterUrl of queued) {
    enqueuePosterWarm(posterUrl, sessionId);
  }
}

/** @deprecated Use warmHomeFeedVideoPostersNearActive */
export function warmVisibleHomeFeedVideoPosters(rows: any[], visibleCount: number): void {
  warmHomeFeedVideoPostersNearActive(rows, 0);
}

export function scheduleHomeFeedVideoBufferAhead(params: {
  rows: any[];
  activeIndex: number;
  visibleCount: number;
  reason: HomeFeedBufferAheadReason;
  enabled?: boolean;
}): void {
  if (shouldDeferBackgroundMediaJobs()) return;

  const sessionId = prefetchSessionId;

  if (!isPrefetchAllowed(sessionId)) {
    console.log("KRISTO_VIDEO_BUFFER_AHEAD_SKIP", { reason: "session-ended" });
    return;
  }

  const enabled = params.enabled !== false;
  if (!enabled) {
    console.log("KRISTO_VIDEO_BUFFER_AHEAD_SKIP", { reason: "disabled" });
    return;
  }

  if (
    params.reason === "active-index" &&
    initialFeedReadyAtMs > 0 &&
    Date.now() - initialFeedReadyAtMs < STARTUP_COOLDOWN_MS &&
    params.activeIndex === initialFeedReadyActiveIndex
  ) {
    console.log("KRISTO_VIDEO_BUFFER_AHEAD_SKIP", { reason: "startup-cooldown" });
    return;
  }

  const visibleCount = Math.max(0, Math.min(params.visibleCount, params.rows.length));
  if (!visibleCount) {
    console.log("KRISTO_VIDEO_BUFFER_AHEAD_SKIP", { reason: "empty-visible-window" });
    return;
  }

  if (params.reason === "initial-feed-ready") {
    initialFeedReadyAtMs = Date.now();
    initialFeedReadyActiveIndex = params.activeIndex;
  }

  const rawTargets = selectHomeFeedVideoBufferAheadTargets(
    params.rows,
    params.activeIndex,
    visibleCount,
    params.reason
  );
  const targets = dedupeTargets(rawTargets).filter((t) => {
    const key = normalizeUrl(t.videoUrl);
    if (!key) return false;
    if (wasVideoHeadRecentlyWarmed(key) || hasHomeFeedVideoWarmKey(key) || inflightVideoUrls.has(key)) {
      return false;
    }
    return true;
  });

  if (!targets.length) {
    console.log("KRISTO_VIDEO_BUFFER_AHEAD_SKIP", { reason: "already-warmed" });
    return;
  }

  console.log("KRISTO_VIDEO_BUFFER_AHEAD_START", {
    activeIndex: params.activeIndex,
    queued: targets.length,
    visibleCount,
    reason: params.reason,
  });

  void (async () => {
    if (!isPrefetchAllowed(sessionId)) return;

    const policy = await resolveNetworkWarmPolicy();
    if (!isPrefetchAllowed(sessionId)) return;
    if (policy === "skip") {
      console.log("KRISTO_VIDEO_BUFFER_AHEAD_SKIP", { reason: "offline" });
      return;
    }

    const warmVideos = policy === "allow";
    if (!warmVideos) return;

    for (const target of targets) {
      if (!isPrefetchAllowed(sessionId)) return;

      const videoUrl = normalizeUrl(target.videoUrl);
      if (!videoUrl || hasHomeFeedVideoWarmKey(videoUrl) || inflightVideoUrls.has(videoUrl)) {
        continue;
      }

      inflightVideoUrls.add(videoUrl);
      enqueueVideoTask(async () => {
        if (!isPrefetchAllowed(sessionId)) {
          inflightVideoUrls.delete(videoUrl);
          return;
        }

        const host = urlHost(videoUrl);
        try {
          const result = await warmVideoUrlNetwork(videoUrl);
          if (!isPrefetchAllowed(sessionId)) return;
          markHomeFeedVideoWarmKey(videoUrl);
          console.log("KRISTO_VIDEO_BUFFER_AHEAD_DONE", {
            urlHost: host,
            status: result.status,
            bytesRange: result.bytesRange,
            ms: result.ms,
            contentLength: result.contentLength,
            acceptRanges: result.acceptRanges,
            contentType: result.contentType,
          });
        } catch {
          console.log("KRISTO_VIDEO_BUFFER_AHEAD_SKIP", {
            reason: "fetch-failed",
            urlHost: host,
          });
        } finally {
          inflightVideoUrls.delete(videoUrl);
        }
      });
    }
  })();
}

async function runWithConcurrency<T>(
  items: T[],
  concurrency: number,
  worker: (item: T) => Promise<void>
) {
  if (!items.length) return;
  let cursor = 0;
  const workers = Array.from(
    { length: Math.min(Math.max(1, concurrency), items.length) },
    async () => {
      while (cursor < items.length) {
        const index = cursor;
        cursor += 1;
        await worker(items[index]);
      }
    }
  );
  await Promise.all(workers);
}

export type HomeFeedStartupMediaWarmResult = {
  posterCount: number;
  videoCount: number;
  posterFailed: number;
  videoFailed: number;
};

/** Run a background warm task once the active first frame paints (or after a fallback). */
function runAfterActiveFirstFrame(task: () => void, fallbackMs: number) {
  if (isHomeFeedActiveFirstFrameReady()) {
    task();
    return;
  }

  let done = false;
  const fire = () => {
    if (done) return;
    done = true;
    try {
      unsubscribe();
    } catch {}
    clearTimeout(timer);
    task();
  };

  const unsubscribe = subscribeHomeFeedActiveFirstFrame(fire);
  const timer = setTimeout(fire, Math.max(0, fallbackMs));
}

/** Prefetch a single poster; failures are swallowed and never block the caller. */
async function warmStartupPoster(
  posterUrl: string,
  timeoutMs: number
): Promise<"ok" | "failed" | "skip"> {
  if (!posterUrl) return "skip";
  if (warmedPosterUrls.has(posterUrl)) return "ok";
  if (inflightPosterUrls.has(posterUrl)) return "skip";

  inflightPosterUrls.add(posterUrl);
  try {
    const ok = await withPreviewTimeout(
      Image.prefetch(posterUrl).then(() => true),
      timeoutMs,
      false
    );
    if (ok) {
      warmedPosterUrls.add(posterUrl);
      return "ok";
    }
    warmedPosterUrls.delete(posterUrl);
    return "failed";
  } catch {
    warmedPosterUrls.delete(posterUrl);
    return "failed";
  } finally {
    inflightPosterUrls.delete(posterUrl);
  }
}

/** Warm a single video plan's startup bytes; failures are swallowed (non-blocking). */
async function warmStartupVideoPlan(
  plan: ReturnType<typeof getFirstHomeFeedVideoPlaybackPlans>[number],
  isFirst: boolean,
  timeoutMs: number
): Promise<"ok" | "failed" | "skip"> {
  const target = normalizeUrl(plan.startupUri);
  if (!isNetworkVideoUrl(target)) return "skip";
  if (hasHomeFeedVideoWarmKey(target)) return "ok";
  if (inflightVideoUrls.has(target)) return "skip";

  inflightVideoUrls.add(target);
  try {
    logHomeFeedVideoQualityTrace({
      event: "prewarm-start",
      postId: plan.postId,
      selectedStartupUrl: target,
      lowResVideoUrl: plan.lowResVideoUrl,
      originalVideoUrl: plan.fullQualityUri,
      hasLowRes: plan.hasLowRes,
      rangeHeader: isFirst ? FIRST_VIDEO_RANGE_BYTES : RANGE_BYTES,
      firstVideo: isFirst,
    });
    await warmVideoUrlNetwork(target, {
      rangeHeader: isFirst ? FIRST_VIDEO_RANGE_BYTES : RANGE_BYTES,
      timeoutMs,
    });
    markHomeFeedVideoWarmKey(target);
    logHomeFeedVideoQualityTrace({
      event: "prewarm-done",
      postId: plan.postId,
      selectedStartupUrl: target,
      prewarmHit: true,
      firstVideo: isFirst,
    });
    return "ok";
  } catch {
    unmarkHomeFeedVideoWarmKey(target);
    logHomeFeedVideoQualityTrace({
      event: "prewarm-failed",
      postId: plan.postId,
      selectedStartupUrl: target,
      firstVideo: isFirst,
    });
    return "failed";
  } finally {
    inflightVideoUrls.delete(target);
  }
}

export type HomeFeedEarlyWarmResult = {
  rowId: string;
  url: string;
  status: number;
  ms: number;
  prewarmHit: boolean;
};

/**
 * Cold-start critical path: prime the EXACT first playable video that
 * HomeFeedScreen will mount (display-ordered rows, not raw backend order) by
 * fetching startup URI bytes with Range. Marks warm registry so diagnostics
 * report prewarmHit=true; AVPlayer still opens its own progressive download —
 * this does not guarantee a fast first frame by itself. Runs before API
 * refresh / posters / next videos.
 */
export async function earlyWarmHomeFeedFirstVideo(
  orderedRows: any[],
  verifiedStartupUri?: string
): Promise<HomeFeedEarlyWarmResult | null> {
  let rowId = "";
  let url = "";
  for (const row of orderedRows || []) {
    if (!row || !isVideoPost(row)) continue;
    const plan = resolveHomeFeedVideoPlaybackPlan(row);
    const candidate = normalizeUrl(
      verifiedStartupUri || plan.startupUri || plan.fullQualityUri
    );
    if (!isNetworkVideoUrl(candidate)) continue;
    rowId = String(row?.id || "").trim();
    url = candidate;
    break;
  }

  if (!url) return null;

  if (hasHomeFeedVideoWarmKey(url)) {
    const cached = { rowId, url, status: 200, ms: 0, prewarmHit: true };
    console.log("KRISTO_FIRST_VIDEO_EARLY_WARM_DONE", { ...cached, reason: "already-warmed" });
    return cached;
  }

  const startMs = Date.now();
  console.log("KRISTO_FIRST_VIDEO_EARLY_WARM_START", {
    rowId,
    url,
    rangeHeader: FIRST_VIDEO_RANGE_BYTES,
  });

  inflightVideoUrls.add(url);
  try {
    const result = await warmVideoUrlNetwork(url, {
      rangeHeader: FIRST_VIDEO_RANGE_BYTES,
      timeoutMs: FIRST_VIDEO_WARM_TIMEOUT_MS,
    });
    const ok = result.status === 206 || result.status === 200;
    if (ok) markHomeFeedVideoWarmKey(url);
    const done = {
      rowId,
      url,
      status: result.status,
      ms: Date.now() - startMs,
      prewarmHit: ok,
    };
    console.log("KRISTO_FIRST_VIDEO_EARLY_WARM_DONE", done);
    return done;
  } catch {
    const done = { rowId, url, status: 0, ms: Date.now() - startMs, prewarmHit: false };
    console.log("KRISTO_FIRST_VIDEO_EARLY_WARM_DONE", done);
    return done;
  } finally {
    inflightVideoUrls.delete(url);
  }
}

/**
 * App-launch media warm — first-video-first. Only the first playable video is
 * awaited (with a tight timeout) before returning so the startup-prewarm DONE
 * log fires fast. The first poster is then warmed (non-blocking on failure).
 * All remaining posters/videos are warmed in the background only after the
 * active first frame paints, so they never compete with the first video for
 * bandwidth. Shares warmed URL sets with Home Feed.
 */
export async function warmHomeFeedStartupMedia(
  rows: any[],
  opts?: { maxPosters?: number; maxVideos?: number; concurrency?: number }
): Promise<HomeFeedStartupMediaWarmResult> {
  if (shouldDeferBackgroundMediaJobs()) {
    return { posterCount: 0, posterFailed: 0, videoCount: 0, videoFailed: 0 };
  }

  const maxPosters = Math.max(0, Number(opts?.maxPosters ?? 5));
  const maxVideos = Math.max(0, Number(opts?.maxVideos ?? 3));
  const posterPrefetchTimeoutMs = getHomeFeedPosterLoadTimeoutMs();

  const posterUrls: string[] = [];
  const startupPlans = getFirstHomeFeedVideoPlaybackPlans(
    rows,
    Math.max(1, Math.min(maxVideos, STARTUP_PREWARM_VIDEO_MAX))
  );

  for (const row of rows) {
    if (!row || !isVideoPost(row)) continue;
    if (posterUrls.length >= maxPosters) break;

    const posterUrl = normalizeUrl(resolvePosterUri(row));
    if (
      posterUrl &&
      !warmedPosterUrls.has(posterUrl) &&
      !inflightPosterUrls.has(posterUrl) &&
      !posterUrls.includes(posterUrl)
    ) {
      posterUrls.push(posterUrl);
    }
  }

  let posterCount = 0;
  let posterFailed = 0;
  let videoCount = 0;
  let videoFailed = 0;

  // CRITICAL PATH — first playable video only, awaited with a tight timeout.
  const firstPlan = startupPlans[0];
  if (firstPlan) {
    const result = await warmStartupVideoPlan(firstPlan, true, FIRST_VIDEO_WARM_TIMEOUT_MS);
    if (result === "ok") videoCount += 1;
    else if (result === "failed") videoFailed += 1;
  }

  // First poster — awaited so the poster fallback is ready immediately, but a
  // failed/slow R2 fetch can never block (timeout returns false).
  const firstPoster = posterUrls[0];
  if (firstPoster) {
    const result = await warmStartupPoster(firstPoster, posterPrefetchTimeoutMs);
    if (result === "ok") posterCount += 1;
    else if (result === "failed") posterFailed += 1;
  }

  // BACKGROUND — remaining posters + videos warm only after first frame paints
  // (or a short fallback). Never awaited, never blocks the DONE log.
  const remainingPlans = startupPlans.slice(1);
  const remainingPosters = posterUrls.slice(1);
  if (remainingPlans.length || remainingPosters.length) {
    runAfterActiveFirstFrame(() => {
      void runWithConcurrency(remainingPosters, MAX_POSTER_CONCURRENCY, async (posterUrl) => {
        await warmStartupPoster(posterUrl, posterPrefetchTimeoutMs);
      });
      for (const plan of remainingPlans) {
        const target = normalizeUrl(plan.startupUri);
        if (!isNetworkVideoUrl(target)) continue;
        if (hasHomeFeedVideoWarmKey(target) || inflightVideoUrls.has(target)) continue;
        enqueueVideoTask(() =>
          warmStartupVideoPlan(plan, false, VIDEO_WARM_FETCH_TIMEOUT_MS).then(() => {})
        );
      }
    }, BACKGROUND_WARM_AFTER_FIRST_FRAME_MS);
  }

  return { posterCount, videoCount, posterFailed, videoFailed };
}
