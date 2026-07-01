import { apiGet, apiPost } from "@/src/lib/kristoApi";
import { getKristoHeaders } from "@/src/lib/kristoHeaders";
import { getSessionSync } from "@/src/lib/kristoSession";
import { baseFeedId } from "@/src/lib/scheduleSlotUtils";
import { homeFeedRowKey, stableMergeHomeFeedRows, HOME_FEED_INITIAL_LIMIT } from "./homeFeedPagination";
import { filterPhase1FeedRows, filterHomeFeedYoutubeStreamRows, isHomeFeedExpandedScheduleSlotRow, normalizeHomeFeedApiRow } from "./homeFeedUtils";
import { isHomeFeedReadyMediaItem } from "@/src/lib/mediaStatus";
import { isMediaScheduleFeedItem } from "@/src/lib/homeFeedStore";
import { parseChurchFeedListResponse } from "@/src/lib/mediaScheduleFeedParse";
import { isMediaScheduleFeedItemClosed } from "@/src/lib/mediaScheduleFeedPredicates";
import { areAllScheduleSlotsExpired } from "@/src/lib/mediaScheduleSlotActive";
import {
  logHomeFeedScheduleExpired,
  logHomeFeedScheduleRemoved,
} from "@/src/lib/homeFeedScheduleLifecycle";
import {
  peekHomeFeedRowsCacheSync,
  peekHomeFeedPagingSync,
  saveHomeFeedRowsCache,
  removeHomeFeedPostFromRowsCache,
  setBackendSnapshotRowIds,
  getBackendSnapshotRowIds,
  collectRemovedHomeFeedCacheIds,
  logHomeFeedCachePruneDeleted,
  peekHomeFeedRowsCacheSavedAt,
  type HomeFeedPagingState,
} from "./homeFeedRowsCache";
import {
  isYoutubeFeedPaginationLocked,
  runYoutubeVisualPrep,
} from "@/src/lib/homeFeedYoutubePaginationLock";
import { isHomeFeedYouTubeStyleVideo } from "@/src/lib/homeFeedVideoMode";
import {
  HOME_FEED_YOUTUBE_COLD_START_RANK_POOL_SIZE,
  rankHomeFeedYoutubeStreamRows,
} from "@/src/lib/homeFeedPersonalOrder";
import {
  startYoutubeHomeFeedVisiblePosterPrewarm,
} from "@/src/lib/homeFeedPosterPrewarm";
import {
  clearHomeFeedPageCache,
  getHomeFeedLoadedPageCount,
  getHomeFeedStreamRowsInMemory,
  HOME_FEED_YOUTUBE_FIRST_PAGE_SIZE,
  HOME_FEED_YOUTUBE_STREAM_PAGE_SIZE,
  homeFeedYoutubeStreamLimitForPage,
  ensureHomeFeedYoutubePageCacheValid,
  hydrateHomeFeedPage0FromStorage,
  peekHomeFeedPagingFromPageCache,
  saveHomeFeedStreamPage,
  saveHomeFeedPageCachePaging,
} from "./homeFeedPageCache";
import { prefetchHomeFeedPosterMetadata } from "@/src/lib/homeFeedPosterPrewarm";
import {
  getHomeFeedFetchGeneration,
  getHomeFeedFetchInflight,
  logHomeFeedNetworkTrace,
  noteHomeFeedFetchSuccess,
  resolveHomeFeedRefreshMode,
  setHomeFeedFetchInflight,
  shouldHardRefreshHomeFeed,
} from "@/src/lib/homeFeedNetwork";
import {
  hasHomeFeedYoutubeStreamSession,
  markHomeFeedYoutubeRefreshAvailable,
  peekHomeFeedYoutubeStreamSessionRows,
} from "@/src/lib/homeFeedYoutubeStreamSession";

let lastFetchedHomeFeedRows: any[] = [];

type YoutubeSilentNextPagePrep = {
  pageIndex: number;
  rows: any[];
  paging?: { hasMore: boolean; nextCursor: string | null };
  coversReady: boolean;
};

let youtubeSilentNextPagePrep: YoutubeSilentNextPagePrep | null = null;
let youtubeSilentNextPagePrepInflight: Promise<void> | null = null;

export function clearHomeFeedYoutubeSilentNextPagePrep() {
  youtubeSilentNextPagePrep = null;
  youtubeSilentNextPagePrepInflight = null;
}

export function isHomeFeedYoutubeSilentNextPagePrepInflight(): boolean {
  return youtubeSilentNextPagePrepInflight != null;
}

export function isHomeFeedYoutubeSilentNextPagePrepReady(pageIndex?: number): boolean {
  const targetIndex = pageIndex ?? getHomeFeedLoadedPageCount();
  return (
    youtubeSilentNextPagePrep?.pageIndex === targetIndex &&
    youtubeSilentNextPagePrep.coversReady === true &&
    (youtubeSilentNextPagePrep.rows?.length ?? 0) > 0
  );
}

/** Wait until silent cover prep finishes for the next page (fetch + cover gate only). */
export async function ensureHomeFeedYoutubeSilentNextPagePrepared(): Promise<boolean> {
  if (!isHomeFeedYouTubeStyleVideo()) return false;
  const nextPageIndex = getHomeFeedLoadedPageCount();
  if (isHomeFeedYoutubeSilentNextPagePrepReady(nextPageIndex)) return true;

  const paging = peekHomeFeedPagingFromPageCache();
  if (!paging.hasMore) return false;

  await prepareHomeFeedYoutubeNextPageSilently();
  return isHomeFeedYoutubeSilentNextPagePrepReady(nextPageIndex);
}

