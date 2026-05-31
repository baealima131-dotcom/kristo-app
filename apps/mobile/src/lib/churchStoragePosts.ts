import {
  activityCardBackgroundUri,
  activityIsVideo,
  belongsToChurch,
  getChurchActivityLabel,
  isChurchActivityExcludedCard,
  isChurchActivityMediaContentPost,
  isChurchActivityPost,
  isChurchTabActivityPost,
  mergeActivityPostsUnique,
  normalizeActivityMediaUrl,
  sortActivityPostsNewestFirst,
} from "./churchActivityPosts";

export type StorageMode = "church" | "media";

export type StorageBucket = "church" | "media" | "excluded";

export type StoragePostLabel =
  | "VIDEO"
  | "IMAGE"
  | "TESTIMONY"
  | "ANNOUNCEMENT"
  | "PRAYER"
  | "COUNSEL"
  | "POST"
  | "MEDIA";

function normalizeStorageToken(value: unknown): string {
  return String(value || "").trim().toLowerCase();
}

function hasTruthyStorageId(value: unknown): boolean {
  if (value === true) return true;
  if (typeof value === "number" && Number.isFinite(value)) return value > 0;
  return Boolean(String(value || "").trim());
}

function tokenLooksLikeMediaOrigin(value: string): boolean {
  if (!value) return false;
  if (value === "media") return true;
  if (value.includes("media-schedule")) return false;
  if (value.includes("media-upload")) return true;
  if (value.includes("media-team")) return true;
  if (value.includes("media-room")) return true;
  if (value.includes("media_room")) return true;
  if (value.includes("mediaroom")) return true;
  if (value.includes("media/")) return true;
  if (value.includes("/media")) return true;
  if (value.includes("media")) return true;
  return false;
}

export function isMediaOriginPost(item: any): boolean {
  if (!item || typeof item !== "object") return false;

  const ownership = normalizeStorageToken(item?.ownershipType);
  if (ownership === "media") return true;

  const storageType = normalizeStorageToken(item?.storageType);
  if (storageType === "media") return true;

  const source = normalizeStorageToken(item?.source);
  if (source === "media" || source === "media-upload" || source === "media-team") return true;
  if (tokenLooksLikeMediaOrigin(source)) return true;

  const mediaSource = normalizeStorageToken(item?.mediaSource);
  if (tokenLooksLikeMediaOrigin(mediaSource)) return true;

  const sourceRoom = normalizeStorageToken(item?.sourceRoom);
  if (sourceRoom === "media" || tokenLooksLikeMediaOrigin(sourceRoom)) return true;

  const roomType = normalizeStorageToken(item?.roomType);
  if (roomType === "media" || tokenLooksLikeMediaOrigin(roomType)) return true;

  const origin = normalizeStorageToken(item?.origin);
  if (origin === "media" || tokenLooksLikeMediaOrigin(origin)) return true;

  const postOrigin = normalizeStorageToken(item?.postOrigin);
  if (postOrigin === "media" || tokenLooksLikeMediaOrigin(postOrigin)) return true;

  const createdFrom = normalizeStorageToken(item?.createdFrom);
  if (createdFrom === "media" || tokenLooksLikeMediaOrigin(createdFrom)) return true;

  const kind = normalizeStorageToken(item?.kind);
  if (kind === "media") return true;

  if (hasTruthyStorageId(item?.mediaTeamId)) return true;
  if (hasTruthyStorageId(item?.mediaHostId)) return true;
  if (hasTruthyStorageId(item?.mediaUploadId)) return true;

  if (item?.isMediaPost === true) return true;

  const type = normalizeStorageToken(item?.type);
  const route = normalizeStorageToken(item?.route || item?.postRoute || item?.createdFromRoute);
  if (type === "video" && tokenLooksLikeMediaOrigin(route)) return true;
  if (type === "video" && tokenLooksLikeMediaOrigin(source)) return true;

  const roomId = normalizeStorageToken(item?.roomId);
  if (roomId && tokenLooksLikeMediaOrigin(roomId)) return true;

  return false;
}

function isAllowedChurchStoragePost(item: any): boolean {
  const id = String(item?.id || "").trim();
  if (!id) return false;

  if (isChurchActivityPost(item)) return true;
  if (isChurchTabActivityPost(item)) return true;
  if (isChurchActivityMediaContentPost(item)) return true;

  const type = normalizeStorageToken(item?.type);
  const kind = normalizeStorageToken(item?.kind);
  if (type === "post" || kind === "post") return true;

  return Boolean(String(item?.title || item?.text || item?.body || "").trim());
}

export function classifyStorageBucket(item: any, churchId: string): StorageBucket {
  if (!item || typeof item !== "object") return "excluded";
  if (!belongsToChurch(item, churchId)) return "excluded";
  if (isChurchActivityExcludedCard(item)) return "excluded";
  if (isMediaOriginPost(item)) return "media";
  if (isAllowedChurchStoragePost(item)) return "church";
  return "excluded";
}

function logStorageClassify(item: any, churchId: string) {
  if (!__DEV__) return;

  console.log("KRISTO_STORAGE_CLASSIFY", {
    id: String(item?.id || ""),
    title: String(item?.title || item?.text || item?.body || "").slice(0, 80),
    source: item?.source,
    type: item?.type,
    kind: item?.kind,
    ownershipType: item?.ownershipType,
    storageBucket: classifyStorageBucket(item, churchId),
  });
}

