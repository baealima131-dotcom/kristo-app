import { apiGet, apiPost } from "@/src/lib/kristoApi";
import { getKristoHeaders } from "@/src/lib/kristoHeaders";
import { getSessionSync } from "@/src/lib/kristoSession";
import { baseFeedId } from "@/src/lib/scheduleSlotUtils";
import { homeFeedRowKey, stableMergeHomeFeedRows } from "./homeFeedPagination";
import { filterPhase1FeedRows, isHomeFeedExpandedScheduleSlotRow, normalizeHomeFeedApiRow } from "./homeFeedUtils";
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
  saveHomeFeedRowsCache,
  removeHomeFeedPostFromRowsCache,
  setBackendSnapshotRowIds,
  getBackendSnapshotRowIds,
  collectRemovedHomeFeedCacheIds,
  logHomeFeedCachePruneDeleted,
  peekHomeFeedRowsCacheSavedAt,
} from "./homeFeedRowsCache";
import {
  getHomeFeedFetchGeneration,
  getHomeFeedFetchInflight,
  logHomeFeedNetworkTrace,
  noteHomeFeedFetchSuccess,
  resolveHomeFeedRefreshMode,
  setHomeFeedFetchInflight,
  shouldHardRefreshHomeFeed,
} from "@/src/lib/homeFeedNetwork";

let lastFetchedHomeFeedRows: any[] = [];

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

async function commitHomeFeedBackendRows(rows: any[], snapshotRowIds?: string[]) {
  const active = filterActiveHomeFeedRows(rows);
  const snapshotIds = (snapshotRowIds || active.map((row) => homeFeedRowKey(row)).filter(Boolean))
    .map((id) => String(id || "").trim())
    .filter(Boolean);
  if (snapshotIds.length) {
    setBackendSnapshotRowIds(snapshotIds);
  }
  lastFetchedHomeFeedRows = active;
  await saveHomeFeedRowsCache(active, undefined, snapshotIds);
  return active;
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

  const inflight = getHomeFeedFetchInflight();
  if (inflight) {
    logHomeFeedNetworkTrace({ event: "dedupe-join", reason });
    return inflight;
  }

  const fetchPromise = (async () => {
    logHomeFeedNetworkTrace({ event: "api-request", reason, refreshMode });

    const res: any = await apiGet(
      `/api/church/feed?scope=global&_=${Date.now()}`,
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
    return reconcileHomeFeedBackendCacheWithSnapshot(rows);
  })().finally(() => {
    setHomeFeedFetchInflight(null);
  });

  setHomeFeedFetchInflight(fetchPromise);
  return fetchPromise;
}

export type HomeFeedPageResult = {
  rows: any[];
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
async function appendHomeFeedBackendRows(pageRows: any[]) {
  const active = filterActiveHomeFeedRows(pageRows);
  const existing = getCachedHomeFeedBackendRows();
  const before = existing.length;
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
  await saveHomeFeedRowsCache(merged, undefined, snapshotIds);
  return { merged, appended };
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

  const rawRows = parseFeedRows(res);
  const incoming = rawRows.length;
  const rows = filterPhase1FeedRows(rawRows);

  if (!rows.length) {
    return {
      rows: getCachedHomeFeedBackendRows(),
      appended: 0,
      incoming,
      hasMore,
      nextCursor,
    };
  }

  const { merged, appended } = await appendHomeFeedBackendRows(rows);
  return { rows: merged, appended, incoming, hasMore, nextCursor };
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