async function fetchHomeFeedYoutubeNextPageRowsOnly(
  cursor: string | null,
  limit: number
): Promise<{ rows: any[]; paging: { hasMore: boolean; nextCursor: string | null } }> {
  const session = getSessionSync() as any;
  const viewerUserId = String(session?.userId || "").trim();
  const pageLimit = Math.max(1, Math.floor(limit) || HOME_FEED_YOUTUBE_STREAM_PAGE_SIZE);
  const offset = String(cursor ?? "").trim();

  const params = new URLSearchParams({
    scope: "global",
    limit: String(pageLimit),
    mediaOnly: "1",
    _: String(Date.now()),
  });
  if (offset) params.set("cursor", offset);

  const res: any = await apiGet(
    `/api/church/feed?${params.toString()}`,
    {
      headers: getKristoHeaders({
        userId: viewerUserId,
        role: (session?.role || "Member") as any,
        churchId: String(session?.churchId || "").trim(),
      }),
      cache: "no-store" as RequestCache,
    },
    { screen: "HomeFeed", throttleMs: 0, dedupe: false }
  );

  const hasMore = res?.hasMore === true;
  const nextCursor = res?.nextCursor != null ? String(res.nextCursor) : null;
  return {
    rows: filterYoutubeHomeFeedRows(parseFeedRows(res)),
    paging: { hasMore, nextCursor },
  };
}

/** Fetch + prepare covers for the next page — never appends or mounts cards. */
export async function prepareHomeFeedYoutubeNextPageSilently(): Promise<void> {
  if (!isHomeFeedYouTubeStyleVideo()) return;

  const nextPageIndex = getHomeFeedLoadedPageCount();
  if (youtubeSilentNextPagePrep?.pageIndex === nextPageIndex && youtubeSilentNextPagePrep.coversReady) {
    return;
  }
  if (youtubeSilentNextPagePrepInflight) {
    await youtubeSilentNextPagePrepInflight;
    return;
  }

  const paging = peekHomeFeedPagingFromPageCache();
  if (!paging.hasMore) return;

  youtubeSilentNextPagePrepInflight = runYoutubeVisualPrep(async () => {
    try {
      const paging = peekHomeFeedPagingFromPageCache();
      if (!paging.hasMore) return;

      const { isHomeFeedPosterPipelineBusy } = require("@/src/lib/homeFeedPosterPrewarm") as {
        isHomeFeedPosterPipelineBusy: () => boolean;
      };
      const { HOME_FEED_YOUTUBE_VISUAL_READY_TIMEOUT_MS } = require("@/src/components/homeFeed/homeFeedYoutubeStreamUi") as {
        HOME_FEED_YOUTUBE_VISUAL_READY_TIMEOUT_MS: number;
      };
      const posterWaitStart = Date.now();
      while (
        isHomeFeedPosterPipelineBusy() &&
        Date.now() - posterWaitStart < HOME_FEED_YOUTUBE_VISUAL_READY_TIMEOUT_MS
      ) {
        await new Promise((resolve) => setTimeout(resolve, 48));
      }

      const fetched = await fetchHomeFeedYoutubeNextPageRowsOnly(
        paging.nextCursor,
        homeFeedYoutubeStreamLimitForPage(nextPageIndex)
      );
      const rows = fetched.rows;
      if (!rows.length) return;

      const { awaitYoutubeBatchCoverGate } = require("@/src/components/homeFeed/homeFeedYoutubeStreamUi") as {
        awaitYoutubeBatchCoverGate: (
          batch: any[],
          opts?: { phase?: string }
        ) => Promise<unknown>;
      };
      await awaitYoutubeBatchCoverGate(rows, { phase: "silent-prep" });

      youtubeSilentNextPagePrep = {
        pageIndex: nextPageIndex,
        rows,
        paging: fetched.paging,
        coversReady: true,
      };
      logHomeFeedNetworkTrace({
        event: "youtube-next-page-cover-prep",
        pageIndex: nextPageIndex,
        count: rows.length,
      });
    } finally {
      youtubeSilentNextPagePrepInflight = null;
    }
  });

  await youtubeSilentNextPagePrepInflight;
}

function consumeYoutubeSilentNextPagePrep(pageIndex: number): YoutubeSilentNextPagePrep | null {
  if (youtubeSilentNextPagePrep?.pageIndex !== pageIndex) return null;
  const prep = youtubeSilentNextPagePrep;
  youtubeSilentNextPagePrep = null;
  return prep;
}

function filterYoutubeHomeFeedRows(rows: any[]): any[] {
  return filterHomeFeedYoutubeStreamRows(filterPhase1FeedRows(rows));
}

function isHomeFeedMediaScheduleBackendRow(row: any): boolean {
  if (!row || typeof row !== "object") return false;
  const source = String(row?.source || "").toLowerCase();
  const scheduleType = String(row?.scheduleType || "").toLowerCase();
  return (
    isMediaScheduleFeedItem(row) ||
    source.includes("media-schedule") ||
    scheduleType.includes("media-live-slots")
  );
}

function shouldPreserveHomeFeedScheduleBackendRow(row: any, nowMs = Date.now()): boolean {
  if (!isHomeFeedMediaScheduleBackendRow(row)) return false;
  if (isDeletedFeedRow(row)) return false;
  if (isMediaScheduleFeedItemClosed(row)) return false;
  if (areAllScheduleSlotsExpired(row, nowMs)) return false;
  return true;
}

