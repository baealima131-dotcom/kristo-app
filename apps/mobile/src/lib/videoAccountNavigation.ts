import { router } from "expo-router";
import { videoAccountIdentity } from "@/src/lib/videoAccountKey";

/** True when the video-link post names its account (id, profile URL or name). */
export function canOpenVideoAccountOverview(item: any): boolean {
  return Boolean(videoAccountIdentity(item).key);
}

/**
 * Video-link posts: the author avatar / name open the in-app Video Account Overview
 * (app/video-account.tsx) instead of the YouTube / TikTok / Facebook page.
 * The key goes as a search param (it contains ":", "/" and "@").
 */
export function openVideoAccountOverviewFromFeedItem(item: any, params?: { source?: string }): boolean {
  const identity = videoAccountIdentity(item);
  if (!identity.key) return false;
  console.log("KRISTO_VIDEO_ACCOUNT_OPEN", {
    key: identity.key,
    provider: identity.provider,
    postId: String(item?.id || ""),
    source: params?.source || null,
  });
  router.push({
    pathname: "/video-account",
    params: {
      key: identity.key,
      provider: identity.provider,
      name: identity.name || undefined,
      avatar: String(item?.creatorAvatarUrl || item?.actorAvatarUri || "").trim() || undefined,
      source: params?.source || undefined,
    },
  } as any);
  return true;
}
