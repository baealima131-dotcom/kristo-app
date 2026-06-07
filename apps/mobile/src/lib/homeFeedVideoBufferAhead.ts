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

const MAX_CONCURRENCY = 2;
const RANGE_BYTES = "bytes=0-65535";

const warmedVideoUrls = new Set<string>();
const warmedPosterUrls = new Set<string>();
const inflightVideoUrls = new Set<string>();

const pendingTasks: Array<() => Promise<void>> = [];
let activeWorkers = 0;

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

function drainQueue() {
  while (activeWorkers < MAX_CONCURRENCY && pendingTasks.length > 0) {
    const task = pendingTasks.shift();
    if (!task) break;
    activeWorkers += 1;
    void task()
      .catch(() => {})
      .finally(() => {
        activeWorkers -= 1;
        drainQueue();
      });
  }
}

function enqueueTask(task: () => Promise<void>) {
  pendingTasks.push(task);
  drainQueue();
}

async function warmPosterUrl(posterUrl: string): Promise<void> {
  const url = String(posterUrl || "").trim();
  if (!url || warmedPosterUrls.has(url)) return;
  warmedPosterUrls.add(url);
  try {
    await Image.prefetch(url);
  } catch {
    warmedPosterUrls.delete(url);
  }
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
  const url = String(videoUrl || "").trim().split("?")[0];
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
    return collectVideoPostsInRange(rows, 0, visibleEnd, 8);
  }

  if (reason === "active-index") {
    const skip = playerWarmSkipIndices(activeIndex);
    const start = activeIndex + 1;
    return collectVideoPostsInRange(rows, start, visibleEnd, 6, skip);
  }

  // window-expand: warm videos in the newly exposed tail slice.
  const tailStart = Math.max(0, visibleCount - 15);
  const skip = playerWarmSkipIndices(activeIndex);
  return collectVideoPostsInRange(rows, tailStart, visibleEnd, 10, skip);
}

function dedupeTargets(targets: BufferAheadTarget[]): BufferAheadTarget[] {
  const seen = new Set<string>();
  const out: BufferAheadTarget[] = [];
  for (const target of targets) {
    const key = target.videoUrl;
    if (!key || seen.has(key)) continue;
    seen.add(key);
    out.push(target);
  }
  return out;
}

/** Poster-only warm for every video row in the visible window (no players). */
export function warmVisibleHomeFeedVideoPosters(rows: any[], visibleCount: number): void {
  const end = Math.min(Math.max(0, visibleCount), rows.length);
  for (let i = 0; i < end; i += 1) {
    const row = rows[i];
    if (!row || !isVideoPost(row)) continue;
    const posterUrl = String(resolvePosterUri(row) || "").trim();
    if (posterUrl) void warmPosterUrl(posterUrl);
  }
}

export function scheduleHomeFeedVideoBufferAhead(params: {
  rows: any[];
  activeIndex: number;
  visibleCount: number;
  reason: HomeFeedBufferAheadReason;
  enabled?: boolean;
}): void {
  const enabled = params.enabled !== false;
  if (!enabled) {
    console.log("KRISTO_VIDEO_BUFFER_AHEAD_SKIP", { reason: "disabled" });
    return;
  }

  const visibleCount = Math.max(0, Math.min(params.visibleCount, params.rows.length));
  if (!visibleCount) {
    console.log("KRISTO_VIDEO_BUFFER_AHEAD_SKIP", { reason: "empty-visible-window" });
    return;
  }

  const rawTargets = selectHomeFeedVideoBufferAheadTargets(
    params.rows,
    params.activeIndex,
    visibleCount,
    params.reason
  );
  const targets = dedupeTargets(rawTargets).filter(
    (t) => !warmedVideoUrls.has(t.videoUrl) && !inflightVideoUrls.has(t.videoUrl)
  );

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
    const policy = await resolveNetworkWarmPolicy();
    if (policy === "skip") {
      console.log("KRISTO_VIDEO_BUFFER_AHEAD_SKIP", { reason: "offline" });
      return;
    }

    const warmVideos = policy === "allow";

    for (const target of targets) {
      if (target.posterUrl) {
        void warmPosterUrl(target.posterUrl);
      }
      if (!warmVideos) continue;
      if (warmedVideoUrls.has(target.videoUrl) || inflightVideoUrls.has(target.videoUrl)) {
        continue;
      }

      const videoUrl = target.videoUrl;
      inflightVideoUrls.add(videoUrl);
      enqueueTask(async () => {
        const host = urlHost(videoUrl);
        try {
          const result = await warmVideoUrlNetwork(videoUrl);
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