export function logMediaSlotHomeFeedVisibility(args: {
  slotId?: string | null;
  scheduleId?: string | null;
  stage: string;
  included: boolean;
  reason: string;
}) {
  console.log("KRISTO_MEDIA_SLOT_HOME_FEED_VISIBILITY", {
    slotId: args.slotId ?? null,
    scheduleId: args.scheduleId ?? null,
    stage: args.stage,
    included: args.included,
    reason: args.reason,
  });
}

function logScheduleRowSlotsVisibility(
  row: any,
  stage: string,
  included: boolean,
  reason: string
) {
  const scheduleId =
    baseFeedId(String(row?.parentScheduleId || row?.sourceScheduleId || row?.id || "")) ||
    String(row?.id || "").trim() ||
    null;
  const slots = Array.isArray(row?.scheduleSlots) ? row.scheduleSlots : [];

  if (!slots.length) {
    logMediaSlotHomeFeedVisibility({ slotId: null, scheduleId, stage, included, reason });
    return;
  }

  for (const slot of slots) {
    logMediaSlotHomeFeedVisibility({
      slotId: String(slot?.id || "").trim() || null,
      scheduleId,
      stage,
      included,
      reason,
    });
  }
}

/** Match API snapshot ids, including expanded slot cards tied to a parent schedule row. */
export function homeFeedRowIncludedInBackendSnapshot(row: any, snapshotRowIds: Set<string>): boolean {
  // Client-recycled rows are synthetic (endless-feed fallback) and must never be
  // pruned by the backend snapshot — they are keyed off real posts we still have.
  if (row?.homeFeedRecycleKey) return true;

  const id = homeFeedRowKey(row);
  if (id && snapshotRowIds.has(id)) return true;

  const parentScheduleId = baseFeedId(
    String(row?.parentScheduleId || row?.sourceScheduleId || "")
  );
  if (!parentScheduleId) return false;

  for (const snapId of snapshotRowIds) {
    if (snapId === parentScheduleId || baseFeedId(snapId) === parentScheduleId) {
      return true;
    }
  }

  return false;
}

function resolveHomeFeedScheduleEndedAt(row: any): string | null {
  const slots = Array.isArray(row?.scheduleSlots) ? row.scheduleSlots : [];
  let lastEndMs = 0;
  for (const slot of slots) {
    const endMs = Number(slot?.endMs || 0);
    if (endMs > lastEndMs) lastEndMs = endMs;
  }
  return lastEndMs > 0 ? new Date(lastEndMs).toISOString() : null;
}

function logHomeFeedScheduleCacheRemoval(row: any, nowMs: number, source: string) {
  if (!isHomeFeedMediaScheduleBackendRow(row)) return;
  const scheduleId = String(row?.parentScheduleId || row?.sourceScheduleId || row?.id || "").trim();
  const churchId = String(row?.churchId || "").trim();
  if (!scheduleId) return;

  if (areAllScheduleSlotsExpired(row, nowMs)) {
    logHomeFeedScheduleExpired({
      scheduleId,
      churchId,
      reason: "all_slots_expired",
      endedAt: resolveHomeFeedScheduleEndedAt(row),
    });
  }
  logHomeFeedScheduleRemoved({ scheduleId, churchId, source });
}

function preserveActiveHomeFeedScheduleRows(existing: any[], incoming: any[], nowMs = Date.now()) {
  const incomingIds = new Set(incoming.map((row) => homeFeedRowKey(row)).filter(Boolean));
  const { merged } = stableMergeHomeFeedRows(existing, incoming);
  if (!incomingIds.size) return merged;

  return merged.filter((row) => {
    const id = homeFeedRowKey(row);
    if (!id) return false;
    if (incomingIds.has(id)) return true;

    if (shouldPreserveHomeFeedScheduleBackendRow(row, nowMs)) {
      logScheduleRowSlotsVisibility(row, "cache_reconcile", true, "preserve_active_schedule");
      return true;
    }

    if (isHomeFeedExpandedScheduleSlotRow(row)) {
      const parentScheduleId = baseFeedId(
        String(row?.parentScheduleId || row?.sourceScheduleId || "")
      );
      const parentKept = merged.some((candidate) => {
        if (!shouldPreserveHomeFeedScheduleBackendRow(candidate, nowMs)) return false;
        const candidateId = baseFeedId(String(candidate?.id || candidate?.sourceScheduleId || ""));
        return candidateId === parentScheduleId;
      });
      if (parentKept) {
        logScheduleRowSlotsVisibility(row, "cache_reconcile", true, "preserve_expanded_slot");
        return true;
      }
    }

    logHomeFeedScheduleCacheRemoval(row, nowMs, "cache_reconcile");
    logScheduleRowSlotsVisibility(row, "cache_reconcile", false, "pruned_not_in_snapshot");
    return false;
  });
}

export function isDeletedFeedRow(row: any): boolean {
  if (!row || typeof row !== "object") return true;
  if (row.deleted === true) return true;
  if (String(row.deletedAt || "").trim()) return true;
  const status = String(row.status || row.scheduleStatus || "").trim().toLowerCase();
  return status === "deleted";
}

export function filterActiveHomeFeedRows(rows: any[]): any[] {
  if (!Array.isArray(rows)) return [];
  return rows.filter((row) => !isDeletedFeedRow(row));
}

function homeFeedRowMatchesPostId(row: any, postId: string): boolean {
  const target = String(postId || "").trim();
  const rowId = String(row?.id || "").trim();
  if (!target || !rowId) return false;
  if (rowId === target) return true;
  return baseFeedId(rowId) === baseFeedId(target);
}

