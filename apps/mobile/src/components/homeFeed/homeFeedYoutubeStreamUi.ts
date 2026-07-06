import { resolveYouTubeFeedMetadataPosterUri } from "./homeFeedUtils";
import type { HomeFeedYoutubeScrollMetrics } from "./homeFeedPageCache";

/** Minimum skeleton time before first page paints (0 = paint as soon as rows exist). */
export const HOME_FEED_YOUTUBE_SKELETON_MIN_MS = 0;

/** Maximum wait for poster metadata before showing page0 anyway. */
export const HOME_FEED_YOUTUBE_SKELETON_MAX_MS = 320;

/** Pause with bottom loader visible before fetching/hydrating the next page. */
export const HOME_FEED_YOUTUBE_PAGINATION_PAUSE_MS = 800;

/** Max wait for batch covers before append/unlock (pre- and post-append). */
export const HOME_FEED_YOUTUBE_VISUAL_READY_TIMEOUT_MS = 2500;

/** Head covers that must be cached before a batch may append or unlock pagination. */
export const HOME_FEED_YOUTUBE_APPEND_POSTER_HEAD_COUNT = 3;
export const HOME_FEED_YOUTUBE_APPEND_POSTER_CONCURRENCY = 3;

/** Block next pagination while the current batch settles after append. */
export const HOME_FEED_YOUTUBE_PAGE_SETTLING_MIN_MS = 1200;
export const HOME_FEED_YOUTUBE_PAGE_SETTLING_MAX_MS = 1800;

/** Do not near-end paginate on short lists with fewer than this many rows. */
export const HOME_FEED_YOUTUBE_MIN_ROWS_BEFORE_PAGINATION = 5;

/** List must exceed viewport by this ratio before near-end pagination applies on sparse batches. */
export const HOME_FEED_YOUTUBE_LIST_OVERFLOW_RATIO = 1.15;

/** Throttle repeated prefetch-skip logs per reason. */
export const HOME_FEED_YOUTUBE_PREFETCH_LOG_THROTTLE_MS = 1500;

/** Wait for bottom skeleton minimum before disk/API page load. */
export async function waitForYoutubeBottomLoadGate(): Promise<void> {
  const waitMs = HOME_FEED_YOUTUBE_PAGINATION_PAUSE_MS;
  const start = Date.now();
  while (Date.now() - start < waitMs) {
    await new Promise((resolve) => setTimeout(resolve, 48));
  }
}

export function youtubeRowHasPosterMetadata(row: any): boolean {
  if (!row || typeof row !== "object") return false;
  const postId = String(row?.id || "").trim();
  const videoUrl = String(row?.videoUrl || row?.mediaUrl || row?.videoUri || "").trim();
  if (!postId && !videoUrl) return false;
  return Boolean(resolveYouTubeFeedMetadataPosterUri(row, postId, videoUrl));
}

/** Cached/generated poster only — used for append and pagination locks. */
export function youtubeRowPosterCached(row: any): boolean {
  if (!row || typeof row !== "object") return false;
  const { itemHasHomeFeedPoster } = require("@/src/lib/homeFeedPosterPrewarm") as {
    itemHasHomeFeedPoster: (item: any) => boolean;
  };
  return itemHasHomeFeedPoster(row);
}

