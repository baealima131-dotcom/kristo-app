import { apiGet, apiPost } from "@/src/lib/kristoApi";
import { getKristoHeaders } from "@/src/lib/kristoHeaders";
import { getSessionSync } from "@/src/lib/kristoSession";
import { baseFeedId } from "@/src/lib/scheduleSlotUtils";
import { homeFeedRowKey, pruneHomeFeedBackendRowsNotInSnapshot } from "./homeFeedPagination";
import { filterPhase1FeedRows, normalizeHomeFeedApiRow } from "./homeFeedUtils";
import { isHomeFeedReadyMediaItem } from "@/src/lib/mediaStatus";
import { isMediaScheduleFeedItem } from "@/src/lib/homeFeedStore";
import { parseChurchFeedListResponse } from "@/src/lib/mediaScheduleSilentReload";
import {
  peekHomeFeedRowsCacheSync,
  saveHomeFeedRowsCache,
  removeHomeFeedPostFromRowsCache,
  setBackendSnapshotRowIds,
  collectRemovedHomeFeedCacheIds,
  logHomeFeedCachePruneDeleted,
} from "./homeFeedRowsCache";

let lastFetchedHomeFeedRows: any[] = [];

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
  const reconciled = pruneHomeFeedBackendRowsNotInSnapshot(existing, activeSnapshot);
  const snapshotRowIds = activeSnapshot.map((row) => homeFeedRowKey(row)).filter(Boolean);

  if (removedIds.length > 0 || before > reconciled.length) {
    logHomeFeedCachePruneDeleted(before, reconciled.length, removedIds);
  }

  return commitHomeFeedBackendRows(reconciled, snapshotRowIds);
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

/** Persist the first N merged rows for fast cold-start Home Feed paint. */
export async function persistHomeFeedBackendRowsSnapshot(maxRows: number, userId?: string) {
  const merged = getCachedHomeFeedBackendRows();
  if (!merged.length || maxRows <= 0) return 0;
  const snapshot = merged.slice(0, maxRows);
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
  return filterActiveHomeFeedRows(
    raw.filter((row) => isMediaScheduleFeedItem(row) || isHomeFeedReadyMediaItem(row))
  );
}

export async function fetchHomeFeedFromApi(
  reason = "load",
  opts?: { force?: boolean; reconcile?: boolean }
) {
  const session = getSessionSync() as any;
  const viewerUserId = String(session?.userId || "").trim();
  const viewerChurchId = String(session?.churchId || "").trim();
  const force = opts?.force === true;
  const bypassThrottle =
    force ||
    opts?.reconcile === true ||
    reason.includes("post-delete") ||
    reason === "focus" ||
    reason === "startup-prewarm" ||
    reason.startsWith("schedule-dirty") ||
    reason.startsWith("slot-claim");

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
      throttleMs: bypassThrottle ? 0 : 8000,
      dedupe: force ? false : undefined,
    }
  );

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
  if (!rows.length) return getCachedHomeFeedBackendRows();
  return reconcileHomeFeedBackendCacheWithSnapshot(rows);
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
