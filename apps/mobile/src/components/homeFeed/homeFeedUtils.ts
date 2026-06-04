import {
  isFeedVideoItem,
  isOptimisticVideoUploadPost,
  isStandaloneAvatarFeedPost,
  isMediaScheduleFeedItem,
  resolveFeedItemAvatar,
} from "@/src/lib/homeFeedStore";
import { isHomeFeedReadyMediaItem } from "@/src/lib/mediaStatus";
import { avatarCacheBust, normalizeAvatarUpdatedAt } from "@/src/lib/avatarFreshness";
import { baseFeedId } from "@/src/lib/scheduleSlotUtils";

const API_BASE = (process.env.EXPO_PUBLIC_API_BASE || "http://localhost:3000").replace(/\/$/, "");

export function homeFeedMediaUrl(raw: unknown) {
  const v = String(raw || "").trim();
  if (!v) return "";
  if (v.startsWith("data:image/")) return v;
  if (/^https?:\/\//i.test(v) || v.startsWith("file://")) return v;
  return `${API_BASE}${v.startsWith("/") ? "" : "/"}${v}`;
}

export type HomeFeedDisplayAvatar = {
  uri: string;
  backupUri: string;
  initial: string;
};

function homeFeedAvatarCacheBustAt(item: any) {
  return normalizeAvatarUpdatedAt(
    item?.churchAvatarUpdatedAt ?? item?.avatarUpdatedAt ?? item?.church?.avatarUpdatedAt
  );
}

function isHomeFeedChurchMediaPost(item: any) {
  const ownership = String(item?.ownershipType || "").trim().toLowerCase();
  if (ownership === "church" || ownership === "media") return true;

  const source = String(item?.source || "").toLowerCase();
  if (source.includes("media") || source === "media-upload") return true;

  if (String(item?.mediaName || "").trim() && String(item?.type || "").toLowerCase() === "video") {
    return true;
  }

  return false;
}

function homeFeedAvatarSourceFields(item: any, churchMediaFirst: boolean): unknown[] {
  const churchSources = [
    item?.churchAvatarUri,
    item?.churchAvatarUrl,
    item?.churchAvatar,
    item?.churchLogoUrl,
    item?.churchLogoUri,
    item?.churchLogo,
    item?.ownerChurchAvatarUri,
    item?.churchProfileImage,
    item?.churchImage,
    item?.church?.avatarUri,
    item?.church?.avatarUrl,
    item?.church?.logoUri,
    item?.church?.logoUrl,
    item?.church?.image,
  ];

  const mediaSources = [item?.mediaAvatarUri, item?.mediaLogoUrl, item?.mediaLogo];

  const authorSources = [
    item?.authorAvatarUri,
    item?.profileAvatarUri,
    item?.actorAvatarUri,
    item?.avatarUri,
    item?.avatarUrl,
  ];

  if (churchMediaFirst) {
    return [...churchSources, ...mediaSources, ...authorSources];
  }

  return [...authorSources, ...mediaSources, ...churchSources];
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

function pickHomeFeedAvatarUri(raw: unknown, cacheBustAt?: number) {
  const trimmed = String(raw || "").trim();
  if (!trimmed || FEED_AVATAR_BLOCKED.test(trimmed)) return "";
  const base = homeFeedMediaUrl(trimmed);
  if (!base) return "";
  if (base.startsWith("file://") || base.startsWith("data:image/")) return base;
  const bust = Number(cacheBustAt || 0);
  return bust > 0 ? avatarCacheBust(base, bust) : base;
}

/** Church/media posts: church logo first; backup URI for FeedIdentity on image error. */
export function resolveHomeFeedDisplayAvatar(item: any): HomeFeedDisplayAvatar {
  const churchName = resolveChurchName(item);
  const initial = String(churchName || "K").trim().charAt(0).toUpperCase() || "K";
  const churchMediaFirst = isHomeFeedChurchMediaPost(item);
  const cacheBustAt = homeFeedAvatarCacheBustAt(item);
  const sources = homeFeedAvatarSourceFields(item, churchMediaFirst);

  const uris: string[] = [];
  for (const raw of sources) {
    const uri = pickHomeFeedAvatarUri(raw, cacheBustAt);
    if (!uri || uris.includes(uri)) continue;
    uris.push(uri);
  }

  return {
    uri: uris[0] || "",
    backupUri: uris[1] || "",
    initial,
  };
}

export function logHomeFeedIdentityAvatarResolve(
  item: any,
  authorName: string,
  finalAvatarUri: string,
  backupAvatarUri?: string
) {
  console.log("KRISTO_FEED_IDENTITY_AVATAR_RESOLVE", {
    postId: feedRenderKey(item),
    authorName,
    hasAuthorAvatarUri: Boolean(String(item?.authorAvatarUri || "").trim()),
    hasChurchAvatarUri: Boolean(String(item?.churchAvatarUri || "").trim()),
    hasMediaLogoUrl: Boolean(String(item?.mediaLogoUrl || item?.mediaLogo || "").trim()),
    churchAvatarUpdatedAt: item?.churchAvatarUpdatedAt ?? item?.avatarUpdatedAt ?? null,
    finalAvatarUri,
    backupAvatarUri: backupAvatarUri || "",
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
