import { Platform } from "react-native";
import { apiGet, apiPost } from "@/src/lib/kristoApi";
import { getKristoHeaders } from "@/src/lib/kristoHeaders";
import { getSessionSync } from "@/src/lib/kristoSession";
import { markHomeFeedStartupTiming } from "@/src/lib/homeFeedStartupTiming";
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
  peekHomeFeedYoutubeStreamSession,
  peekHomeFeedYoutubeStreamSessionRows,
  saveHomeFeedYoutubeStreamSession,
} from "@/src/lib/homeFeedYoutubeStreamSession";
import {
  classifyFeedApiResponse,
  decideHomeFeedPagingState,
  isAuthoritativeFeedPageResponse,
  logHomeFeedPagingStateDecision,
  readFeedResponseHasMore,
  readFeedResponseNextCursor,
  readFeedResponseTotal,
  shouldRevalidateStaleHomeFeedExhaustion,
  type HomeFeedPagingDecision,
  type HomeFeedRequestDisposition,
} from "@/src/lib/homeFeedPagingAuthority";

let lastFetchedHomeFeedRows: any[] = [];

/** Last YouTube page-0 collect paging disposition (for cold-start follow-up). */
export type YoutubeMediaCollectPagingMeta = {
  reason: string;
  disposition: HomeFeedRequestDisposition | null;
  pagingApplied: boolean;
  hasMore: boolean;
  nextCursor: string | null;
  apiPasses: number;
};

let lastYoutubeMediaCollectMeta: YoutubeMediaCollectPagingMeta | null = null;

export function peekLastYoutubeMediaCollectMeta(): YoutubeMediaCollectPagingMeta | null {
  return lastYoutubeMediaCollectMeta;
}

function peekPriorYoutubePaging(): HomeFeedPagingState {
  const session = peekHomeFeedYoutubeStreamSession();
  if (session.rows.length > 0) {
    return {
      hasMore: session.hasMore,
      nextCursor: session.nextCursor,
    };
  }
  return peekHomeFeedPagingFromPageCache();
}

function resolveYoutubePagingFromResponse(args: {
  res: unknown;
  prior: HomeFeedPagingState;
  rawRowCount: number;
  mappedRowCount: number;
  loadedRows: number;
  throttleMs?: number;
  assumedDisposition?: HomeFeedRequestDisposition;
  requestedCursor?: string | null;
  persist?: boolean;
  viewerUserId?: string;
}): {
  decision: HomeFeedPagingDecision;
  paging: HomeFeedPagingState;
  pagingApplied: boolean;
} {
  const disposition = classifyFeedApiResponse(args.res, {
    throttleMs: args.throttleMs,
    assumedDisposition: args.assumedDisposition,
  });
  const decision = decideHomeFeedPagingState({
    disposition,
    prior: args.prior,
    responseHasMore: readFeedResponseHasMore(args.res),
    responseNextCursor: readFeedResponseNextCursor(args.res),
    responseTotal: readFeedResponseTotal(args.res),
    rawRowCount: args.rawRowCount,
    mappedRowCount: args.mappedRowCount,
    loadedRows: args.loadedRows,
  });

  logHomeFeedPagingStateDecision(decision, {
    requestedCursor: args.requestedCursor ?? null,
    rawRowCount: args.rawRowCount,
    mappedRowCount: args.mappedRowCount,
    loadedRows: args.loadedRows,
    persist: args.persist === true,
  });

  const pagingApplied = decision.action !== "preserve";
  if (pagingApplied && args.persist) {
    void saveHomeFeedPageCachePaging(decision.paging, args.viewerUserId).catch(() => {});
  }

  return {
    decision,
    paging: pagingApplied ? decision.paging : { ...args.prior },
    pagingApplied,
  };
}

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
): Promise<{ rows: any[]; paging: { hasMore: boolean; nextCursor: string | null }; pagingApplied: boolean }> {
  const session = getSessionSync() as any;
  const viewerUserId = String(session?.userId || "").trim();
  const pageLimit = Math.max(1, Math.floor(limit) || HOME_FEED_YOUTUBE_STREAM_PAGE_SIZE);
  const offset = String(cursor ?? "").trim();
  const prior = peekPriorYoutubePaging();

  const params = new URLSearchParams({
    scope: "global",
    limit: String(pageLimit),
    mediaOnly: "1",
    _: String(Date.now()),
  });
  // Always send cursor so page identity is query-distinct (including "0" / "20").
  params.set("cursor", offset || "0");

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
    // Authoritative pagination: never throttle/dedupe (query-distinct network).
    { screen: "HomeFeed", throttleMs: 0, dedupe: false }
  );

  const rawRows = isAuthoritativeFeedPageResponse(res) ? parseFeedRows(res) : [];
  const rows = filterYoutubeHomeFeedRows(rawRows);
  const loadedRows = getHomeFeedStreamRowsInMemory().length;
  const resolved = resolveYoutubePagingFromResponse({
    res,
    prior,
    rawRowCount: rawRows.length,
    mappedRowCount: rows.length,
    loadedRows,
    throttleMs: 0,
    requestedCursor: offset || "0",
    persist: false,
  });

  return {
    rows,
    paging: resolved.paging,
    pagingApplied: resolved.pagingApplied,
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
  markHomeFeedStartupTiming("FEED_API_RESPONSE_TS", {
    rowCount: active.length,
    source: "inline-feed",
  });
  return active;
}