function looksLikeBackendIdentifier(value: string): boolean {
  const v = value.trim();
  if (!v) return true;
  if (/^feed_[0-9a-z_]+$/i.test(v)) return true;
  if (/^church-live-/i.test(v)) return true;
  if (/^media-live-/i.test(v)) return true;
  if (/^[a-f0-9-]{24,}$/i.test(v)) return true;
  if (v.includes("__slot_")) return true;
  return false;
}

function sanitizeStorageDisplayText(value: unknown): string {
  const raw = String(value || "").trim();
  if (!raw || looksLikeBackendIdentifier(raw)) return "";
  return raw;
}

function friendlyTypeFallbackTitle(item: any, mode: StorageMode): string {
  const badge = getStoragePostTypeBadge(item, mode);
  return `${badge.charAt(0)}${badge.slice(1).toLowerCase()} post`;
}

export function getStoragePostAuthor(item: any) {
  const nameCandidates = [
    item?.authorName,
    item?.actorLabel,
    item?.postedByName,
    item?.profileName,
    item?.userName,
  ];

  let name = "Church member";
  for (const candidate of nameCandidates) {
    const clean = sanitizeStorageDisplayText(candidate);
    if (clean) {
      name = clean;
      break;
    }
  }

  return {
    id: String(
      item?.actorUserId ||
        item?.authorId ||
        item?.createdBy ||
        item?.userId ||
        ""
    ).trim(),
    name,
    avatarUri: mediaUrl(
      String(
        item?.authorAvatarUri ||
          item?.actorAvatarUri ||
          item?.avatarUri ||
          item?.profileImage ||
          item?.author?.avatarUri ||
          ""
      ).trim()
    ),
    role: getStoragePostAuthorRole(item),
  };
}

export function getStoragePostAuthorRole(item: any): string {
  const role = String(item?.authorRole || item?.role || item?.postedByRole || "").trim();

  if (role) {
    const lower = role.toLowerCase();
    if (lower.includes("pastor")) return "Pastor";
    if (lower.includes("host") || lower.includes("media")) return "Host";
    if (lower.includes("admin")) return "Admin";
    if (lower === "member") return "";
    return sanitizeStorageDisplayText(role);
  }

  return "";
}

export function getStoragePostThumbnail(item: any): string {
  const thumb = activityCardBackgroundUri(item);
  if (thumb) return mediaUrl(thumb);

  return mediaUrl(
    String(item?.posterUri || item?.thumbnailUri || item?.thumbnailUrl || "").trim()
  );
}

export function getStoragePostTitle(item: any, mode: StorageMode = "church"): string {
  for (const field of [item?.title, item?.text, item?.body]) {
    const clean = sanitizeStorageDisplayText(field);
    if (clean) return clean;
  }
  return friendlyTypeFallbackTitle(item, mode);
}

export function getStoragePreviewVideoUri(item: any): string {
  return mediaUrl(String(item?.videoUrl || item?.mediaUri || "").trim());
}

export function getStoragePreviewImageUri(item: any): string {
  if (activityIsVideo(item)) {
    return getStoragePostThumbnail(item);
  }
  const imageUri = mediaUrl(String(item?.mediaUri || item?.imageUrl || "").trim());
  if (imageUri) return imageUri;
  return getStoragePostThumbnail(item);
}

export function canPreviewStoragePost(item: any): boolean {
  if (activityIsVideo(item)) return Boolean(getStoragePreviewVideoUri(item));
  return Boolean(getStoragePreviewImageUri(item));
}

function mediaUrl(uri?: string) {
  return normalizeActivityMediaUrl(uri);
}

export function getStoragePostTypeBadge(item: any, mode: StorageMode): StoragePostLabel {
  if (activityIsVideo(item)) return "VIDEO";

  const mediaType = String(item?.mediaType || "").trim().toLowerCase();
  if (mediaType === "video") return "VIDEO";
  if (mediaType === "image" || Boolean(String(item?.mediaUri || item?.imageUrl || "").trim())) {
    return "IMAGE";
  }

  if (mode === "media") return "MEDIA";

  const label = getChurchActivityLabel(item);
  if (label === "MEDIA") return "MEDIA";
  return label as StoragePostLabel;
}

export function isStorageChurchPost(item: any, churchId: string): boolean {
  return classifyStorageBucket(item, churchId) === "church";
}

export function isStorageMediaPost(item: any, churchId: string): boolean {
  return classifyStorageBucket(item, churchId) === "media";
}

export function filterStoragePosts(items: any[], mode: StorageMode, churchId: string): any[] {
  const targetBucket: StorageBucket = mode === "media" ? "media" : "church";

  return sortActivityPostsNewestFirst(
    items.filter((item) => {
      logStorageClassify(item, churchId);
      return classifyStorageBucket(item, churchId) === targetBucket;
    })
  );
}

export function mergeStorageSourceRows(
  apiRows: any[],
  supplementalRows: any[],
  mode: StorageMode,
  churchId: string
) {
  const merged = mergeActivityPostsUnique([...apiRows, ...supplementalRows]);
  return filterStoragePosts(merged, mode, churchId);
}

export function isPastorOrAdminRole(role?: string) {
  const value = String(role || "").trim().toLowerCase();
  return value.includes("pastor") || value.includes("admin");
}

export function canDeleteStoragePosts(mode: StorageMode, session: any, isMediaHost = false) {
  if (isPastorOrAdminRole(session?.role)) return true;
  if (mode === "media" && isMediaHost) return true;
  return false;
}
