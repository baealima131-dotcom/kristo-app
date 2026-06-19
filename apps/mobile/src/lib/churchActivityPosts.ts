import {
  homeFeedMediaUrl,
  inferPosterUriFromVideoUrl,
  isInferredPosterUriForVideo,
  isLikelySyntheticPosterPath,
  isValidVideoPosterUri,
  normalizeHomeFeedApiRow,
  resolvePosterUri,
  resolvePostImageUri,
  resolvePostImageUris,
  resolveVideoUri,
} from "@/components/homeFeed/homeFeedUtils";
import { isBrandedPosterUri, itemUsesBrandedVideoPoster } from "@/lib/brandedVideoPoster";
import { isFeedVideoItem } from "@/lib/homeFeedStore";
import { peekCachedMediaPoster } from "@/lib/mediaPosterCache";

export type ChurchActivityLabel =
  | "TESTIMONY"
  | "ANNOUNCEMENT"
  | "PRAYER"
  | "COUNSEL"
  | "POST"
  | "MEDIA";

export type ActivityGridItem = {
  id: string;
  title?: string;
  text?: string;
  body?: string;
  source?: string;
  kind?: string;
  type?: string;
  createdAt?: string;
  authorName?: string;
  actorLabel?: string;
  churchName?: string;
  mediaUri?: string;
  videoUrl?: string;
  videoPosterUri?: string;
  posterUri?: string;
  thumbnailUri?: string;
  thumbnailUrl?: string;
  mediaType?: string;
  imageUrl?: string;
  mediaUrls?: string[];
  images?: string[];
  ownershipType?: string;
  authorAvatarUri?: string;
};