async function commitHomeFeedBackendRows(
  rows: any[],
  snapshotRowIds?: string[],
  paging?: Partial<HomeFeedPagingState>
) {
  const active = filterActiveHomeFeedRows(rows);
  const snapshotIds = (snapshotRowIds || active.map((row) => homeFeedRowKey(row)).filter(Boolean))
    .map((id) => String(id || "").trim())
    .filter(Boolean);
  if (snapshotIds.length) {
    setBackendSnapshotRowIds(snapshotIds);
  }
  lastFetchedHomeFeedRows = active;
  await saveHomeFeedRowsCache(active, undefined, snapshotIds, paging);
  return active;
}

export function getHomeFeedPagingState(): HomeFeedPagingState {
  if (isHomeFeedYouTubeStyleVideo()) {
    return peekHomeFeedPagingFromPageCache();
  }
  return peekHomeFeedPagingSync();
}

function pagingFromApiResponse(res: any, loadedCount: number): HomeFeedPagingState {
  const hasMore = res?.hasMore === true;
  const nextCursor =
    hasMore && res?.nextCursor != null ? String(res.nextCursor) : hasMore ? String(loadedCount) : null;
  return { nextCursor, hasMore };
}

async function reconcileHomeFeedBackendCacheWithSnapshot(snapshot: any[]) {
  const activeSnapshot = filterActiveHomeFeedRows(snapshot);
  const existing = getCachedHomeFeedBackendRows();
  const before = existing.length;
  const removedIds = collectRemovedHomeFeedCacheIds(existing, activeSnapshot);
  const reconciled = preserveActiveHomeFeedScheduleRows(existing, activeSnapshot);
  const snapshotRowIds = [
    ...activeSnapshot.map((row) => homeFeedRowKey(row)).filter(Boolean),
    ...reconciled
      .filter((row) => shouldPreserveHomeFeedScheduleBackendRow(row))
      .map((row) => homeFeedRowKey(row))
      .filter(Boolean),
  ];
  const uniqueSnapshotRowIds = Array.from(new Set(snapshotRowIds));

  if (removedIds.length > 0 || before > reconciled.length) {
    logHomeFeedCachePruneDeleted(before, reconciled.length, removedIds);
  }

  for (const row of activeSnapshot) {
    if (!isHomeFeedMediaScheduleBackendRow(row)) continue;
    logScheduleRowSlotsVisibility(row, "api_snapshot", true, "included_in_api_snapshot");
  }

  return commitHomeFeedBackendRows(reconciled, uniqueSnapshotRowIds);
}

/** Last successful feed snapshot — memory first, then persisted AsyncStorage cache. */
export function getCachedHomeFeedBackendRows(): any[] {
  if (isHomeFeedYouTubeStyleVideo()) {
    const stream = filterActiveHomeFeedRows(getHomeFeedStreamRowsInMemory());
    if (stream.length) {
      lastFetchedHomeFeedRows = stream;
      return stream;
    }
    return filterActiveHomeFeedRows(lastFetchedHomeFeedRows);
  }

  if (lastFetchedHomeFeedRows.length) {
    return filterActiveHomeFeedRows(lastFetchedHomeFeedRows);
  }
  const persisted = filterActiveHomeFeedRows(peekHomeFeedRowsCacheSync());
  if (persisted.length) {
    lastFetchedHomeFeedRows = persisted;
  }
  return lastFetchedHomeFeedRows;
}

export function getCachedHomeFeedBackendCount(): number {
  return getCachedHomeFeedBackendRows().length;
}

/**
 * Persist the merged feed for fast cold-start Home Feed paint. We persist at
 * LEAST `minRows`, but never shrink the live in-memory feed or the snapshot id
 * set below what the API already returned — otherwise an extended (e.g. 25-row)
 * feed would be clobbered back to the old startup slice. The visible WINDOW (not
 * the cache size) governs first-paint speed.
 */
export async function persistHomeFeedBackendRowsSnapshot(minRows: number, userId?: string) {
  const merged = getCachedHomeFeedBackendRows();
  if (!merged.length) return 0;
  const snapshot = merged.length >= minRows ? merged : merged.slice(0, minRows);
  lastFetchedHomeFeedRows = snapshot;
  await saveHomeFeedRowsCache(
    snapshot,
    userId,
    snapshot.map((row) => homeFeedRowKey(row)).filter(Boolean)
  );
  return snapshot.length;
}

/** Merge incoming API rows into cache and drop rows the snapshot no longer includes. */
export async function mergeCachedHomeFeedBackendRows(incoming: any[]) {
  return reconcileHomeFeedBackendCacheWithSnapshot(incoming);
}

/** Remove a deleted post from in-memory backend cache + persisted row cache. */
export async function purgeHomeFeedPostFromBackendCache(postId: string): Promise<boolean> {
  const target = String(postId || "").trim();
  if (!target) return false;

  const before = lastFetchedHomeFeedRows.length;
  lastFetchedHomeFeedRows = lastFetchedHomeFeedRows.filter(
    (row) => !homeFeedRowMatchesPostId(row, target)
  );
  const memoryPurged = before > lastFetchedHomeFeedRows.length;

  const cachePurged = await removeHomeFeedPostFromRowsCache(target);
  if (memoryPurged) {
    await saveHomeFeedRowsCache(
      lastFetchedHomeFeedRows,
      undefined,
      lastFetchedHomeFeedRows.map((row) => homeFeedRowKey(row)).filter(Boolean)
    );
  }
  return memoryPurged || cachePurged;
}

function parseFeedRows(res: any): any[] {
  const raw = parseChurchFeedListResponse(res).rows.map(normalizeHomeFeedApiRow);

  const filtered = raw.filter((row) => {
    const keep = isMediaScheduleFeedItem(row) || isHomeFeedReadyMediaItem(row);
    if (isHomeFeedMediaScheduleBackendRow(row)) {
      logScheduleRowSlotsVisibility(
        row,
        "api_parseFeedRows",
        keep,
        keep ? "media_schedule_or_ready_media" : "filtered_not_ready"
      );
    }
    return keep;
  });
  return filterActiveHomeFeedRows(filtered);
}

