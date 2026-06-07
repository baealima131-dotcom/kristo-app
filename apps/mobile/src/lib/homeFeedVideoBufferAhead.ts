import { Image } from "react-native";
import {
  isVideoPost,
  resolvePosterUri,
  resolveVideoUri,
} from "@/src/components/homeFeed/homeFeedUtils";

import {
  HOME_FEED_PLAYER_WARM_AHEAD,
  HOME_FEED_PLAYER_WARM_BEHIND,
} from "./homeFeedVideoWindow";

const MAX_VIDEO_CONCURRENCY = 2;
const MAX_POSTER_CONCURRENCY = 2;
const RANGE_BYTES = "bytes=0-65535";

const STARTUP_COOLDOWN_MS = 3000;
const INITIAL_VIDEO_WARM_MAX = 4;
const ACTIVE_INDEX_VIDEO_WARM_MAX = 3;
const WINDOW_EXPAND_VIDEO_WARM_MAX = 5;
const POSTER_WARM_AHEAD_COUNT = 5;

const warmedVideoUrls = new Set<string>();
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

async function warmVideoUrlNetwork(videoUrl: string): Promise<VideoWarmNetworkResult> {
  const url = String(videoUrl || "").trim();
  const startMs = Date.now();

  try {
    const head = await fetch(url, { method: "HEAD" });
    if (head.ok || head.status === 206) {
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

  const range = await fetch(url, {
    method: "GET",
    headers: { Range: RANGE_BYTES },
  });
  return {
    status: range.status,
    bytesRange: true,
    ms: Date.now() - startMs,
    contentLength: parseHeaderContentLength(range.headers),
    acceptRanges: readResponseHeader(range.headers, "accept-ranges"),
    contentType: readResponseHeader(range.headers, "content-type"),
  };
}

export function wasHomeFeedVideoUrlBufferedAhead(videoUrl: string): boolean {
  const url = normalizeUrl(videoUrl);
  if (!url) return false;
  return warmedVideoUrls.has(url);
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

    const videoUrl = resolveVideoUri(row);
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

  const tailStart = Math.max(0, visibleCount - 15);
  const skip = playerWarmSkipIndices(activeIndex);
  return collectVideoPostsInRange(rows, tailStart, visibleEnd, WINDOW_EXPAND_VIDEO_WARM_MAX, skip);
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
    return key && !warmedVideoUrls.has(key) && !inflightVideoUrls.has(key);
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
      if (!videoUrl || warmedVideoUrls.has(videoUrl) || inflightVideoUrls.has(videoUrl)) {
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
          warmedVideoUrls.add(videoUrl);
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

/** App-launch media warm — no video players; shares warmed URL sets with Home Feed. */
export async function warmHomeFeedStartupMedia(
  rows: any[],
  opts?: { maxPosters?: number; maxVideos?: number; concurrency?: number }
): Promise<{ posterCount: number; videoCount: number }> {
  const maxPosters = Math.max(0, Number(opts?.maxPosters ?? 5));
  const maxVideos = Math.max(0, Number(opts?.maxVideos ?? 3));
  const concurrency = Math.max(1, Number(opts?.concurrency ?? MAX_VIDEO_CONCURRENCY));

  const posterUrls: string[] = [];
  const videoUrls: string[] = [];

  for (const row of rows) {
    if (!row || !isVideoPost(row)) continue;

    if (posterUrls.length < maxPosters) {
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

    if (videoUrls.length < maxVideos) {
      const videoUrl = normalizeUrl(resolveVideoUri(row));
      if (
        isNetworkVideoUrl(videoUrl) &&
        !warmedVideoUrls.has(videoUrl) &&
        !inflightVideoUrls.has(videoUrl) &&
        !videoUrls.includes(videoUrl)
      ) {
        videoUrls.push(videoUrl);
      }
    }

    if (posterUrls.length >= maxPosters && videoUrls.length >= maxVideos) break;
  }

  await runWithConcurrency(posterUrls, concurrency, async (posterUrl) => {
    if (warmedPosterUrls.has(posterUrl) || inflightPosterUrls.has(posterUrl)) return;
    inflightPosterUrls.add(posterUrl);
    try {
      await Image.prefetch(posterUrl);
      warmedPosterUrls.add(posterUrl);
    } catch {
      warmedPosterUrls.delete(posterUrl);
    } finally {
      inflightPosterUrls.delete(posterUrl);
    }
  });

  await runWithConcurrency(videoUrls, concurrency, async (videoUrl) => {
    if (warmedVideoUrls.has(videoUrl) || inflightVideoUrls.has(videoUrl)) return;
    inflightVideoUrls.add(videoUrl);
    try {
      await warmVideoUrlNetwork(videoUrl);
      warmedVideoUrls.add(videoUrl);
    } catch {
      warmedVideoUrls.delete(videoUrl);
    } finally {
      inflightVideoUrls.delete(videoUrl);
    }
  });

  return { posterCount: posterUrls.length, videoCount: videoUrls.length };
}
