import { router } from "expo-router";
import { homeFeedRowChurchId } from "@/src/components/homeFeed/homeFeedUtils";

export function openChurchProfile(
  churchId: string,
  params?: { churchName?: string; source?: string }
) {
  const id = String(churchId || "").trim();
  if (!id) return;

  router.push({
    pathname: "/church-profile/[churchId]",
    params: {
      churchId: id,
      churchName: String(params?.churchName || "").trim() || undefined,
      source: String(params?.source || "").trim() || undefined,
    },
  } as any);
}

/** Church profile in the Church Overview style (Home feed video avatar). */
export function openChurchOverviewFromFeedItem(item: any, params?: { source?: string }) {
  const id = String(homeFeedRowChurchId(item) || "").trim();
  if (!id) return;
  router.push({
    pathname: "/church-overview/[churchId]",
    params: {
      churchId: id,
      churchName: String(item?.churchName || item?.churchLabel || "").trim() || undefined,
      source: String(params?.source || "").trim() || undefined,
    },
  } as any);
}

export function openChurchProfileFromFeedItem(
  item: any,
  params?: { source?: string }
) {
  const churchId = homeFeedRowChurchId(item);
  if (!churchId) return;
  openChurchProfile(churchId, {
    churchName: String(item?.churchName || item?.churchLabel || "").trim() || undefined,
    source: params?.source,
  });
}