async function fetchYoutubeMediaApiPage(
  cursor: string,
  limit: number,
  viewerUserId: string,
  viewerChurchId: string,
  session: any,
  throttleMs: number
): Promise<{ rawRows: any[]; res: any }> {
  const params = new URLSearchParams({
    scope: "global",
    limit: String(limit),
    mediaOnly: "1",
    _: String(Date.now()),
  });
  if (cursor && cursor !== "0") params.set("cursor", cursor);

  const res: any = await apiGet(
    `/api/church/feed?${params.toString()}`,
    {
      headers: getKristoHeaders({
        userId: viewerUserId,
        role: (session?.role || "Member") as any,
        churchId: viewerChurchId,
      }),
      cache: "no-store" as RequestCache,
    },
    { screen: "HomeFeed", throttleMs, dedupe: false }
  );

  return { rawRows: parseFeedRows(res), res };
}

/** Merge a freshly ranked page-0 batch into the existing stream without dropping tail pages. */
export function mergeYoutubeColdStartRotation(current: any[], freshRankedPage0: any[]): any[] {
  const page0 = filterHomeFeedYoutubeStreamRows(freshRankedPage0);
  if (!page0.length) return current;

  const topIds = new Set(page0.map((row) => homeFeedRowKey(row)).filter(Boolean));
  const tail = filterHomeFeedYoutubeStreamRows(current).filter((row) => {
    const id = homeFeedRowKey(row);
    return Boolean(id && !topIds.has(id));
  });

  return [...page0, ...tail];
}

/** Keep fetching global media pages until `targetCount` playable rows or backend exhausted. */
async function collectYoutubeHomeFeedMediaRows(args: {
  targetCount: number;
  startCursor: string | null;
  viewerUserId: string;
  viewerChurchId: string;
  session: any;
  reason: string;
  throttleMs: number;
  /** When set, fetch up to this many candidates then rank before slicing to targetCount. */
  rankPoolSize?: number;
}): Promise<{
  rows: any[];
  paging: HomeFeedPagingState;
  apiPasses: number;
  lastApiRowCount: number;
}> {
  const {
    targetCount,
    startCursor,
    viewerUserId,
    viewerChurchId,
    session,
    reason,
    throttleMs,
    rankPoolSize,
  } = args;

  const collectLimit = Math.max(targetCount, rankPoolSize ?? targetCount);
  const collected: any[] = [];
  const seenIds = new Set<string>();
  let cursor = String(startCursor ?? "0").trim() || "0";
  let hasMore = true;
  let nextCursor: string | null = null;
  let apiPasses = 0;
  let lastApiRowCount = 0;
  let lastRes: any = null;

  while (collected.length < collectLimit && hasMore) {
    const remaining = collectLimit - collected.length;
    const limit = Math.max(remaining, HOME_FEED_YOUTUBE_STREAM_PAGE_SIZE);
    apiPasses += 1;

    const { rawRows, res } = await fetchYoutubeMediaApiPage(
      cursor,
      limit,
      viewerUserId,
      viewerChurchId,
      session,
      apiPasses === 1 ? throttleMs : 0
    );
    lastRes = res;
    lastApiRowCount = rawRows.length;

    logHomeFeedNetworkTrace({
      event: "youtube-media-collect-pass",
      reason,
      pass: apiPasses,
      cursor,
      apiRowCount: rawRows.length,
      collected: collected.length,
    });

    const mediaRows = filterYoutubeHomeFeedRows(rawRows);
    for (const row of mediaRows) {
      const id = homeFeedRowKey(row);
      if (id && seenIds.has(id)) continue;
      if (id) seenIds.add(id);
      collected.push(row);
      if (collected.length >= collectLimit) break;
    }

    hasMore = res?.hasMore === true;
    nextCursor = res?.nextCursor != null ? String(res.nextCursor) : null;
    if (!rawRows.length) break;

    if (collected.length >= collectLimit) break;

    if (nextCursor) {
      cursor = nextCursor;
      continue;
    }
    if (hasMore) {
      cursor = String(Number(cursor || 0) + rawRows.length);
      continue;
    }
    break;
  }

  const paging: HomeFeedPagingState = lastRes
    ? pagingFromApiResponse(lastRes, collected.length)
    : { hasMore: false, nextCursor: null };

  let rows = collected;
  if (rankPoolSize && collected.length > targetCount) {
    rows = rankHomeFeedYoutubeStreamRows(collected, homeFeedRowKey).slice(0, targetCount);
    console.log("KRISTO_HOME_FEED_YOUTUBE_RANK_POOL", {
      reason,
      poolSize: collected.length,
      targetCount,
      rankedTopIds: rows.map((row) => homeFeedRowKey(row)).filter(Boolean),
    });
  } else if (rankPoolSize && collected.length > 1) {
    rows = rankHomeFeedYoutubeStreamRows(collected, homeFeedRowKey).slice(0, targetCount);
  }

  return {
    rows: rows.slice(0, targetCount),
    paging,
    apiPasses,
    lastApiRowCount,
  };
}

