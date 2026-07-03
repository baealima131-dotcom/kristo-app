import { getFeedItemById } from "@/app/api/_lib/store/feedDb";

export const PUBLIC_SHARE_WEB_BASE = "https://kristo-app.vercel.app";

export type PublicSharedPostPreview = {
  id: string;
  title: string;
  body: string;
  churchName: string;
  authorName: string;
  posterUrl?: string;
  videoUrl?: string;
  mediaKind: string;
  createdAt?: string;
  shareUrl: string;
};

function normalizeSharedPostId(raw: unknown) {
  try {
    return decodeURIComponent(String(raw || "").trim());
  } catch {
    return String(raw || "").trim();
  }
}

function feedItemVisibility(item: any) {
  return String(item?.visibility || item?.audience || "public").toLowerCase();
}

function isDeletedFeedItem(item: any) {
  if (item?.deleted === true) return true;
  if (String(item?.deletedAt || "").trim()) return true;
  const status = String(item?.status || item?.scheduleStatus || "").trim().toLowerCase();
  return status === "deleted";
}

function isHiddenByReportsFeedItem(item: any) {
  return item?.hiddenByReports === true;
}

function isMediaScheduleFeedItem(item: any) {
  const source = String(item?.source || "").trim().toLowerCase();
  const type = String(item?.type || item?.kind || "").trim().toLowerCase();
  if (source.includes("schedule") || type.includes("schedule")) return true;
  return Array.isArray(item?.scheduleSlots) && item.scheduleSlots.length > 0;
}

/** Public web share: global/public posts only; no auth-gated church or schedule content. */
export function isPublicWebShareableFeedItem(item: any) {
  if (!item) return false;
  if (isDeletedFeedItem(item)) return false;
  if (isHiddenByReportsFeedItem(item)) return false;
  if (isMediaScheduleFeedItem(item)) return false;

  const visibility = feedItemVisibility(item);
  if (visibility.includes("private") || visibility.includes("members")) return false;
  if (visibility.includes("church") && !visibility.includes("public") && !visibility.includes("global")) {
    return false;
  }

  return (
    visibility.includes("public") ||
    visibility.includes("global") ||
    (!visibility.includes("church") && !visibility.includes("private"))
  );
}

function firstNonEmpty(...values: unknown[]) {
  for (const value of values) {
    const next = String(value || "").trim();
    if (next) return next;
  }
  return "";
}

function buildPublicSharedPostPreview(item: any, requestPostId: string): PublicSharedPostPreview {
  const id = firstNonEmpty(item?.id, requestPostId);
  const title = firstNonEmpty(item?.title, item?.videoTitle, item?.postTitle, item?.body, item?.text, item?.caption);
  const body = firstNonEmpty(item?.body, item?.text, item?.caption, title);
  const churchName = firstNonEmpty(item?.churchName, item?.churchLabel, "Kristo");
  const authorName = firstNonEmpty(item?.authorName, item?.actorLabel, item?.displayName, churchName);
  const posterUrl =
    firstNonEmpty(
      item?.posterUri,
      item?.videoPosterUri,
      item?.thumbnailUri,
      item?.posterUrl,
      item?.imageUrl,
      item?.mediaUri
    ) || undefined;
  const videoUrl =
    firstNonEmpty(item?.videoUrl, item?.videoUri, item?.mediaUrl, item?.playbackUrl, item?.url) || undefined;
  const mediaKind = firstNonEmpty(item?.mediaKind, item?.postKind, item?.kind, item?.type, videoUrl ? "video" : "post");
  const createdAt = firstNonEmpty(item?.createdAt, item?.updatedAt) || undefined;

  return {
    id,
    title: title || "Kristo post",
    body,
    churchName,
    authorName,
    posterUrl,
    videoUrl,
    mediaKind,
    createdAt,
    shareUrl: `${PUBLIC_SHARE_WEB_BASE}/post/${encodeURIComponent(id)}`,
  };
}

export async function resolvePublicSharedPost(
  rawPostId: unknown
): Promise<PublicSharedPostPreview | null> {
  const postId = normalizeSharedPostId(rawPostId);
  if (!postId) return null;

  const item = await getFeedItemById(postId);
  if (!item || !isPublicWebShareableFeedItem(item)) return null;

  return buildPublicSharedPostPreview(item, postId);
}
