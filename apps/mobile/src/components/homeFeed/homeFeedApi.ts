import { apiGet, apiPost } from "@/src/lib/kristoApi";
import { getKristoHeaders } from "@/src/lib/kristoHeaders";
import { getSessionSync } from "@/src/lib/kristoSession";
import { baseFeedId } from "@/src/lib/scheduleSlotUtils";
import { stableMergeHomeFeedRows } from "./homeFeedPagination";
import { filterPhase1FeedRows, normalizeHomeFeedApiRow } from "./homeFeedUtils";
import { isHomeFeedReadyMediaItem } from "@/src/lib/mediaStatus";
import { isMediaScheduleFeedItem } from "@/src/lib/homeFeedStore";
import { parseChurchFeedListResponse } from "@/src/lib/mediaScheduleSilentReload";
import { peekHomeFeedRowsCacheSync, saveHomeFeedRowsCache } from "./homeFeedRowsCache";

let lastFetchedHomeFeedRows: any[] = [];

function commitHomeFeedBackendRows(rows: any[]) {
  lastFetchedHomeFeedRows = rows;
  void saveHomeFeedRowsCache(rows);
  return rows;
}

/** Last successful feed snapshot — memory first, then persisted AsyncStorage cache. */
export function getCachedHomeFeedBackendRows(): any[] {
  if (lastFetchedHomeFeedRows.length) return lastFetchedHomeFeedRows;
  const persisted = peekHomeFeedRowsCacheSync();
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
  await saveHomeFeedRowsCache(snapshot, userId);
  return snapshot.length;
}

/** Merge incoming API rows into cache without dropping existing ids. */
export function mergeCachedHomeFeedBackendRows(incoming: any[]): any[] {
  if (!incoming.length) return getCachedHomeFeedBackendRows();
  const { merged } = stableMergeHomeFeedRows(getCachedHomeFeedBackendRows(), incoming);
  return commitHomeFeedBackendRows(merged);
}

function parseFeedRows(res: any): any[] {
  const raw = parseChurchFeedListResponse(res).rows.map(normalizeHomeFeedApiRow);
  return raw.filter(
    (row) => isMediaScheduleFeedItem(row) || isHomeFeedReadyMediaItem(row)
  );
}

export async function fetchHomeFeedFromApi(
  reason = "load",
  opts?: { force?: boolean }
) {
  const session = getSessionSync() as any;
  const viewerUserId = String(session?.userId || "").trim();
  const viewerChurchId = String(session?.churchId || "").trim();
  const force = opts?.force === true;
  const bypassThrottle =
    force ||
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
  if (getCachedHomeFeedBackendRows().length) {
    return mergeCachedHomeFeedBackendRows(rows);
  }
  return commitHomeFeedBackendRows(rows);
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