export async function fetchHomeFeedFromApi(
  reason = "load",
  opts?: { force?: boolean; reconcile?: boolean }
) {
  const session = getSessionSync() as any;
  const viewerUserId = String(session?.userId || "").trim();
  const viewerChurchId = String(session?.churchId || "").trim();
  const force = opts?.force === true;
  const hardRefresh = shouldHardRefreshHomeFeed(reason, force);
  const refreshMode = resolveHomeFeedRefreshMode(reason, force);
  const cachedRows = getCachedHomeFeedBackendRows();
  const generationAtStart = getHomeFeedFetchGeneration();

  logHomeFeedNetworkTrace({
    event: "request-evaluated",
    reason,
    force,
    hardRefresh,
    refreshMode,
    cachedRows: cachedRows.length,
    savedAt: peekHomeFeedRowsCacheSavedAt(viewerUserId),
  });

  if (refreshMode === "skip") {
    logHomeFeedNetworkTrace({
      event: "cache-skip",
      reason,
      cachedRows: cachedRows.length,
    });
    return cachedRows;
  }

  if (refreshMode === "background" && cachedRows.length > 0) {
    logHomeFeedNetworkTrace({
      event: "cache-skip",
      reason,
      cachedRows: cachedRows.length,
      note: "background-with-cache-paginated",
    });
    return cachedRows;
  }

  const inflight = getHomeFeedFetchInflight();
  if (inflight) {
    logHomeFeedNetworkTrace({ event: "dedupe-join", reason });
    return inflight;
  }

  const fetchPromise = (async () => {
    logHomeFeedNetworkTrace({ event: "api-request", reason, refreshMode });

    if (hardRefresh && isHomeFeedYouTubeStyleVideo()) {
      clearHomeFeedYoutubeSilentNextPagePrep();
      await clearHomeFeedPageCache(viewerUserId);
    } else if (isHomeFeedYouTubeStyleVideo()) {
      await ensureHomeFeedYoutubePageCacheValid(viewerUserId);
    }

    if (isHomeFeedYouTubeStyleVideo()) {
      const applyRotation =
        reason === "load" ||
        reason === "cold-start-rotate" ||
        hardRefresh;
      const collected = await collectYoutubeHomeFeedMediaRows({
        targetCount: HOME_FEED_YOUTUBE_FIRST_PAGE_SIZE,
        rankPoolSize: applyRotation ? HOME_FEED_YOUTUBE_COLD_START_RANK_POOL_SIZE : undefined,
        startCursor: "0",
        viewerUserId,
        viewerChurchId,
        session,
        reason,
        throttleMs: hardRefresh ? 0 : 8000,
      });

      if (generationAtStart !== getHomeFeedFetchGeneration()) {
        logHomeFeedNetworkTrace({
          event: "stale-cancelled",
          reason,
          generationAtStart,
          currentGeneration: getHomeFeedFetchGeneration(),
        });
        return getCachedHomeFeedBackendRows();
      }

      console.log("KRISTO_HOME_FEED_SCHEDULE_ROWS_VISIBLE", {
        stage: "api_before_phase1_filter",
        reason,
        churchId: viewerChurchId,
        scope: "global",
        apiRowCount: collected.lastApiRowCount,
        crossChurchCount: 0,
        youtubeMediaCollectPasses: collected.apiPasses,
      });

      const rows = collected.rows;
      if (!rows.length) {
        return getCachedHomeFeedBackendRows();
      }

      console.log("KRISTO_HOME_FEED_YOUTUBE_PAGE0_COLLECT", {
        reason,
        target: HOME_FEED_YOUTUBE_FIRST_PAGE_SIZE,
        collected: rows.length,
        apiPasses: collected.apiPasses,
        hasMore: collected.paging.hasMore,
        nextCursor: collected.paging.nextCursor,
      });

      noteHomeFeedFetchSuccess();
      const snapshotIds = rows.map((row) => homeFeedRowKey(row)).filter(Boolean);
      await saveHomeFeedStreamPage(0, rows, collected.paging, viewerUserId);
      clearHomeFeedYoutubeSilentNextPagePrep();
      if (snapshotIds.length) {
        setBackendSnapshotRowIds(snapshotIds);
      }
      lastFetchedHomeFeedRows = rows;
      startYoutubeHomeFeedVisiblePosterPrewarm(rows);
      return rows;
    }

    const pageLimit = HOME_FEED_INITIAL_LIMIT;

    const params = new URLSearchParams({
      scope: "global",
      limit: String(pageLimit),
      cursor: "0",
      _: String(Date.now()),
    });

    const res: any = await apiGet(
      `/api/church/feed?${params.toString()}`,
      {
        headers: getKristoHeaders({
          userId: viewerUserId,
          role: (session?.role || "Member") as any,
          churchId: viewerChurchId,
        }),
        cache: "no-store" as RequestCache,
      },
      {
        screen: "HomeFeed",
        throttleMs: hardRefresh ? 0 : 8000,
        dedupe: true,
      }
    );

    if (generationAtStart !== getHomeFeedFetchGeneration()) {
      logHomeFeedNetworkTrace({
        event: "stale-cancelled",
        reason,
        generationAtStart,
        currentGeneration: getHomeFeedFetchGeneration(),
      });
      return getCachedHomeFeedBackendRows();
    }

    const rawRows = parseFeedRows(res);
    const apiScheduleCount = rawRows.filter(
      (row) =>
        String(row?.scheduleType || "").includes("media-live-slots") ||
        String(row?.source || "").includes("media-schedule")
    ).length;

    const crossChurchCount = rawRows.filter((row) => {
      const itemCid = String(row?.churchId || "").trim();
      return itemCid && viewerChurchId && itemCid !== viewerChurchId;
    }).length;

    console.log("KRISTO_HOME_FEED_SCHEDULE_ROWS_VISIBLE", {
      stage: "api_before_phase1_filter",
      reason,
      churchId: viewerChurchId,
      scope: "global",
      apiScheduleCount,
      apiRowCount: rawRows.length,
      crossChurchCount,
    });

    if (crossChurchCount > 0) {
      console.log("KRISTO_GLOBAL_FEED_CROSS_CHURCH_INCLUDED", {
        viewerChurchId,
        count: crossChurchCount,
        source: "home_feed_api",
      });
    }

    const rows = filterPhase1FeedRows(rawRows);
    for (const row of rawRows) {
      if (!isHomeFeedMediaScheduleBackendRow(row)) continue;
      const kept = rows.some((item) => homeFeedRowKey(item) === homeFeedRowKey(row));
      if (!kept) {
        logScheduleRowSlotsVisibility(row, "api_phase1_filter", false, "removed_by_filterPhase1FeedRows");
      }
    }

    if (!rows.length) {
      return getCachedHomeFeedBackendRows();
    }

    noteHomeFeedFetchSuccess();
    const paging = pagingFromApiResponse(res, rows.length);
    const snapshotIds = rows.map((row) => homeFeedRowKey(row)).filter(Boolean);

    if (hardRefresh || !cachedRows.length) {
      return commitHomeFeedBackendRows(rows, snapshotIds, paging);
    }

    return reconcileHomeFeedBackendCacheWithSnapshot(rows);
  })().finally(() => {
    setHomeFeedFetchInflight(null);
  });

  setHomeFeedFetchInflight(fetchPromise);
  return fetchPromise;
}