export function getHomeFeedPagingState(): HomeFeedPagingState {
  if (isHomeFeedYouTubeStyleVideo()) {
    return peekHomeFeedPagingFromPageCache();
  }
  return peekHomeFeedPagingSync();
}

function pagingFromApiResponse(
  res: any,
  loadedCount: number,
  opts?: { throttleMs?: number; prior?: HomeFeedPagingState }
): HomeFeedPagingState {
  const prior = opts?.prior ?? peekPriorYoutubePaging();
  const disposition = classifyFeedApiResponse(res, { throttleMs: opts?.throttleMs });
  const decision = decideHomeFeedPagingState({
    disposition,
    prior,
    responseHasMore: readFeedResponseHasMore(res),
    responseNextCursor: readFeedResponseNextCursor(res),
    responseTotal: readFeedResponseTotal(res),
    rawRowCount: Array.isArray(res?.data) ? res.data.length : loadedCount,
    mappedRowCount: loadedCount,
    loadedRows: loadedCount,
  });
  if (decision.action === "preserve") {
    return { ...prior };
  }
  return decision.paging;
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
  // Include cursor always so request identity distinguishes page offsets.
  params.set("cursor", String(cursor || "0").trim() || "0");

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
    // Collect freshness probes may throttle; paging mutation paths use 0.
    { screen: "HomeFeed", throttleMs, dedupe: false }
  );

  if (!isAuthoritativeFeedPageResponse(res)) {
    return { rawRows: [], res };
  }
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

/** Android cold-start: reveal after pass 1 when at least this many playable rows exist. */
export const HOME_FEED_ANDROID_PROGRESSIVE_REVEAL_MIN = 6;
/** Android cold-start: first paint row count — matches FeedList initial render. */
export const HOME_FEED_ANDROID_PROGRESSIVE_REVEAL_COUNT = 7;

export type YoutubeProgressiveRevealMeta = {
  collectedSoFar: number;
  apiPass: number;
  revealCount: number;
};

