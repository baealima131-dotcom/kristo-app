import { apiGet, apiPost } from "@/src/lib/kristoApi";
import { getKristoHeaders } from "@/src/lib/kristoHeaders";
import { getSessionSync } from "@/src/lib/kristoSession";
import { baseFeedId } from "@/src/lib/scheduleSlotUtils";
import { filterPhase1FeedRows } from "./homeFeedUtils";
import { isHomeFeedReadyMediaItem } from "@/src/lib/mediaStatus";

function parseFeedRows(res: any): any[] {
  const raw = Array.isArray(res?.data)
    ? res.data
    : Array.isArray(res?.data?.items)
      ? res.data.items
      : Array.isArray(res?.items)
        ? res.items
        : [];
  return raw.filter(isHomeFeedReadyMediaItem);
}

export async function fetchHomeFeedFromApi(reason = "load") {
  const session = getSessionSync() as any;
  const viewerUserId = String(session?.userId || "").trim();
  const viewerChurchId = String(session?.churchId || "").trim();

  const res: any = await apiGet(
    `/api/church/feed?_=${Date.now()}`,
    {
      headers: getKristoHeaders({
        userId: viewerUserId,
        role: (session?.role || "Member") as any,
        churchId: viewerChurchId,
      }),
      cache: "no-store" as RequestCache,
    },
    { screen: "HomeFeed", throttleMs: reason === "focus" ? 0 : 8000 }
  );

  return filterPhase1FeedRows(parseFeedRows(res));
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