export type HomeFeedPageResult = {
  rows: any[];
  newRows: any[];
  appended: number;
  incoming: number;
  hasMore: boolean;
  nextCursor: string | null;
};

/**
 * Append a page of API rows into the backend cache WITHOUT pruning. Unlike the
 * reconcile path (which treats the API response as the full snapshot and drops
 * everything else), this UNIONs the new page's ids with the existing snapshot so
 * earlier pages survive. Used by near-end pagination.
 */
async function appendHomeFeedBackendRows(
  pageRows: any[],
  paging?: Partial<HomeFeedPagingState>
) {
  const active = filterActiveHomeFeedRows(pageRows);
  const existing = getCachedHomeFeedBackendRows();
  const before = existing.length;
  const existingIds = new Set(existing.map((row) => homeFeedRowKey(row)).filter(Boolean));
  const newRows = active.filter((row) => {
    const id = homeFeedRowKey(row);
    return Boolean(id && !existingIds.has(id));
  });
  const { merged } = stableMergeHomeFeedRows(existing, active);
  const appended = Math.max(0, merged.length - before);

  const prevSnapshot = Array.from(getBackendSnapshotRowIds() || []);
  const snapshotIds = Array.from(
    new Set([
      ...prevSnapshot,
      ...merged.map((row) => homeFeedRowKey(row)).filter(Boolean),
    ])
  );

  lastFetchedHomeFeedRows = merged;
  setBackendSnapshotRowIds(snapshotIds);
  await saveHomeFeedRowsCache(merged, undefined, snapshotIds, paging);
  return { merged, appended, newRows };
}

/**
 * Fetch the next page of the global feed at `cursor` (offset) and append it to
 * the cache without pruning existing rows. Returns paging metadata so callers
 * can advance the cursor or fall back to recycling when the backend is exhausted.
 */
export async function fetchHomeFeedNextPage(
  cursor: string | null,
  limit: number
): Promise<HomeFeedPageResult> {
  if (isHomeFeedYouTubeStyleVideo()) {
    return fetchHomeFeedYoutubeStreamPage(cursor, limit);
  }

  const session = getSessionSync() as any;
  const viewerUserId = String(session?.userId || "").trim();
  const viewerChurchId = String(session?.churchId || "").trim();
  const offset = String(cursor ?? "").trim();
  const pageLimit = Math.max(1, Math.floor(limit) || 1);

  const params = new URLSearchParams({
    scope: "global",
    limit: String(pageLimit),
    _: String(Date.now()),
  });
  if (offset) params.set("cursor", offset);

  const res: any = await apiGet(
    `/api/church/feed?${params.toString()}`,
    {
      headers: getKristoHeaders({
        userId: viewerUserId,
        role: (session?.role || "Member") as any,
        churchId: viewerChurchId,
      }),
      cache: "no-store" as RequestCache,
    },
    { screen: "HomeFeed", throttleMs: 0, dedupe: false }
  );

  const hasMore = res?.hasMore === true;
  const nextCursor = res?.nextCursor != null ? String(res.nextCursor) : null;
  const paging = { nextCursor, hasMore };

  const rawRows = parseFeedRows(res);
  const incoming = rawRows.length;
  const rows = filterPhase1FeedRows(rawRows);

  if (!rows.length) {
    await saveHomeFeedRowsCache(
      getCachedHomeFeedBackendRows(),
      undefined,
      undefined,
      paging
    );
    return {
      rows: getCachedHomeFeedBackendRows(),
      newRows: [],
      appended: 0,
      incoming,
      hasMore,
      nextCursor,
    };
  }

  const { merged, appended, newRows } = await appendHomeFeedBackendRows(rows, paging);
  return { rows: merged, newRows, appended, incoming, hasMore, nextCursor };
}