function finalizeYoutubeCollectedRows(
  collected: any[],
  targetCount: number,
  rankPoolSize: number | undefined,
  reason: string
): any[] {
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
  return rows.slice(0, targetCount);
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
  /** Android progressive reveal: minimum playable rows before `onProgressiveReveal` fires. */
  progressiveRevealMinCount?: number;
  /** Android progressive reveal: ranked slice size passed to `onProgressiveReveal`. */
  progressiveRevealCount?: number;
  onProgressiveReveal?: (
    rows: any[],
    meta: YoutubeProgressiveRevealMeta
  ) => void | Promise<void>;
}): Promise<{
  rows: any[];
  paging: HomeFeedPagingState;
  apiPasses: number;
  lastApiRowCount: number;
  disposition: HomeFeedRequestDisposition | null;
  pagingApplied: boolean;
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
    progressiveRevealMinCount,
    progressiveRevealCount,
    onProgressiveReveal,
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
  let progressiveRevealFired = false;

  const maybeFireProgressiveReveal = () => {
    if (
      progressiveRevealFired ||
      !onProgressiveReveal ||
      !progressiveRevealMinCount ||
      !progressiveRevealCount ||
      apiPasses < 1 ||
      collected.length < progressiveRevealMinCount
    ) {
      return;
    }
    progressiveRevealFired = true;
    const partial = finalizeYoutubeCollectedRows(
      collected,
      progressiveRevealCount,
      rankPoolSize,
      reason
    );
    if (!partial.length) {
      progressiveRevealFired = false;
      return;
    }
    void Promise.resolve(
      onProgressiveReveal(partial, {
        collectedSoFar: collected.length,
        apiPass: apiPasses,
        revealCount: partial.length,
      })
    );
  };

  while (collected.length < collectLimit && hasMore) {
    const remaining = collectLimit - collected.length;
    const limit = Math.max(remaining, HOME_FEED_YOUTUBE_STREAM_PAGE_SIZE);
    apiPasses += 1;

    const passThrottleMs = apiPasses === 1 ? throttleMs : 0;
    const { rawRows, res } = await fetchYoutubeMediaApiPage(
      cursor,
      limit,
      viewerUserId,
      viewerChurchId,
      session,
      passThrottleMs
    );
    lastRes = res;
    lastApiRowCount = rawRows.length;
    const passAuthoritative = isAuthoritativeFeedPageResponse(res) && passThrottleMs === 0;

    logHomeFeedNetworkTrace({
      event: "youtube-media-collect-pass",
      reason,
      pass: apiPasses,
      cursor,
      apiRowCount: rawRows.length,
      collected: collected.length,
      disposition: classifyFeedApiResponse(res, { throttleMs: passThrottleMs }),
    });

    const mediaRows = filterYoutubeHomeFeedRows(rawRows);
    for (const row of mediaRows) {
      const id = homeFeedRowKey(row);
      if (id && seenIds.has(id)) continue;
      if (id) seenIds.add(id);
      collected.push(row);
      if (collected.length >= collectLimit) break;
    }

    maybeFireProgressiveReveal();

    // Only advance/exhaust from authoritative unthrottled responses.
    if (passAuthoritative) {
      hasMore = res?.hasMore === true;
      nextCursor = res?.nextCursor != null ? String(res.nextCursor) : null;
    } else if (!rawRows.length) {
      // Throttled/failed/empty-uncertain: stop collecting; do not mark exhausted.
      hasMore = false;
      break;
    } else {
      hasMore = res?.hasMore === true;
      nextCursor = res?.nextCursor != null ? String(res.nextCursor) : null;
      // Never trust hasMore:false from throttled replay.
      if (passThrottleMs > 0 && !hasMore) {
        hasMore = collected.length < collectLimit;
      }
    }
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

  const prior = peekPriorYoutubePaging();
  const passThrottleMsForDecision = throttleMs > 0 ? throttleMs : 0;
  let disposition: HomeFeedRequestDisposition | null = null;
  let pagingApplied = false;
  let paging: HomeFeedPagingState = { ...prior };
  if (lastRes) {
    disposition = classifyFeedApiResponse(lastRes, {
      throttleMs: passThrottleMsForDecision,
    });
    const decision = decideHomeFeedPagingState({
      disposition,
      prior,
      responseHasMore: readFeedResponseHasMore(lastRes),
      responseNextCursor: readFeedResponseNextCursor(lastRes),
      responseTotal: readFeedResponseTotal(lastRes),
      rawRowCount: Array.isArray(lastRes?.data) ? lastRes.data.length : collected.length,
      mappedRowCount: collected.length,
      loadedRows: collected.length,
    });
    pagingApplied = decision.action !== "preserve";
    paging = pagingApplied ? decision.paging : { ...prior };
  }

  const rows = finalizeYoutubeCollectedRows(collected, targetCount, rankPoolSize, reason);

  lastYoutubeMediaCollectMeta = {
    reason,
    disposition,
    pagingApplied,
    hasMore: paging.hasMore,
    nextCursor: paging.nextCursor,
    apiPasses,
  };

  return {
    rows,
    paging,
    apiPasses,
    lastApiRowCount,
    disposition,
    pagingApplied,
  };
}

export async function fetchHomeFeedFromApi(
  reason = "load",
  opts?: {
    force?: boolean;
    reconcile?: boolean;
    onAndroidProgressiveReveal?: (
      rows: any[],
      meta: YoutubeProgressiveRevealMeta
    ) => void | Promise<void>;
  }
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
      const androidProgressiveColdLoad =
        Platform.OS === "android" &&
        reason === "load" &&
        !hardRefresh &&
        Boolean(opts?.onAndroidProgressiveReveal);
      const collected = await collectYoutubeHomeFeedMediaRows({
        targetCount: HOME_FEED_YOUTUBE_FIRST_PAGE_SIZE,
        rankPoolSize: applyRotation ? HOME_FEED_YOUTUBE_COLD_START_RANK_POOL_SIZE : undefined,
        startCursor: "0",
        viewerUserId,
        viewerChurchId,
        session,
        reason,
        // Authoritative page-0 paging must not use throttled replay bodies.
        throttleMs: 0,
        progressiveRevealMinCount: androidProgressiveColdLoad
          ? HOME_FEED_ANDROID_PROGRESSIVE_REVEAL_MIN
          : undefined,
        progressiveRevealCount: androidProgressiveColdLoad
          ? HOME_FEED_ANDROID_PROGRESSIVE_REVEAL_COUNT
          : undefined,
        onProgressiveReveal: androidProgressiveColdLoad
          ? opts?.onAndroidProgressiveReveal
          : undefined,
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
      void saveHomeFeedStreamPage(0, rows, collected.paging, viewerUserId).catch((err) => {
        console.log("KRISTO_HOME_FEED_PAGE_CACHE_SAVE_ERROR", {
          message: String((err as Error)?.message || err),
        });
      });
      clearHomeFeedYoutubeSilentNextPagePrep();
      if (snapshotIds.length) {
        setBackendSnapshotRowIds(snapshotIds);
      }
      lastFetchedHomeFeedRows = rows;
      const { markHomeFeedPosterApiRowsReceived } =
        await import("@/src/lib/homeFeedPosterPipelineTrace");
      markHomeFeedPosterApiRowsReceived(rows);
      startYoutubeHomeFeedVisiblePosterPrewarm(rows);
      markHomeFeedStartupTiming("FEED_API_RESPONSE_TS", {
        reason,
        rowCount: rows.length,
        source: "youtube-collect",
      });
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
  /** False when paging was preserved (non-authoritative / failed / uncertain). */
  pagingApplied?: boolean;
  disposition?: HomeFeedRequestDisposition;
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

  const prior = peekHomeFeedPagingSync();
  const disposition = classifyFeedApiResponse(res, { throttleMs: 0 });
  const rawRows = disposition === "network" ? parseFeedRows(res) : [];
  const incoming = rawRows.length;
  const rows = filterPhase1FeedRows(rawRows);
  const decision = decideHomeFeedPagingState({
    disposition,
    prior,
    responseHasMore: readFeedResponseHasMore(res),
    responseNextCursor: readFeedResponseNextCursor(res),
    responseTotal: readFeedResponseTotal(res),
    rawRowCount: incoming,
    mappedRowCount: rows.length,
    loadedRows: getCachedHomeFeedBackendCount(),
  });
  logHomeFeedPagingStateDecision(decision, {
    requestedCursor: offset || "0",
    rawRowCount: incoming,
    mappedRowCount: rows.length,
  });
  const paging =
    decision.action === "preserve" ? { ...prior } : decision.paging;
  const pagingApplied = decision.action !== "preserve";

  if (!rows.length) {
    if (pagingApplied) {
      await saveHomeFeedRowsCache(
        getCachedHomeFeedBackendRows(),
        undefined,
        undefined,
        paging
      );
    }
    return {
      rows: getCachedHomeFeedBackendRows(),
      newRows: [],
      appended: 0,
      incoming,
      hasMore: paging.hasMore,
      nextCursor: paging.nextCursor,
      pagingApplied,
      disposition,
    };
  }

  const { merged, appended, newRows } = await appendHomeFeedBackendRows(
    rows,
    pagingApplied ? paging : undefined
  );
  return {
    rows: merged,
    newRows,
    appended,
    incoming,
    hasMore: paging.hasMore,
    nextCursor: paging.nextCursor,
    pagingApplied,
    disposition,
  };
}

async function fetchHomeFeedYoutubeStreamPage(
  cursor: string | null,
  limit: number
): Promise<HomeFeedPageResult> {
  const session = getSessionSync() as any;
  const viewerUserId = String(session?.userId || "").trim();
  const nextPageIndex = getHomeFeedLoadedPageCount();
  const prior = peekPriorYoutubePaging();

  const prepared = consumeYoutubeSilentNextPagePrep(nextPageIndex);
  if (prepared?.rows?.length) {
    const paging = prepared.paging || prior;
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
      pagingApplied: true,
      disposition: "network",
    };
  }

  const offset = String(cursor ?? "").trim() || "0";
  const pageLimit = Math.max(
    1,
    Math.floor(limit) || homeFeedYoutubeStreamLimitForPage(nextPageIndex)
  );

  const params = new URLSearchParams({
    scope: "global",
    limit: String(pageLimit),
    mediaOnly: "1",
    cursor: offset,
    _: String(Date.now()),
  });

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

  const disposition = classifyFeedApiResponse(res, { throttleMs: 0 });
  const rawRows = disposition === "network" ? parseFeedRows(res) : [];
  const incoming = rawRows.length;
  const rows = filterYoutubeHomeFeedRows(rawRows);
  const loadedRows = getHomeFeedStreamRowsInMemory().length;
  const resolved = resolveYoutubePagingFromResponse({
    res,
    prior,
    rawRowCount: incoming,
    mappedRowCount: rows.length,
    loadedRows,
    throttleMs: 0,
    requestedCursor: offset,
    persist: false,
    viewerUserId,
  });
  const paging = resolved.paging;

  if (!rows.length) {
    // Persist exhaustion only when authoritative decision accepts it.
    if (resolved.pagingApplied) {
      await saveHomeFeedPageCachePaging(paging, viewerUserId);
    }
    const stream = getHomeFeedStreamRowsInMemory();
    lastFetchedHomeFeedRows = stream;
    return {
      rows: stream,
      newRows: [],
      appended: 0,
      incoming,
      hasMore: paging.hasMore,
      nextCursor: paging.nextCursor,
      pagingApplied: resolved.pagingApplied,
      disposition,
    };
  }

  const existing = getHomeFeedStreamRowsInMemory();
  const existingIds = new Set(existing.map((row) => homeFeedRowKey(row)).filter(Boolean));
  const newRows = rows.filter((row) => {
    const id = homeFeedRowKey(row);
    return Boolean(id && !existingIds.has(id));
  });

  if (resolved.pagingApplied) {
    await saveHomeFeedStreamPage(nextPageIndex, rows, paging, viewerUserId);
  } else if (newRows.length) {
    // Keep rows but do not overwrite paging with a non-authoritative decision.
    await saveHomeFeedStreamPage(nextPageIndex, rows, prior, viewerUserId);
  }
  const stream = getHomeFeedStreamRowsInMemory();
  lastFetchedHomeFeedRows = stream;

  return {
    rows: stream,
    newRows,
    appended: newRows.length,
    incoming,
    hasMore: paging.hasMore,
    nextCursor: paging.nextCursor,
    pagingApplied: resolved.pagingApplied,
    disposition,
  };
}

export async function hydrateHomeFeedYoutubePage0(userId?: string) {
  return hydrateHomeFeedPage0FromStorage(userId);
}

export type HomeFeedStalePagingRevalidateResult = {
  attempted: boolean;
  settled: boolean;
  repaired: boolean;
  exhausted: boolean;
  preserved: boolean;
  disposition: HomeFeedRequestDisposition | null;
  paging: HomeFeedPagingState;
  newRows: any[];
  appended: number;
  reason: string;
};

/**
 * Once-per-caller revalidation when a one-page session restored hasMore:false.
 * Uses a real unthrottled network request at cursor "20".
 */
export async function revalidateHomeFeedYoutubeStaleExhaustion(args?: {
  reason?: string;
  loadedPages?: number;
  loadedRows?: number;
  hasMore?: boolean;
  nextCursor?: string | null;
}): Promise<HomeFeedStalePagingRevalidateResult> {
  const reason = String(args?.reason || "focus").trim() || "focus";
  const sessionSnap = peekHomeFeedYoutubeStreamSession();
  const loadedPages = args?.loadedPages ?? sessionSnap.loadedPageCount ?? getHomeFeedLoadedPageCount();
  const loadedRows =
    args?.loadedRows ?? sessionSnap.rows.length ?? getHomeFeedStreamRowsInMemory().length;
  const hasMore = args?.hasMore ?? sessionSnap.hasMore;
  const nextCursor =
    args?.nextCursor !== undefined ? args.nextCursor : sessionSnap.nextCursor;
  const prior = peekPriorYoutubePaging();

  const eligible = shouldRevalidateStaleHomeFeedExhaustion({
    loadedPages,
    loadedRows,
    firstPageSize: HOME_FEED_YOUTUBE_FIRST_PAGE_SIZE,
    hasMore,
    nextCursor,
  });

  if (!eligible) {
    return {
      attempted: false,
      settled: false,
      repaired: false,
      exhausted: false,
      preserved: true,
      disposition: null,
      paging: prior,
      newRows: [],
      appended: 0,
      reason: "not-eligible",
    };
  }

  const requestedCursor = String(HOME_FEED_YOUTUBE_FIRST_PAGE_SIZE);
  console.log("KRISTO_HOME_FEED_PAGING_REVALIDATE_START", {
    reason,
    requestedCursor,
    loadedPages,
    loadedRows,
    priorHasMore: prior.hasMore,
    priorNextCursor: prior.nextCursor,
  });

  const session = getSessionSync() as any;
  const viewerUserId = String(session?.userId || "").trim();
  const generationAtStart = getHomeFeedFetchGeneration();

  try {
    const params = new URLSearchParams({
      scope: "global",
      limit: String(HOME_FEED_YOUTUBE_STREAM_PAGE_SIZE),
      mediaOnly: "1",
      cursor: requestedCursor,
      _: String(Date.now()),
    });

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

    if (generationAtStart !== getHomeFeedFetchGeneration()) {
      console.log("KRISTO_HOME_FEED_PAGING_REVALIDATE_RESULT", {
        reason,
        disposition: "stale-cancelled",
        requestedCursor,
        action: "preserve",
        settled: false,
      });
      return {
        attempted: true,
        settled: false,
        repaired: false,
        exhausted: false,
        preserved: true,
        disposition: "stale-cancelled",
        paging: prior,
        newRows: [],
        appended: 0,
        reason: "stale-cancelled",
      };
    }

    const disposition = classifyFeedApiResponse(res, { throttleMs: 0 });
    const rawRows = disposition === "network" ? parseFeedRows(res) : [];
    const mappedRows = filterYoutubeHomeFeedRows(rawRows);
    const resolved = resolveYoutubePagingFromResponse({
      res,
      prior,
      rawRowCount: rawRows.length,
      mappedRowCount: mappedRows.length,
      loadedRows,
      throttleMs: 0,
      requestedCursor,
      persist: false,
      viewerUserId,
    });

    const decision = resolved.decision;
    let newRows: any[] = [];
    let appended = 0;

    if (decision.action === "preserve") {
      console.log("KRISTO_HOME_FEED_PAGING_REVALIDATE_RESULT", {
        reason,
        disposition,
        requestedCursor,
        rawRowCount: rawRows.length,
        mappedRowCount: mappedRows.length,
        responseHasMore: decision.responseHasMore,
        responseNextCursor: decision.responseNextCursor,
        responseTotal: decision.responseTotal,
        action: "preserve",
        settled: false,
        resultHasMore: prior.hasMore,
        resultNextCursor: prior.nextCursor,
      });
      return {
        attempted: true,
        settled: false,
        repaired: false,
        exhausted: false,
        preserved: true,
        disposition,
        paging: prior,
        newRows: [],
        appended: 0,
        reason: decision.reason,
      };
    }

    // Accept/repair: persist paging; caller merges newRows into the visible session.
    const nextPageIndex = Math.max(1, getHomeFeedLoadedPageCount());
    if (mappedRows.length) {
      const existing = getHomeFeedStreamRowsInMemory();
      const existingIds = new Set(existing.map((row) => homeFeedRowKey(row)).filter(Boolean));
      newRows = mappedRows.filter((row) => {
        const id = homeFeedRowKey(row);
        return Boolean(id && !existingIds.has(id));
      });
      if (newRows.length) {
        await saveHomeFeedStreamPage(nextPageIndex, newRows, decision.paging, viewerUserId);
        lastFetchedHomeFeedRows = getHomeFeedStreamRowsInMemory();
        appended = newRows.length;
      } else {
        await saveHomeFeedPageCachePaging(decision.paging, viewerUserId);
      }
    } else {
      await saveHomeFeedPageCachePaging(decision.paging, viewerUserId);
    }

    saveHomeFeedYoutubeStreamSession({
      nextCursor: decision.paging.nextCursor,
      hasMore: decision.paging.hasMore,
      loadedPageCount: getHomeFeedLoadedPageCount(),
    });

    const repaired =
      decision.action === "repair" ||
      (decision.action === "accept" && decision.paging.hasMore === true);
    const exhausted =
      decision.action === "accept" && decision.paging.hasMore === false;

    console.log("KRISTO_HOME_FEED_PAGING_REVALIDATE_RESULT", {
      reason,
      disposition,
      requestedCursor,
      rawRowCount: rawRows.length,
      mappedRowCount: mappedRows.length,
      responseHasMore: decision.responseHasMore,
      responseNextCursor: decision.responseNextCursor,
      responseTotal: decision.responseTotal,
      action: decision.action,
      settled: true,
      repaired,
      exhausted,
      appended,
      resultHasMore: decision.paging.hasMore,
      resultNextCursor: decision.paging.nextCursor,
      decisionReason: decision.reason,
    });

    return {
      attempted: true,
      settled: true,
      repaired,
      exhausted,
      preserved: false,
      disposition,
      paging: decision.paging,
      newRows,
      appended,
      reason: decision.reason,
    };
  } catch (error) {
    console.log("KRISTO_HOME_FEED_PAGING_REVALIDATE_RESULT", {
      reason,
      disposition: "failed",
      requestedCursor,
      action: "preserve",
      settled: false,
      message: error instanceof Error ? error.message : String(error),
    });
    return {
      attempted: true,
      settled: false,
      repaired: false,
      exhausted: false,
      preserved: true,
      disposition: "failed",
      paging: prior,
      newRows: [],
      appended: 0,
      reason: "failed",
    };
  }
}

export { shouldRevalidateStaleHomeFeedExhaustion };

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
