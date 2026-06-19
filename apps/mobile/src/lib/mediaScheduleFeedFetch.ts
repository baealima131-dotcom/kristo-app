import { apiGet } from "@/lib/kristoApi";
import {
  parseChurchFeedListResponse,
  type MediaScheduleFeedSync,
} from "@/lib/mediaScheduleFeedParse";

export type { MediaScheduleFeedSync };

export async function fetchMediaScheduleFeedSync(
  churchId: string,
  headers?: Record<string, string>,
  opts?: { targetChurchId?: string }
): Promise<MediaScheduleFeedSync> {
  const viewerChurchId = String(churchId || "").trim();
  const targetChurchId = String(opts?.targetChurchId || viewerChurchId).trim();
  const query =
    targetChurchId && targetChurchId !== viewerChurchId
      ? `/api/church/feed?scope=church&churchId=${encodeURIComponent(targetChurchId)}&_=${Date.now()}`
      : `/api/church/feed?scope=church&_=${Date.now()}`;

  const res: any = await apiGet(query, {
    headers,
    cache: "no-store" as RequestCache,
  });

  return parseChurchFeedListResponse(res);
}