export function youtubeRowPosterReady(row: any): boolean {
  if (youtubeRowPosterCached(row)) return true;
  return youtubeRowHasPosterMetadata(row);
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

/** Start poster jobs for an incoming page — limited concurrency, never blocks caller. */
export function kickoffYoutubePagePosterPrewarm(rows: any[]): void {
  if (!rows.length) return;
  const { queueHomeFeedPosterPrewarm } = require("@/src/lib/homeFeedPosterPrewarm") as {
    queueHomeFeedPosterPrewarm: (
      item: any,
      opts?: { priority?: "visible" | "background" }
    ) => Promise<boolean>;
  };

  const headCount = Math.min(HOME_FEED_YOUTUBE_APPEND_POSTER_HEAD_COUNT, rows.length);
  const head = rows.slice(0, headCount);
  const tail = rows.slice(headCount);

  void runWithConcurrency(head, HOME_FEED_YOUTUBE_APPEND_POSTER_CONCURRENCY, async (row) => {
    try {
      await queueHomeFeedPosterPrewarm(row, { priority: "visible" });
    } catch {}
  });

  if (!tail.length) return;
  void runWithConcurrency(tail, 1, async (row) => {
    try {
      await queueHomeFeedPosterPrewarm(row, { priority: "background" });
    } catch {}
  });
}

/** Start avatar cache/network jobs for an incoming page — fire-and-forget. */
export function kickoffYoutubePageAvatarPrewarm(rows: any[], maxCount?: number): void {
  if (!rows.length) return;
  const limit =
    typeof maxCount === "number" && maxCount > 0
      ? Math.min(maxCount, rows.length)
      : rows.length;
  const batch = rows.slice(0, limit);
  const { ensureHomeFeedAvatar } = require("@/src/lib/homeFeedAvatarCache") as {
    ensureHomeFeedAvatar: (params: {
      cacheKey: string;
      remoteUrls: string[];
      sourceUpdatedAt?: number;
    }) => Promise<string | null>;
  };
  const { resolveHomeFeedAvatarCacheContext } = require("@/src/components/homeFeed/homeFeedUtils") as {
    resolveHomeFeedAvatarCacheContext: (item: any) => {
      cacheKey: string;
      remoteUris: string[];
      avatarUpdatedAt: number;
    };
  };

  for (const row of batch) {
    const ctx = resolveHomeFeedAvatarCacheContext(row);
    if (!ctx.cacheKey || !ctx.remoteUris.length) continue;
    void ensureHomeFeedAvatar({
      cacheKey: ctx.cacheKey,
      remoteUrls: ctx.remoteUris,
      sourceUpdatedAt: ctx.avatarUpdatedAt,
    }).catch(() => null);
  }
}

function countYoutubeRowsWithCachedPosters(rows: any[]): number {
  return rows.filter((row) => youtubeRowPosterCached(row)).length;
}

export type YoutubeBatchCoverGateResult = {
  headReady: number;
  totalReady: number;
  batchSize: number;
  timedOut: boolean;
  allReady: boolean;
  phase: string;
};

/**
 * Wait until batch covers are cached: first 3 ready, or entire batch ready, or 2.5s timeout.
 * Pagination must not proceed while this runs.
 */
export async function awaitYoutubeBatchCoverGate(
  rows: any[],
  opts?: {
    phase?: string;
    isCancelled?: () => boolean;
    /** Limit avatar prewarm to head rows during first paint (Android startup). */
    avatarHeadCount?: number;
  }
): Promise<YoutubeBatchCoverGateResult> {
  const phase = String(opts?.phase || "batch").trim();
  if (!rows.length) {
    return {
      headReady: 0,
      totalReady: 0,
      batchSize: 0,
      timedOut: false,
      allReady: true,
      phase,
    };
  }

  kickoffYoutubePagePosterPrewarm(rows);
  const avatarLimit =
    typeof opts?.avatarHeadCount === "number" && opts.avatarHeadCount > 0
      ? opts.avatarHeadCount
      : undefined;
  kickoffYoutubePageAvatarPrewarm(rows, avatarLimit);

  const headCount = Math.min(HOME_FEED_YOUTUBE_APPEND_POSTER_HEAD_COUNT, rows.length);
  const start = Date.now();

  while (Date.now() - start < HOME_FEED_YOUTUBE_VISUAL_READY_TIMEOUT_MS) {
    if (opts?.isCancelled?.()) break;

    const { isHomeFeedPosterPipelineBusyForRows } = require("@/src/lib/homeFeedPosterPrewarm") as {
      isHomeFeedPosterPipelineBusyForRows: (batch: any[]) => boolean;
    };
    if (isHomeFeedPosterPipelineBusyForRows(rows)) {
      await new Promise((resolve) => setTimeout(resolve, 48));
    }

    const headReady = rows
      .slice(0, headCount)
      .filter((row) => youtubeRowPosterCached(row)).length;
    const totalReady = countYoutubeRowsWithCachedPosters(rows);
    const allReady = totalReady >= rows.length;
    const headSatisfied = headReady >= headCount;

    if (allReady || headSatisfied) {
      const waitedMs = Date.now() - start;
      console.log("KRISTO_HOME_FEED_BATCH_COVER_GATE", {
        phase,
        headReady,
        headTarget: headCount,
        totalReady,
        batchSize: rows.length,
        allReady,
        waitedMs,
        timedOut: false,
      });
      return {
        headReady,
        totalReady,
        batchSize: rows.length,
        timedOut: false,
        allReady,
        phase,
      };
    }

    await new Promise((resolve) => setTimeout(resolve, 48));
  }

  const headReady = rows
    .slice(0, headCount)
    .filter((row) => youtubeRowPosterCached(row)).length;
  const totalReady = countYoutubeRowsWithCachedPosters(rows);
  const waitedMs = Date.now() - start;
  console.log("KRISTO_HOME_FEED_BATCH_COVER_GATE", {
    phase,
    headReady,
    headTarget: headCount,
    totalReady,
    batchSize: rows.length,
    allReady: totalReady >= rows.length,
    waitedMs,
    timedOut: true,
  });
  return {
    headReady,
    totalReady,
    batchSize: rows.length,
    timedOut: true,
    allReady: totalReady >= rows.length,
    phase,
  };
}

/** @deprecated Use awaitYoutubeBatchCoverGate */
export async function waitForYoutubeBatchVisualReady(
  rows: any[],
  opts?: { isCancelled?: () => boolean }
): Promise<void> {
  await awaitYoutubeBatchCoverGate(rows, {
    phase: "legacy-batch-visual",
    isCancelled: opts?.isCancelled,
  });
}

/** @deprecated Use awaitYoutubeBatchCoverGate */
export async function waitForYoutubePageAppendReady(
  rows: any[],
  opts?: { isCancelled?: () => boolean }
): Promise<{ headReady: number; totalReady: number; timedOut: boolean }> {
  const result = await awaitYoutubeBatchCoverGate(rows, {
    phase: "pre-append",
    isCancelled: opts?.isCancelled,
  });
  return {
    headReady: result.headReady,
    totalReady: result.totalReady,
    timedOut: result.timedOut,
  };
}

export function resolveYoutubePageSettlingMs(): number {
  const span = HOME_FEED_YOUTUBE_PAGE_SETTLING_MAX_MS - HOME_FEED_YOUTUBE_PAGE_SETTLING_MIN_MS;
  return HOME_FEED_YOUTUBE_PAGE_SETTLING_MIN_MS + Math.floor(Math.random() * (span + 1));
}

export async function waitUntilMs(untilMs: number): Promise<void> {
  const remaining = untilMs - Date.now();
  if (remaining <= 0) return;
  await new Promise((resolve) => setTimeout(resolve, remaining));
}

export function isYoutubeFeedListOverflowing(metrics: HomeFeedYoutubeScrollMetrics): boolean {
  if (metrics.viewportHeight <= 0 || metrics.contentHeight <= 0) return false;
  return metrics.contentHeight > metrics.viewportHeight * HOME_FEED_YOUTUBE_LIST_OVERFLOW_RATIO;
}

/** Brief gate — poster downloads start at API return; do not block card mount on probes/cache. */
export async function waitForYoutubePage0RevealGate(
  rows: any[],
  opts?: { skip?: boolean }
): Promise<void> {
  if (!rows.length || opts?.skip) {
    if (rows.length) {
      kickoffYoutubePagePosterPrewarm(rows.slice(0, HOME_FEED_YOUTUBE_APPEND_POSTER_HEAD_COUNT));
      const { markHomeFeedPosterApiRowsReceived } =
        require("@/src/lib/homeFeedPosterPipelineTrace") as typeof import("@/src/lib/homeFeedPosterPipelineTrace");
      markHomeFeedPosterApiRowsReceived(rows);
    }
    return;
  }

  kickoffYoutubePagePosterPrewarm(rows.slice(0, HOME_FEED_YOUTUBE_APPEND_POSTER_HEAD_COUNT));

  const { markHomeFeedPosterApiRowsReceived } =
    require("@/src/lib/homeFeedPosterPipelineTrace") as typeof import("@/src/lib/homeFeedPosterPipelineTrace");
  markHomeFeedPosterApiRowsReceived(rows);

  const start = Date.now();
  const head = rows.slice(0, 2);

  while (Date.now() - start < HOME_FEED_YOUTUBE_SKELETON_MAX_MS) {
    const elapsed = Date.now() - start;
    const postersReady = head.length === 0 || head.every((row) => youtubeRowHasPosterMetadata(row));
    if (postersReady && elapsed >= HOME_FEED_YOUTUBE_SKELETON_MIN_MS) return;
    if (elapsed >= HOME_FEED_YOUTUBE_SKELETON_MAX_MS) return;
    await new Promise((resolve) => setTimeout(resolve, 16));
  }
}
