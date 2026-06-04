import {
  isFeedVideoItem,
  isOptimisticVideoUploadPost,
  isStandaloneAvatarFeedPost,
  isMediaScheduleFeedItem,
  resolveFeedItemAvatar,
} from "@/src/lib/homeFeedStore";
import { isHomeFeedReadyMediaItem } from "@/src/lib/mediaStatus";
import { baseFeedId } from "@/src/lib/scheduleSlotUtils";

const API_BASE = (process.env.EXPO_PUBLIC_API_BASE || "http://localhost:3000").replace(/\/$/, "");

export function homeFeedMediaUrl(raw: unknown) {
  const v = String(raw || "").trim();
  if (!v) return "";
  if (/^https?:\/\//i.test(v) || v.startsWith("file://")) return v;
  return `${API_BASE}${v.startsWith("/") ? "" : "/"}${v}`;
}

/** Comment avatars: keep data URLs and absolute http(s); only prefix relative upload paths. */
export function commentAvatarUrl(raw: unknown) {
  const v = String(raw || "").trim();
  if (!v) return "";
  if (v.startsWith("data:image/")) return v;
  if (/^https?:\/\//i.test(v)) return v;
  return homeFeedMediaUrl(v);
}

/** Phase-1 Home Feed rows: posts with media or text; no live/schedule/cycle cards. */
export function isPhase1HomeFeedPost(item: any): boolean {
  if (!item || isStandaloneAvatarFeedPost(item)) return false;
  if (isMediaScheduleFeedItem(item)) return false;

  const slots = Array.isArray(item?.scheduleSlots) ? item.scheduleSlots : [];
  if (slots.length > 0) return false;
  if (String(item?.scheduleType || "").includes("media-live-slots")) return false;
  if (item?.isLiveNow || item?.kind === "live") return false;

  const id = String(item?.id || "");
  if (id.includes("__slot_")) return false;

  if (isOptimisticVideoUploadPost(item)) return true;

  const videoUrl = String(item?.videoUrl || "").trim();
  const mediaUri = String(item?.mediaUri || "").trim();
  const title = String(item?.title || "").trim();
  const body = String(item?.body || item?.text || "").trim();

  if (isFeedVideoItem(item) && videoUrl) return true;
  if (item?.mediaType === "video" && videoUrl) return true;
  if (item?.mediaType === "image" && mediaUri) return true;
  if (title || body) return true;

  return false;
}

export function filterPhase1FeedRows(rows: any[]) {
  return rows.filter((row) => isHomeFeedReadyMediaItem(row) && isPhase1HomeFeedPost(row));
}

/** Canonical post id for likes, comments, and FlatList keys (strips slot/fiscal suffixes). */
export function feedRenderKey(item: any) {
  return baseFeedId(String(item?.id || item?.feedOriginId || ""));
}

export function readFeedItemLikedByMe(item: any) {
  return item?.likedByMe === true || item?.liked === true;
}

export function hydrateFeedRowLikes(
  rows: any[],
  serverLikeByPostId: Record<string, { likedByMe: boolean; likeCount: number }>
) {
  return rows.map((item) => {
    const postId = feedRenderKey(item);
    const server = postId ? serverLikeByPostId[postId] : undefined;
    const itemLikedByMe = readFeedItemLikedByMe(item);
    const likedByMe = server?.likedByMe === true || itemLikedByMe;
    const likeCount = Math.max(Number(item?.likeCount || 0), Number(server?.likeCount || 0));

    if (
      item?.likedByMe === likedByMe &&
      item?.liked === likedByMe &&
      Number(item?.likeCount || 0) === likeCount
    ) {
      return item;
    }

    return {
      ...item,
      likedByMe,
      liked: likedByMe,
      likeCount,
    };
  });
}

export function mergeFeedRowsDeterministic(backendRows: any[], localRows: any[]) {
  const seen = new Set<string>();
  const merged: any[] = [];

  for (const row of backendRows) {
    const id = String(row?.id || "").trim();
    if (!id || seen.has(id)) continue;
    seen.add(id);
    merged.push(row);
  }

  const locals = filterPhase1FeedRows(localRows)
    .filter((row) => {
      const id = String(row?.id || "").trim();
      return id && !seen.has(id);
    })
    .sort((a, b) => {
      const ta = Date.parse(String(a?.createdAt || "")) || 0;
      const tb = Date.parse(String(b?.createdAt || "")) || 0;
      return tb - ta;
    });

  return [...merged, ...locals];
}

export function formatActionCount(value?: number) {
  const n = Math.max(0, Math.floor(Number(value || 0)));
  if (n >= 1_000_000) {
    const compact = n / 1_000_000;
    const digits = n >= 10_000_000 ? 0 : 1;
    return `${compact.toFixed(digits).replace(/\.0$/, "")}M`;
  }
  if (n >= 1000) {
    const compact = n / 1000;
    const digits = n >= 10_000 ? 0 : 1;
    return `${compact.toFixed(digits).replace(/\.0$/, "")}K`;
  }
  return String(n);
}

export function formatFeedTimestamp(createdAt?: string) {
  const ms = Date.parse(String(createdAt || ""));
  if (!Number.isFinite(ms)) return "";
  const diff = Date.now() - ms;
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return "Just now";
  if (mins < 60) return `${mins}m`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days}d`;
  return new Date(ms).toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

const FEED_AVATAR_BLOCKED = /\/profile-avatars\//i;

export function resolveChurchName(item: any) {
  return String(
    item?.churchName ||
      item?.churchLabel ||
      item?.church?.name ||
      item?.mediaChurchName ||
      "My Church"
  ).trim();
}

export function resolveMediaName(item: any) {
  return String(
    item?.mediaName ||
      item?.actorLabel ||
      item?.authorName ||
      item?.postedByName ||
      item?.displayName ||
      ""
  ).trim();
}

export function resolvePostTitle(item: any) {
  return String(item?.title || item?.postTitle || "").trim();
}

export function resolvePostBody(item: any) {
  return String(item?.body || item?.text || item?.description || item?.caption || "").trim();
}

export function resolvePostAuthorName(item: any) {
  return resolveMediaName(item) || resolveChurchName(item);
}

export function resolvePostCaption(item: any) {
  const title = resolvePostTitle(item);
  const body = resolvePostBody(item);
  if (title && body && title !== body) return `${title}\n${body}`;
  return title || body;
}

function pickHomeFeedAvatarUri(raw: unknown) {
  const trimmed = String(raw || "").trim();
  if (!trimmed || FEED_AVATAR_BLOCKED.test(trimmed)) return "";
  return homeFeedMediaUrl(trimmed);
}

/** Media/church posts: prefer author/media/church avatar fields from API enrichment. */
export function resolveHomeFeedDisplayAvatar(item: any) {
  const churchName = resolveChurchName(item);
  const initial = String(churchName || "K").trim().charAt(0).toUpperCase() || "K";

  const sources: unknown[] = [
    item?.authorAvatarUri,
    item?.mediaAvatarUri,
    item?.mediaLogoUrl,
    item?.mediaLogo,
    item?.churchAvatarUri,
    item?.churchAvatarUrl,
    item?.churchAvatar,
    item?.churchLogoUrl,
    item?.churchLogoUri,
    item?.churchLogo,
    item?.ownerChurchAvatarUri,
    item?.profileAvatarUri,
    item?.actorAvatarUri,
    item?.avatarUri,
    item?.avatarUrl,
    item?.churchProfileImage,
    item?.churchImage,
    item?.church?.avatarUri,
    item?.church?.avatarUrl,
    item?.church?.logoUri,
    item?.church?.logoUrl,
    item?.church?.image,
  ];

  for (const raw of sources) {
    const uri = pickHomeFeedAvatarUri(raw);
    if (uri) return { uri, initial };
  }

  return { uri: "", initial };
}

export function logHomeFeedIdentityAvatarResolve(
  item: any,
  authorName: string,
  finalAvatarUri: string
) {
  console.log("KRISTO_FEED_IDENTITY_AVATAR_RESOLVE", {
    postId: feedRenderKey(item),
    authorName,
    hasAuthorAvatarUri: Boolean(String(item?.authorAvatarUri || "").trim()),
    hasChurchAvatarUri: Boolean(String(item?.churchAvatarUri || "").trim()),
    hasMediaLogoUrl: Boolean(String(item?.mediaLogoUrl || item?.mediaLogo || "").trim()),
    finalAvatarUri,
  });
}

export function resolvePostAvatar(item: any) {
  return resolveHomeFeedDisplayAvatar(item).uri;
}

export function resolveVideoUri(item: any) {
  const local = String(item?.localVideoUri || "").trim();
  if (local.startsWith("file://")) return local;
  return homeFeedMediaUrl(item?.videoUrl || item?.mediaUri);
}

export function resolveImageUri(item: any) {
  return homeFeedMediaUrl(item?.mediaUri || item?.imageUrl);
}

export function resolvePosterUri(item: any) {
  return homeFeedMediaUrl(
    item?.posterUri ||
      item?.videoPosterUri ||
      item?.thumbnailUri ||
      item?.thumbnailUrl ||
      item?.mediaPosterUri ||
      item?.posterUrl
  );
}

export function isVideoPost(item: any) {
  const uri = resolveVideoUri(item);
  return Boolean(uri) && (item?.mediaType === "video" || isFeedVideoItem(item));
}

export function isImagePost(item: any) {
  const uri = resolveImageUri(item);
  return Boolean(uri) && item?.mediaType === "image" && !isVideoPost(item);
}