function isVideoFileUri(uri: string) {
  return /\.(mp4|mov|m4v|webm|mkv)(\?|#|$)/i.test(String(uri || "").trim());
}

function applyActivityMediaUrl(uri: string, mediaUrlFn?: (uri?: string) => string) {
  const value = String(uri || "").trim();
  if (!value || value.startsWith("kristo:")) return "";
  return mediaUrlFn ? mediaUrlFn(value) : homeFeedMediaUrl(value);
}

function enrichActivityGridRow(item: any) {
  const row = normalizeHomeFeedApiRow(item && typeof item === "object" ? { ...item } : item);
  if (!row || typeof row !== "object") return {};

  const videoUrl = resolveVideoUri(row);
  if (videoUrl) {
    row.videoUrl = videoUrl;
    if (String(row?.mediaType || "").trim().toLowerCase() !== "image") {
      row.mediaType = row.mediaType || "video";
    }
  }

  return row;
}

export type ActivityGridPreviewTrace = {
  postId: string;
  mediaUrl: string;
  videoUrl: string;
  resolvedVideoUri: string;
  thumbnailUrl: string;
  posterUrl: string;
  coverUrl: string;
  previewUrl: string;
  inferredPosterUri: string;
  finalPreviewUri: string;
  resolvedPreviewUrl: string;
  storedPosterUri: string;
  storedVideoPosterUri: string;
  storedThumbnailUri: string;
  brandedPoster: boolean;
};

function activityRawField(item: any, key: string) {
  return String(item?.[key] || "").trim();
}

function isVideoPreviewUri(uri: string) {
  return /\.(mp4|mov|m4v|webm|mkv)(\?|#|$)/i.test(String(uri || "").trim());
}

function firstValidPreviewUrl(row: any, keys: string[], videoUrl: string) {
  for (const key of keys) {
    const resolved = homeFeedMediaUrl(row?.[key]);
    if (resolved && isValidVideoPosterUri(resolved, videoUrl)) return resolved;
  }
  return "";
}

function shouldUseStaticPosterCandidate(postId: string, posterUrl: string, videoUrl: string) {
  if (!posterUrl || isBrandedPosterUri(posterUrl)) return false;
  if (!isLikelySyntheticPosterPath(posterUrl) && !isInferredPosterUriForVideo(posterUrl, videoUrl)) {
    return true;
  }
  const cached = peekCachedMediaPoster(postId, videoUrl);
  if (!cached) return false;
  const norm = (value: string) => String(value || "").trim().split("?")[0];
  return norm(cached) === norm(posterUrl);
}

/** Ordered static preview URLs for Media grid cards (before auto frame generation). */
export function resolveMediaVideoPreviewCandidates(item: any): string[] {
  const row = enrichActivityGridRow(item);
  const videoUrl = resolveVideoUri(row);
  if (!videoUrl) return [];

  const postId = String(item?.id || row?.id || "").trim();

  const tiers = [
    firstValidPreviewUrl(row, ["thumbnailUrl", "thumbnailUri"], videoUrl),
    firstValidPreviewUrl(row, ["posterUrl", "posterUri", "videoPosterUri"], videoUrl),
    firstValidPreviewUrl(row, ["coverUrl", "coverImageUrl", "coverImage"], videoUrl),
    firstValidPreviewUrl(row, ["firstFrameUrl"], videoUrl),
  ];

  const seen = new Set<string>();
  const out: string[] = [];
  for (const uri of tiers) {
    if (!uri || seen.has(uri)) continue;
    if (!shouldUseStaticPosterCandidate(postId, uri, videoUrl)) {
      console.log("KRISTO_MEDIA_PREVIEW_DEBUG", {
        postId,
        videoUrl,
        skippedSyntheticPoster: uri,
        reason: "unverified-inferred-or-synthetic",
      });
      continue;
    }
    seen.add(uri);
    out.push(uri);
  }
  return out;
}

/** Same poster resolution path as Home Feed `FeedRow` / `resolvePosterUri`. */
export function resolveMediaPreviewUrl(item: any): string {
  const row = enrichActivityGridRow(item);
  if (activityIsVideo(row) || isFeedVideoItem(row) || resolveVideoUri(row)) {
    const candidates = resolveMediaVideoPreviewCandidates(item);
    if (candidates.length) return candidates[0];
    return resolvePosterUri(row);
  }
  return resolvePostImageUri(row);
}

export function computeActivityGridPreviewTrace(
  item: any,
  mediaUrlFn?: (uri?: string) => string
): ActivityGridPreviewTrace {
  const row = enrichActivityGridRow(item);
  const resolve = (uri?: string) => applyActivityMediaUrl(String(uri || ""), mediaUrlFn);

  const resolvedVideoUri = resolve(resolveVideoUri(row));
  const mediaUrl = resolve(activityRawField(row, "mediaUrl") || activityRawField(row, "mediaUri"));
  const videoUrl = resolve(activityRawField(row, "videoUrl")) || resolvedVideoUri;
  const thumbnailUrl = resolve(
    activityRawField(row, "thumbnailUrl") || activityRawField(row, "thumbnailUri")
  );
  const posterUrl = resolve(
    activityRawField(row, "posterUrl") ||
      activityRawField(row, "posterUri") ||
      activityRawField(row, "videoPosterUri")
  );
  const coverUrl = resolve(
    activityRawField(row, "coverUrl") ||
      activityRawField(row, "firstFrameUrl") ||
      activityRawField(row, "coverImageUrl")
  );
  const previewUrl = resolve(activityRawField(row, "previewUrl"));
  const inferredPosterUri = resolve(
    inferPosterUriFromVideoUrl(resolvedVideoUri || videoUrl || mediaUrl)
  );

  const storedPosterUri = activityRawField(row, "posterUri");
  const storedVideoPosterUri = activityRawField(row, "videoPosterUri");
  const storedThumbnailUri =
    activityRawField(row, "thumbnailUri") || activityRawField(row, "thumbnailUrl");
  const brandedPoster = itemUsesBrandedVideoPoster(row);

  const resolvedPreviewUrl = resolveMediaVideoPreviewCandidates(item)[0] || resolve(resolveMediaPreviewUrl(item));
  const staticCandidates = resolveMediaVideoPreviewCandidates(item);
  const finalPreviewUri =
    resolvedPreviewUrl && !isVideoPreviewUri(resolvedPreviewUrl) ? resolvedPreviewUrl : "";

  const trace: ActivityGridPreviewTrace = {
    postId: String(item?.id || row?.id || ""),
    mediaUrl,
    videoUrl,
    resolvedVideoUri,
    thumbnailUrl,
    posterUrl,
    coverUrl,
    previewUrl,
    inferredPosterUri,
    finalPreviewUri,
    resolvedPreviewUrl: finalPreviewUri,
    storedPosterUri,
    storedVideoPosterUri,
    storedThumbnailUri,
    brandedPoster,
  };

  console.log("KRISTO_MEDIA_PREVIEW_DEBUG", {
    postId: trace.postId,
    videoUrl: trace.videoUrl,
    mediaUrl: trace.mediaUrl,
    thumbnailUrl: trace.thumbnailUrl,
    posterUrl: trace.posterUrl,
    coverUrl: trace.coverUrl,
    previewUrl: trace.previewUrl,
    resolvedPreviewUrl: trace.resolvedPreviewUrl,
    storedPosterUri: trace.storedPosterUri,
    storedVideoPosterUri: trace.storedVideoPosterUri,
    storedThumbnailUri: trace.storedThumbnailUri,
    inferredPosterUri: trace.inferredPosterUri,
    brandedPoster: trace.brandedPoster,
    staticCandidateCount: staticCandidates.length,
    staticCandidates,
  });

  return trace;
}

export function logActivityGridPreviewTrace(trace: ActivityGridPreviewTrace, extra?: Record<string, unknown>) {
  console.log("KRISTO_MEDIA_GRID_PREVIEW_TRACE", {
    ...trace,
    ...(extra || {}),
  });
}

export function resolveActivityGridPreviewUri(
  item: any,
  mediaUrlFn?: (uri?: string) => string
): string {
  const preview = resolveMediaPreviewUrl(item);
  return applyActivityMediaUrl(preview, mediaUrlFn);
}

/** All image URLs for a post (same resolution path as Home Feed carousel). */
export function resolveActivityPostImageUris(
  item: any,
  mediaUrlFn?: (uri?: string) => string
): string[] {
  const row = enrichActivityGridRow(item);
  const resolve = (uri?: string) => applyActivityMediaUrl(String(uri || ""), mediaUrlFn);
  const mediaType = String(row?.mediaType || "").trim().toLowerCase();
  if (mediaType === "video" || activityIsVideo(row)) return [];

  const seen = new Set<string>();
  const uris: string[] = [];
  const push = (uri?: string) => {
    const resolved = resolve(uri);
    if (!resolved || seen.has(resolved)) return;
    seen.add(resolved);
    uris.push(resolved);
  };

  for (const uri of resolvePostImageUris(row)) {
    push(uri);
  }

  if (uris.length) return uris;

  push(resolvePostImageUri(row));
  return uris;
}

export function normalizeActivityMediaUrl(uri?: string, apiBase?: string) {
  const raw = String(uri || "").trim();
  if (!raw) return "";
  if (raw.startsWith("kristo:")) return "";
  if (/^(https?|file:|data:)/i.test(raw)) return raw;

  const base = String(apiBase || process.env.EXPO_PUBLIC_API_BASE || "").replace(/\/+$/, "");
  if (raw.startsWith("/") && base) return `${base}${raw}`;
  return raw;
}

export function normalizeActivityItem(
  item: any,
  mediaUrlFn?: (uri?: string) => string
): ActivityGridItem {
  const row = enrichActivityGridRow(item);
  const resolve = (uri?: string) => applyActivityMediaUrl(String(uri || ""), mediaUrlFn);
  const videoUrl = resolve(resolveVideoUri(row));
  const isVideo = activityIsVideo(row) || (Boolean(videoUrl) && isFeedVideoItem(row));
  const previewUri = resolveActivityGridPreviewUri(item, mediaUrlFn);
  const resolvedPoster = resolve(resolvePosterUri(row));
  const imageUris = !isVideo ? resolveActivityPostImageUris(item, mediaUrlFn) : [];
  const imageUri = imageUris[0] || (!isVideo ? resolve(resolvePostImageUri(row)) : "");

  return {
    ...row,
    id: String(row?.id || item?.id || ""),
    title: row?.title ?? item?.title,
    text: row?.text ?? item?.text,
    body: row?.body ?? item?.body,
    source: row?.source ?? item?.source,
    kind: row?.kind ?? item?.kind,
    type: row?.type ?? item?.type,
    createdAt: row?.createdAt ?? item?.createdAt,
    authorName: row?.authorName ?? item?.authorName,
    actorLabel: row?.actorLabel ?? item?.actorLabel,
    churchName: row?.churchName ?? item?.churchName,
    mediaUri: !isVideo && (imageUri || previewUri) ? imageUri || previewUri : undefined,
    videoUrl: videoUrl || undefined,
    videoPosterUri: isVideo && resolvedPoster ? resolvedPoster : resolve(row?.videoPosterUri) || undefined,
    posterUri: isVideo && resolvedPoster ? resolvedPoster : resolve(row?.posterUri) || undefined,
    thumbnailUri:
      (isVideo ? resolvedPoster || previewUri : imageUri || previewUri) ||
      resolve(row?.thumbnailUri) ||
      undefined,
    thumbnailUrl:
      (isVideo ? resolvedPoster || previewUri : imageUri || previewUri) ||
      resolve(row?.thumbnailUrl) ||
      undefined,
    mediaType:
      String(row?.mediaType || (isVideo ? "video" : imageUri || previewUri ? "image" : "")).trim() ||
      undefined,
    imageUrl: !isVideo ? imageUri || previewUri || resolve(row?.imageUrl) || undefined : resolve(row?.imageUrl) || undefined,
    mediaUrls: imageUris.length ? imageUris : undefined,
    images: imageUris.length ? imageUris : Array.isArray(row?.images) ? row.images : undefined,
    ownershipType: row?.ownershipType ?? item?.ownershipType,
    authorAvatarUri:
      resolve(
        row?.authorAvatarUri ||
          row?.actorAvatarUri ||
          row?.avatarUri ||
          row?.profileImage ||
          item?.authorAvatarUri ||
          item?.actorAvatarUri ||
          ""
      ) || undefined,
  };
}

export function activityIsVideo(item: any) {
  const row = enrichActivityGridRow(item);
  const mediaType = String(row?.mediaType || item?.mediaType || "").trim().toLowerCase();
  const type = String(row?.type || item?.type || "").trim().toLowerCase();
  if (mediaType === "video" || type === "video") return true;
  if (Boolean(String(row?.videoUrl || item?.videoUrl || "").trim())) return true;

  const videoUrl = resolveVideoUri(row);
  if (videoUrl) return true;

  const mediaUri = String(row?.mediaUri || row?.mediaUrl || item?.mediaUri || item?.mediaUrl || "").trim();
  return isVideoFileUri(mediaUri);
}

export function activityCardBackgroundUri(
  item: any,
  mediaUrlFn?: (uri?: string) => string
) {
  return resolveActivityGridPreviewUri(item, mediaUrlFn);
}

export function activityHasVisualMedia(item: any, mediaUrlFn?: (uri?: string) => string) {
  if (Boolean(resolveActivityGridPreviewUri(item, mediaUrlFn))) return true;

  const row = enrichActivityGridRow(item);
  if (activityIsVideo(row)) {
    return Boolean(resolveVideoUri(row));
  }

  return resolveActivityPostImageUris(row, mediaUrlFn).length > 0 || Boolean(resolvePostImageUri(row));
}

export function getActivityGridLabel(item: any, variant: "church" | "media" = "church"): ChurchActivityLabel {
  if (variant === "media") return "MEDIA";
  return getChurchActivityLabel(item);
}

function bag(item: any) {
  return [
    item?.source,
    item?.kind,
    item?.type,
    item?.scheduleType,
    item?.title,
    item?.text,
    item?.body,
  ]
    .map((v) => String(v || "").trim().toLowerCase())
    .filter(Boolean)
    .join(" ");
}

function activityItemSignalHaystack(item: any) {
  return [
    item?.id,
    item?.source,
    item?.kind,
    item?.type,
    item?.scheduleType,
    item?.title,
    item?.liveRoomPath,
    item?.mediaControl,
    item?.scheduleId,
    item?.sourceScheduleId,
    item?.liveScheduleId,
  ]
    .map((v) => String(v || "").trim().toLowerCase())
    .filter(Boolean)
    .join(" ");
}

export function getChurchActivityExclusionReason(item: any): string | null {
  if (!item || typeof item !== "object") return "invalid-item";

  const haystack = activityItemSignalHaystack(item);
  const source = String(item?.source || "").trim().toLowerCase();
  const kind = String(item?.kind || "").trim().toLowerCase();
  const type = String(item?.type || "").trim().toLowerCase();
  const scheduleType = String(item?.scheduleType || "").trim().toLowerCase();
  const id = String(item?.id || "").trim().toLowerCase();
  const title = String(item?.title || "").trim().toLowerCase();

  if (Array.isArray(item?.scheduleSlots) && item.scheduleSlots.length > 0) {
    return "scheduleSlots";
  }
  if (Array.isArray(item?.claimableSlots) && item.claimableSlots.length > 0) {
    return "claimableSlots";
  }

  if (id.includes("__slot_") || id.startsWith("media-live-")) return "id-slot-or-media-live";
  if (id.startsWith("church-live-now-") || id.includes("live-schedule")) return "id-church-live";

  if (item?.isLiveNow || kind === "live" || type === "live") return "live-flag";
  if (kind === "schedule" || type === "schedule") return "schedule-type";

  if (source.includes("media-schedule")) return "source-media-schedule";
  if (source.includes("live-schedule") || source.includes("live_schedule")) return "source-live-schedule";
  if (scheduleType.includes("media-live-slots")) return "scheduleType-media-live-slots";

  if (
    haystack.includes("claimableslots") ||
    haystack.includes("liveschedule") ||
    haystack.includes("mediacontrol") ||
    haystack.includes("countdown") ||
    haystack.includes("churchlive") ||
    haystack.includes("mediahost") ||
    haystack.includes("media-host") ||
    haystack.includes("slot-management") ||
    haystack.includes("live-time-card")
  ) {
    return "haystack-keyword";
  }

  if (title.includes("live time card")) return "title-live-time-card";

  if (item?.mediaControl || item?.countdownMs != null || item?.liveSlotsRemaining != null) {
    if (scheduleType || source.includes("schedule") || source.includes("live") || item?.isLiveNow) {
      return "live-control-fields";
    }
  }

  if (Boolean(item?.scheduleId || item?.liveScheduleId) && (scheduleType || source.includes("schedule"))) {
    return "schedule-id-fields";
  }

  return null;
}

export function isChurchActivityExcludedCard(item: any) {
  return getChurchActivityExclusionReason(item) != null;
}

export function isChurchActivityMediaContentPost(item: any) {
  if (isChurchActivityExcludedCard(item)) return false;

  const mediaType = String(item?.mediaType || "").trim().toLowerCase();
  if (mediaType === "image" || mediaType === "video") return true;
  if (activityIsVideo(item)) return true;
  if (Boolean(String(item?.mediaUri || item?.imageUrl || item?.videoUrl || "").trim())) return true;

  return false;
}

export function isChurchActivityAllowedPost(item: any) {
  if (isChurchActivityExcludedCard(item)) return false;
  if (isChurchTabActivityPost(item)) return true;
  return isChurchActivityMediaContentPost(item);
}

export function isMediaActivityPost(item: any) {
  if (!item || typeof item !== "object") return false;

  const ownership = String(item?.ownershipType || "").trim().toLowerCase();
  if (ownership === "media") return true;

  const source = String(item?.source || "").trim().toLowerCase();
  const scheduleType = String(item?.scheduleType || "").trim().toLowerCase();

  if (source.includes("media")) return true;
  if (scheduleType.includes("media")) return true;

  if (item?.kind === "live" || item?.isLiveNow) return true;

  const hasMediaName = Boolean(String(item?.mediaName || "").trim());
  const mediaRelatedSource =
    source.includes("media") ||
    source.includes("media-schedule") ||
    scheduleType.includes("live") ||
    scheduleType.includes("media");

  if (hasMediaName && mediaRelatedSource) return true;

  if (Array.isArray(item?.scheduleSlots) && item.scheduleSlots.length > 0) {
    if (source.includes("media") || scheduleType.includes("media") || scheduleType.includes("live")) {
      return true;
    }
  }

  return false;
}

export function isChurchActivityPost(item: any) {
  if (!item || typeof item !== "object") return false;
  if (isMediaActivityPost(item)) return false;

  const ownership = String(item?.ownershipType || "").trim().toLowerCase();
  if (ownership === "media") return false;

  const source = String(item?.source || "").trim().toLowerCase();
  const kind = String(item?.kind || "").trim().toLowerCase();
  const type = String(item?.type || "").trim().toLowerCase();
  const textBag = bag(item);

  if (source === "testimony" || kind === "testimony" || type === "testimony") return true;
  if (source === "announcement" || kind === "announcement" || type === "announcement") return true;
  if (source === "prayer" || source.includes("prayer") || textBag.includes("prayer") || textBag.includes("maombi")) {
    return true;
  }
  if (source === "counsel" || kind === "counsel") return true;

  if (ownership === "church" || ownership === "member") return true;

  if (textBag.includes("testimony") || textBag.includes("ushuhuda")) return true;
  if (textBag.includes("announcement") || textBag.includes("tangazo")) return true;

  if (type === "post" || type === "announcement" || kind === "post" || kind === "announcement") {
    return true;
  }

  return false;
}

export function getChurchActivityLabel(item: any): ChurchActivityLabel {
  const source = String(item?.source || "").trim().toLowerCase();
  const kind = String(item?.kind || "").trim().toLowerCase();
  const type = String(item?.type || "").trim().toLowerCase();
  const textBag = bag(item);

  if (source === "testimony" || kind === "testimony" || type === "testimony" || textBag.includes("testimony") || textBag.includes("ushuhuda")) {
    return "TESTIMONY";
  }

  if (source === "announcement" || kind === "announcement" || type === "announcement" || textBag.includes("announcement") || textBag.includes("tangazo")) {
    return "ANNOUNCEMENT";
  }

  if (source === "prayer" || source.includes("prayer") || textBag.includes("prayer") || textBag.includes("maombi")) {
    return "PRAYER";
  }

  if (source === "counsel" || kind === "counsel") {
    return "COUNSEL";
  }

  return "POST";
}

export function churchActivityTitle(item: any) {
  return String(item?.title || item?.text || item?.body || "Church update").trim();
}

export function churchActivityBody(item: any) {
  const title = String(item?.title || "").trim();
  const body = String(item?.text || item?.body || "").trim();
  if (body && body !== title) return body;
  return String(item?.authorName || item?.actorLabel || item?.churchName || "Shared with your church.").trim();
}

export function churchActivityIcon(label: ChurchActivityLabel): string {
  switch (label) {
    case "TESTIMONY":
      return "sparkles-outline";
    case "ANNOUNCEMENT":
      return "megaphone-outline";
    case "PRAYER":
      return "heart-outline";
    case "COUNSEL":
      return "chatbubbles-outline";
    case "MEDIA":
      return "images-outline";
    default:
      return "newspaper-outline";
  }
}

export function sortActivityPostsNewestFirst<T extends { createdAt?: string }>(rows: T[]) {
  return [...rows].sort((a, b) => {
    const ta = new Date(String(a?.createdAt || "")).getTime();
    const tb = new Date(String(b?.createdAt || "")).getTime();
    return (Number.isFinite(tb) ? tb : 0) - (Number.isFinite(ta) ? ta : 0);
  });
}

export type ChurchActivityTab = "church" | "media";
export type ChurchActivityMemberFilter = "all" | "mine" | "member";
export type ChurchActivityFeedMode = "church" | "member" | "media";

export function getPostAuthorId(item: any) {
  return postAuthorUserId(item);
}

export function getPostChurchId(item: any) {
  return postChurchId(item);
}

export function isMediaPost(item: any) {
  return isMediaActivityPost(item);
}

export function postAuthorUserId(item: any) {
  return String(
    item?.actorUserId ||
      item?.authorId ||
      item?.userId ||
      item?.createdBy ||
      item?.memberId ||
      item?.postedByUserId ||
      ""
  ).trim();
}

export function postAuthorName(item: any) {
  return String(
    item?.authorName ||
      item?.actorLabel ||
      item?.postedByName ||
      item?.profileName ||
      item?.userName ||
      item?.mediaName ||
      "Church member"
  ).trim();
}

export function postChurchId(item: any) {
  const candidates = postChurchIdCandidates(item);
  return candidates[0] || "";
}

export function postChurchIdCandidates(item: any) {
  const ids = [
    item?.churchId,
    item?.sourceChurchId,
    item?.church?.id,
    item?.churchProfile?.id,
  ]
    .map((value) => String(value || "").trim())
    .filter(Boolean);

  return [...new Set(ids)];
}

export function postHasAlternateChurchIdentity(item: any) {
  return Boolean(
    String(item?.churchName || "").trim() ||
      String(item?.churchLabel || "").trim() ||
      String(item?.churchCode || "").trim()
  );
}

export function belongsToChurch(item: any, churchId: string) {
  const targetChurchId = String(churchId || "").trim();
  if (!targetChurchId) return false;

  const candidates = postChurchIdCandidates(item);
  if (candidates.length > 0) {
    return candidates.some((candidate) => candidate === targetChurchId);
  }

  if (postHasAlternateChurchIdentity(item)) {
    return false;
  }

  return false;
}

export function matchesActivityMemberFilter(
  item: any,
  memberFilter: ChurchActivityMemberFilter,
  selectedMemberId?: string,
  currentUserId?: string
) {
  if (memberFilter === "all") return true;

  const authorId = postAuthorUserId(item);
  if (!authorId) return false;

  if (memberFilter === "mine") {
    const viewerId = String(currentUserId || "").trim();
    return Boolean(viewerId) && authorId === viewerId;
  }

  if (memberFilter === "member") {
    const memberId = String(selectedMemberId || "").trim();
    return Boolean(memberId) && authorId === memberId;
  }

  return true;
}

export function isChurchTabActivityPost(item: any) {
  if (!item || typeof item !== "object") return false;
  if (isMediaActivityPost(item)) return false;
  if (isChurchActivityPost(item)) return true;

  const mediaType = String(item?.mediaType || "").trim().toLowerCase();
  if (mediaType === "image" || mediaType === "video") return true;

  const source = String(item?.source || "").trim().toLowerCase();
  if (
    source === "post" ||
    source === "announcement" ||
    source === "testimony" ||
    source === "prayer" ||
    source === "counsel"
  ) {
    return true;
  }

  return false;
}

export function formatActivityWhen(createdAt?: string | number) {
  const ms = new Date(String(createdAt || "")).getTime();
  if (!Number.isFinite(ms) || ms <= 0) return "";
  return new Date(ms).toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

export function mergeActivityPostsUnique(rows: any[]) {
  const seen = new Set<string>();
  const merged: any[] = [];

  for (const item of rows) {
    const id = String(item?.id || "").trim();
    if (!id || seen.has(id)) continue;
    seen.add(id);
    merged.push(item);
  }

  return merged;
}

export function getChurchActivityPosts({
  allPosts,
  selectedTab,
  memberFilter = "all",
  selectedMemberId,
  currentUserId,
  churchId,
  mediaUrlFn,
}: {
  allPosts: any[];
  selectedTab: ChurchActivityTab;
  memberFilter?: ChurchActivityMemberFilter;
  selectedMemberId?: string;
  currentUserId: string;
  churchId: string;
  mediaUrlFn?: (uri?: string) => string;
}) {
  let rows = mergeActivityPostsUnique(allPosts).filter((item) =>
    belongsToChurch(item, churchId)
  );

  if (selectedTab === "media") {
    rows = rows.filter(isMediaActivityPost);
  } else {
    rows = rows.filter(isChurchTabActivityPost);
  }

  rows = rows.filter((item) =>
    matchesActivityMemberFilter(item, memberFilter, selectedMemberId, currentUserId)
  );

  const result = sortActivityPostsNewestFirst(
    rows.map((item) => normalizeActivityItem(item, mediaUrlFn))
  );

  if (__DEV__) {
    console.log("CHURCH_ACTIVITY_FILTER_RESULT", {
      tab: selectedTab,
      filter: memberFilter,
      selectedMemberId: String(selectedMemberId || ""),
      churchId: String(churchId || ""),
      count: result.length,
    });
  }

  return result;
}

export function filterChurchActivityFeedRows(
  rows: any[],
  context: {
    activityChurchId: string;
    activityMemberId?: string;
    activityMode: ChurchActivityFeedMode;
  },
  mediaUrlFn?: (uri?: string) => string
) {
  const activityChurchId = String(context.activityChurchId || "").trim();
  const activityMemberId = String(context.activityMemberId || "").trim();
  const activityMode = context.activityMode || "church";
  const beforeCount = rows.length;

  if (!activityChurchId) return [];

  let filtered = mergeActivityPostsUnique(rows).filter((item) =>
    belongsToChurch(item, activityChurchId)
  );

  const afterChurchCount = filtered.length;
  filtered = filtered.filter((item) => !isChurchActivityExcludedCard(item));

  if (activityMode === "media") {
    filtered = filtered.filter(isChurchActivityMediaContentPost);
  } else {
    filtered = filtered.filter(isChurchActivityAllowedPost);
  }

  if (activityMemberId) {
    filtered = filtered.filter((item) => {
      const authorId = getPostAuthorId(item);
      return Boolean(authorId) && authorId === activityMemberId;
    });
  }

  const result = sortActivityPostsNewestFirst(
    filtered.map((item) => normalizeChurchActivityFeedItem(item, mediaUrlFn))
  );

  if (__DEV__) {
    console.log("KRISTO_CHURCH_ACTIVITY_FEED_FILTER", {
      activityChurchId,
      activityMemberId,
      activityMode,
      beforeCount,
      afterChurchCount,
      afterExcludeCount: filtered.length,
      afterCount: result.length,
    });
  }

  return result;
}

export function normalizeChurchActivityFeedItem(
  item: any,
  mediaUrlFn?: (uri?: string) => string
) {
  const normalized = normalizeActivityItem(item, mediaUrlFn);
  const isVideo = activityIsVideo(normalized);
  const imageUris = !isVideo ? resolveActivityPostImageUris(normalized, mediaUrlFn) : [];
  const imageUri = imageUris[0] || String(normalized.mediaUri || normalized.imageUrl || "").trim();
  const videoUri = String(normalized.videoUrl || "").trim();

  return {
    ...normalized,
    title: churchActivityTitle(normalized),
    body: churchActivityBody(normalized),
    mediaType: isVideo ? "video" : imageUri ? "image" : "none",
    mediaUri: isVideo ? videoUri || imageUri : imageUri,
    mediaUrls: imageUris.length ? imageUris : normalized.mediaUrls,
    images: imageUris.length ? imageUris : normalized.images,
    videoUrl: videoUri || undefined,
    authorName: postAuthorName(normalized),
  };
}

export function stampChurchFeedScope(item: any, fallbackChurchId: string) {
  const scopedChurchId = String(
    item?.churchId || item?.sourceChurchId || item?.church?.id || fallbackChurchId || ""
  ).trim();
  return {
    ...item,
    churchId: scopedChurchId,
    sourceChurchId: String(item?.sourceChurchId || scopedChurchId).trim(),
  };
}
