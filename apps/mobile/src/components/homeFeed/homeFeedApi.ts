import { apiGet, apiPost } from "@/src/lib/kristoApi";
import { getKristoHeaders } from "@/src/lib/kristoHeaders";
import { getSessionSync } from "@/src/lib/kristoSession";
import { baseFeedId } from "@/src/lib/scheduleSlotUtils";
import { filterPhase1FeedRows, normalizeHomeFeedApiRow } from "./homeFeedUtils";
import { isHomeFeedReadyMediaItem } from "@/src/lib/mediaStatus";
import { isMediaScheduleFeedItem } from "@/src/lib/homeFeedStore";
import { parseChurchFeedListResponse } from "@/src/lib/mediaScheduleSilentReload";

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

  return filterPhase1FeedRows(rawRows);
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