async function fetchHomeFeedYoutubeStreamPage(
  cursor: string | null,
  limit: number
): Promise<HomeFeedPageResult> {
  const session = getSessionSync() as any;
  const viewerUserId = String(session?.userId || "").trim();
  const nextPageIndex = getHomeFeedLoadedPageCount();

  const prepared = consumeYoutubeSilentNextPagePrep(nextPageIndex);
  if (prepared?.rows?.length) {
    const paging = prepared.paging || peekHomeFeedPagingFromPageCache();
    const existing = getHomeFeedStreamRowsInMemory();
    const existingIds = new Set(existing.map((row) => homeFeedRowKey(row)).filter(Boolean));
    const newRows = prepared.rows.filter((row) => {
      const id = homeFeedRowKey(row);
      return Boolean(id && !existingIds.has(id));
    });

    if (newRows.length) {
      await saveHomeFeedStreamPage(nextPageIndex, prepared.rows, paging, viewerUserId);
    }

    const stream = getHomeFeedStreamRowsInMemory();
    lastFetchedHomeFeedRows = stream;
    return {
      rows: stream,
      newRows,
      appended: newRows.length,
      incoming: prepared.rows.length,
      hasMore: paging.hasMore,
      nextCursor: paging.nextCursor,
    };
  }

  const offset = String(cursor ?? "").trim();
  const pageLimit = Math.max(
    1,
    Math.floor(limit) || homeFeedYoutubeStreamLimitForPage(nextPageIndex)
  );

  const params = new URLSearchParams({
    scope: "global",
    limit: String(pageLimit),
    mediaOnly: "1",
    _: String(Date.now()),
  });
  if (offset) params.set("cursor", offset);

  const res: any = await apiGet(
    `/api/church/feed?${params.toString()}`,
    {
      headers: getKristoHeaders({
        userId: viewerUserId,
        role: (session?.role || "Member") as any,
        churchId: String(session?.churchId || "").trim(),
      }),
      cache: "no-store" as RequestCache,
    },
    { screen: "HomeFeed", throttleMs: 0, dedupe: false }
  );

  const hasMore = res?.hasMore === true;
  const nextCursor = res?.nextCursor != null ? String(res.nextCursor) : null;
  const paging = { nextCursor, hasMore };

  const rawRows = parseFeedRows(res);
  const incoming = rawRows.length;
  const rows = filterYoutubeHomeFeedRows(rawRows);

  if (!rows.length) {
    await saveHomeFeedPageCachePaging(paging, viewerUserId);
    const stream = getHomeFeedStreamRowsInMemory();
    lastFetchedHomeFeedRows = stream;
    return {
      rows: stream,
      newRows: [],
      appended: 0,
      incoming,
      hasMore,
      nextCursor,
    };
  }

  const existing = getHomeFeedStreamRowsInMemory();
  const existingIds = new Set(existing.map((row) => homeFeedRowKey(row)).filter(Boolean));
  const newRows = rows.filter((row) => {
    const id = homeFeedRowKey(row);
    return Boolean(id && !existingIds.has(id));
  });

  await saveHomeFeedStreamPage(nextPageIndex, rows, paging, viewerUserId);
  const stream = getHomeFeedStreamRowsInMemory();
  lastFetchedHomeFeedRows = stream;

  return {
    rows: stream,
    newRows,
    appended: newRows.length,
    incoming,
    hasMore,
    nextCursor,
  };
}

export async function hydrateHomeFeedYoutubePage0(userId?: string) {
  return hydrateHomeFeedPage0FromStorage(userId);
}

/** Session-alive background probe: update staging cache only, never visible rows. */
export async function refreshHomeFeedYoutubeBackgroundCache(
  reason = "focus"
): Promise<{ refreshAvailable: boolean }> {
  if (!isHomeFeedYouTubeStyleVideo() || !hasHomeFeedYoutubeStreamSession()) {
    return { refreshAvailable: false };
  }

  const session = getSessionSync() as any;
  const viewerUserId = String(session?.userId || "").trim();
  const viewerChurchId = String(session?.churchId || "").trim();
  const generationAtStart = getHomeFeedFetchGeneration();

  logHomeFeedNetworkTrace({
    event: "session-background-probe",
    reason,
    cachedRows: peekHomeFeedYoutubeStreamSessionRows().length,
  });

  try {
    const collected = await collectYoutubeHomeFeedMediaRows({
      targetCount: HOME_FEED_YOUTUBE_FIRST_PAGE_SIZE,
      rankPoolSize: HOME_FEED_YOUTUBE_COLD_START_RANK_POOL_SIZE,
      startCursor: "0",
      viewerUserId,
      viewerChurchId,
      session,
      reason: `session-bg:${reason}`,
      throttleMs: 8000,
    });

    if (generationAtStart !== getHomeFeedFetchGeneration()) {
      return { refreshAvailable: false };
    }

    const freshRows = collected.rows;
    if (!freshRows.length) {
      return { refreshAvailable: false };
    }

    const visibleRows = peekHomeFeedYoutubeStreamSessionRows();
    const currentTopId = homeFeedRowKey(visibleRows[0]);
    const freshTopId = homeFeedRowKey(freshRows[0]);
    const refreshAvailable = Boolean(currentTopId && freshTopId && currentTopId !== freshTopId);

    if (refreshAvailable) {
      markHomeFeedYoutubeRefreshAvailable(freshRows);
    }

    noteHomeFeedFetchSuccess();
    return { refreshAvailable };
  } catch {
    return { refreshAvailable: false };
  }
}

export function syncHomeFeedLike(postId: string, liked?: boolean) {
  const session = getSessionSync() as any;
  const cleanPostId = baseFeedId(postId);
  if (!cleanPostId) return;

  void apiPost(
    "/api/church/feed",
    {
      action: "toggle_like",
      postId: cleanPostId,
      ...(typeof liked === "boolean" ? { liked } : {}),
    },
    {
      headers: getKristoHeaders({
        userId: session?.userId || "",
        role: (session?.role || "Member") as any,
        churchId: session?.churchId || "",
      }),
    }
  ).catch(() => {});
}
