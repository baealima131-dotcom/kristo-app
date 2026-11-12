Warning: truncated output (original token count: 20835)
Total output lines: 2497

import { Platform } from "react-native";
import { feedRenderKey } from "./homeFeedRowKeys";
import {
  isFeedVideoItem,
  isOptimisticVideoUploadPost,
  isStandaloneAvatarFeedPost,
  isMediaScheduleFeedItem,
  resolveFeedItemAvatar,
} from "@/src/lib/homeFeedStore";
import { isHomeFeedReadyMediaItem } from "@/src/lib/mediaStatus";
import { avatarCacheBust, normalizeAvatarUpdatedAt } from "@/src/lib/avatarFreshness";
import {
  baseFeedId,
  parseSlotClockMs,
  parseSlotEndMs,
  parseSlotStartMs,
  resolveScheduleSlotVisualState,
} from "@/src/lib/scheduleSlotUtils";
import { isBrandedPosterUri, itemUsesBrandedVideoPoster } from "@/src/lib/brandedVideoPoster";
import { shouldRequestInferredPosterGuess } from "@/src/lib/posterGuessPolicy";
import { resolveCachedMediaPoster } from "@/src/lib/mediaPosterCache";
import { homeFeedAvatarUrlCacheKey } from "@/src/lib/homeFeedAvatarCache";
import { isKristoVerboseFeedDebug, isKristoVerboseFeedIdentityDebug, isKristoVerboseSlotTimeDebug } from "@/src/lib/kristoDebugFlags";
import { isChurchLiveControlScheduleFeedRow } from "@/src/lib/churchLiveControlSchedule";
import {
  logScheduleTopicTrace,
  resolveHomeFeedScheduleSlotLabels,
} from "@/src/lib/slotTopicUtils";
import {
  isHiddenInvalidHomeFeedSchedule,
  markHiddenInvalidHomeFeedSchedule,
} from "@/src/lib/homeFeedInvalidSchedules";
import {
  logHomeFeedScheduleExpired,
  logHomeFeedScheduleRemoved,
} from "@/src/lib/homeFeedScheduleLifecycle";
import { areAllScheduleSlotsExpired } from "@/src/lib/mediaScheduleSlotActive";
import {
  inferPosterUriFromVideoUrl,
  isInferredPosterUriForVideo,
  isLikelySyntheticPosterPath,
  isValidVideoPosterUri,
  resolveSavedFeedVideoPosterUri,
} from "@/src/lib/homeFeedPosterSavedUri";
import {
  homeFeedMediaUrl,
  resolveHomeFeedVideoUri,
  resolveStablePosterVideoUrl,
  resolveVideoUri,
} from "@/src/lib/homeFeedVideoUri";
import { resolveVideoDurationMs } from "@/src/lib/homeFeedVideoDuration";
import {
  logHomeFeedFirstRows,
  logHomeFeedPersonalOrder,
  logHomeFeedPersonalSeed,
  resetHomeFeedPersonalOrderIfNeeded,
  resolveHomeFeedPersonalOrderContext,
  sortRowsByPersonalSeed,
  arrangeHomeFeedVideoBlockFirst,
  homeFeedFreshnessSortMs,
  type HomeFeedPersonalOrderContext,
} from "@/src/lib/homeFeedPersonalOrder";
import { resolveMediaSlotTimeWindow } from "@/src/lib/mediaScheduleSlotTimes";
import { getSessionSync } from "@/src/lib/kristoSession";
import { peekProfileScreenCache } from "@/src/lib/screenDataCache";
import { tryRegisterStartupFirstVideoTarget } from "@/src/lib/homeFeedVideoPrime";
import { isHomeFeedInlineVideoAutoplayEnabled, type HomeFeedVideoOpenPayload } from "@/src/lib/homeFeedVideoMode";
import {
  getFrozenHomeFeedDisplayRows,
  isHomeFeedDisplayOrderFrozen,
} from "@/src/lib/homeFeedScrollStability";
import {
  peekHomeFeedDisplayOrderSync,
  saveHomeFeedDisplayOrderCache,
  isHomeFeedDisplayOrderCacheHydrateSettled,
} from "@/src/components/homeFeed/homeFeedDisplayOrderCache";
import { shouldRebuildHomeFeedDisplayOrder } from "@/src/lib/homeFeedRefreshReason";
import { resolveHomeFeedVideoDisplayType } from "@/src/lib/homeFeedVideoDisplayType";

export {
  homeFeedMediaUrl,
  resolveHomeFeedVideoUri,
  resolveStablePosterVideoUrl,
  resolveVideoUri,
} from "@/src/lib/homeFeedVideoUri";
export { resolveVideoDurationMs } from "@/src/lib/homeFeedVideoDuration";
export {
  inferPosterUriFromVideoUrl,
  isInferredPosterUriForVideo,
  isLikelySyntheticPosterPath,
  isValidVideoPosterUri,
  resolveSavedFeedVideoPosterUri,
} from "@/src/lib/homeFeedPosterSavedUri";

const CHURCH_ROOM_MEMBER_SOURCES = new Set(["testimony", "post", "announcement", "counsel"]);

export type HomeFeedPostAccent = "default" | "testimony" | "announcement";

export function isChurchRoomMemberFeedPost(item: any) {
  const source = String(item?.source || "").trim().toLowerCase();
  const kind = String(item?.kind || "").trim().toLowerCase();
  return CHURCH_ROOM_MEMBER_SOURCES.has(source) || CHURCH_ROOM_MEMBER_SOURCES.has(kind);
}

export function resolveFeedPostKind(item: any): "testimony" | "announcement" | "post" | "counsel" | null {
  const source = String(item?.source || item?.kind || "").trim().toLowerCase();
  const type = String(item?.type || "").trim().toLowerCase();
  if (source === "testimony" || type === "testimony") return "testimony";
  if (source === "announcement" || type === "announcement") return "announcement";
  if (source === "counsel" || type === "counsel") return "counsel";
  if (isChurchRoomMemberFeedPost(item)) return "post";
  return null;
}

export function resolveFeedPostAccent(item: any): HomeFeedPostAccent {
  const kind = resolveFeedPostKind(item);
  if (kind === "testimony") return "testimony";
  if (kind === "announcement") return "announcement";
  return "default";
}

export type HomeFeedPostKindFilter = "testimony" | "announcement";

export function filterHomeFeedRowsByPostKind(
  rows: any[],
  kind: HomeFeedPostKindFilter | null
): any[] {
  if (!kind || !Array.isArray(rows)) return rows;
  return rows.filter((row) => resolveFeedPostKind(row) === kind);
}

const HOME_FEED_NON_VIDEO_SOURCES = new Set([
  "testimony",
  "announcement",
  "counsel",
  "prayer",
  "prayer_request",
  "prayer-request",
]);

/** Resolved playable video URL for Home Feed media-only rows (any upload shape). */
export function resolvePlayableHomeFeedMediaUrl(item: any): string {
  if (!item) return "";
  const fromVideoUri = resolveVideoUri(item);
  if (fromVideoUri) return fromVideoUri;

  for (const key of ["mediaVideoUrl", "playbackUrl"]) {
    const resolved = homeFeedMediaUrl(item?.[key]);
    if (resolved) return resolved;
  }

  const media = item?.media;
  if (media && typeof media === "object") {
    const mediaType = String(media.type || media.mediaType || "").trim().toLowerCase();
    if (mediaType === "video") {
      for (const key of ["url", "uri", "videoUrl", "playbackUrl", "mediaUrl"]) {
        const resolved = homeFeedMediaUrl(media[key]);
        if (resolved) return resolved;
      }
    }
  }

  for (const attachments of [item?.attachments, item?.payload?.attachments]) {
    if (!Array.isArray(attachments)) continue;
    for (const entry of attachments) {
      if (!entry || typeof entry !== "object") continue;
      const attType = String(entry.type || entry.mediaType || "").trim().toLowerCase();
      if (attType !== "video") continue;
      for (const key of ["url", "uri", "videoUrl", "playbackUrl", "mediaUrl"]) {
        const resolved = homeFeedMediaUrl(entry[key]);
        if (resolved) return resolved;
      }
    }
  }

  return "";
}

/** YouTube Home Feed: playable media only — excludes testimony, announcement, prayer, text-only posts. */
export function isHomeFeedYoutubeVideoMediaRow(item: any): boolean {
  if (!item) return false;
  if (String(item?.source || "").trim().toLowerCase() === "system-admin-video-link") {
    try {
      const url = new URL(String(item?.videoUrl || item?.url || ""));
      return url.protocol === "https:" &&
        ["youtube.com", "www.youtube.com", "m.youtube.com", "music.youtube.com", "youtu.be", "tiktok.com", "www.tiktok.com", "m.tiktok.com"].includes(url.hostname.toLowerCase());
    } catch {
      return false;
    }
  }
  if (isExplicitHomeFeedMediaScheduleRow(item)) return true;
  if (isMediaLiveSlotsHomeFeedRow(item)) return true;

  const source = String(item?.source || item?.kind || "")
    .trim()
    .toLowerCase();
  const type = String(item?.type || "")
    .trim()
    .toLowerCase();
  if (HOME_FEED_NON_VIDEO_SOURCES.has(source) || HOME_FEED_NON_VIDEO_SOURCES.has(type)) {
    return false;
  }

  return Boolean(resolvePlayableHomeFeedMediaUrl(item));
}

export function filterHomeFeedYoutubeStreamRows(rows: any[]): any[] {
  if (!Array.isArray(rows)) return [];
  return rows.filter(isHomeFeedYoutubeVideoMediaRow);
}

/** Align with backend `normalizeHomeFeedSearchQuery` (trim / lower / collapse spaces). */
export function normalizeHomeFeedSearchQuery(input: unknown): string {
  if (input == null || typeof input !== "string") return "";
  return input.trim().toLowerCase().replace(/\s+/g, " ");
}

export function buildHomeFeedSearchHaystack(item: any): string {
  const ministryName = String(
    item?.ministryName ||
      item?.ministry?.name ||
      item?.roomName ||
      item?.ministryTitle ||
      item?.ministryLabel ||
      ""
  ).trim();
  const parts = [
    resolvePostTitle(item),
    resolvePostBody(item),
    resolveChurchName(item),
    resolveMediaName(item),
    resolveFeedIdentityHeadline(item),
    resolveFeedPostTypeTitle(item),
    String(item?.authorName || item?.author?.name || ""),
    ministryName,
  ];
  return parts
    .map((part) => normalizeHomeFeedSearchQuery(part))
    .filter(Boolean)
    .join(" ");
}

export function filterHomeFeedRowsBySearchQuery(rows: any[], query: string): any[] {
  const needle = normalizeHomeFeedSearchQuery(query);
  if (!needle) return [];
  if (!Array.isArray(rows)) return [];
  return rows.filter((row) => buildHomeFeedSearchHaystack(row).includes(needle));
}

function looksLikeFeedAuthorId(value: unknown) {
  const v = String(value || "").trim();
  if (!v) return true;
  if (v === "Member" || v === "u-unknown") return true;
  if (/^u[-_]?/i.test(v)) return true;
  if (/^[a-f0-9-]{18,}$/i.test(v)) return true;
  if (v.length >= 20 && !v.includes(" ")) return true;
  return false;
}

function profileNameFromCache(userId: string) {
  const uid = String(userId || "").trim();
  if (!uid) return "";

  const cached = peekProfileScreenCache(uid);
  const profile = cached?.profile;
  if (!profile || typeof profile !== "object") return "";

  const candidates = [
    profile.fullName,
    profile.displayName,
    profile.name,
    profile.username,
  ]
    .map((value) => String(value || "").trim())
    .filter(Boolean);

  for (const candidate of candidates) {
    if (!looksLikeFeedAuthorId(candidate)) return candidate;
  }

  return "";
}

function resolveChurchRoomMemberAuthorName(item: any) {
  const createdBy = String(item?.createdBy || item?.authorUserId || "").trim();
  const candidates = [
    item?.authorName,
    item?.actorLabel,
    item?.postedByName,
    item?.displayName,
    item?.profileName,
    item?.fullName,
    item?.name,
  ]
    .map((value) => String(value || "").trim())
    .filter(Boolean);

  for (const candidate of candidates) {
    if (!looksLikeFeedAuthorId(candidate) && candidate !== createdBy) {
      return candidate;
    }
  }

  const cachedName = profileNameFromCache(createdBy);
  if (cachedName) return cachedName;

  const session = getSessionSync() as any;
  if (createdBy && createdBy === String(session?.userId || "").trim()) {
    const selfName = String(
      session?.displayName || session?.name || session?.fullName || ""
    ).trim();
    if (selfName && !looksLikeFeedAuthorId(selfName)) return selfName;
  }

  return "Member";
}

export function resolveFeedPostTypeTitle(item: any) {
  const kind = resolveFeedPostKind(item);
  if (kind === "testimony") return "TESTIMONY";
  if (kind === "announcement") return "ANNOUNCEMENT";
  if (kind === "counsel") return "COUNSEL";
  if (kind === "post") return "POST";
  return "";
}

// Image URL keys a feed post may carry. Mirrors the backend's
// FEED_POST_IMAGE_FIELD_KEYS so announcement/testimony (and locally-merged /
// optimistic) image posts render regardless of which key holds the image URL,
// instead of falling back to the dark text card.
const POST_IMAGE_URI_KEYS = [
  "mediaUri",
  "imageUrl",
  "imageUri",
  "mediaUrl",
  "attachmentUrl",
  "photoUri",
  "photoUrl",
  "uploadedMediaUri",
  "coverImage",
  "coverImageUrl",
  "image",
  "photo",
  "url",
] as const;

function pushPostImageCandidate(values: string[], raw: unknown) {
  const v = String(raw || "").trim();
  if (v) values.push(v);
}

function collectAttachmentImageUris(attachments: unknown, values: string[]) {
  if (!Array.isArray(attachments)) return;
  for (const entry of attachments) {
    if (typeof entry === "string") {
      pushPostImageCandidate(values, entry);
      continue;
    }
    if (!entry || typeof entry !== "object") continue;
    const att = entry as Record<string, unknown>;
    pushPostImageCandidate(values, att.url);
    pushPostImageCandidate(values, att.uri);
    pushPostImageCandidate(values, att.imageUrl);
    pushPostImageCandidate(values, att.mediaUrl);
    pushPostImageCandidate(values, att.publicUrl);
  }
}

function collectPostImageUriValues(row: any): string[] {
  const values: string[] = [];
  const roots = [row, row?.payload].filter((entry) => entry && typeof entry === "object");

  for (const root of roots) {
    for (const key of POST_IMAGE_URI_KEYS) {
      pushPostImageCandidate(values, root?.[key]);
    }
    if (Array.isArray(root?.images)) {
      for (const v of root.images) {
        pushPostImageCandidate(values, v);
      }
    }
    if (Array.isArray(root?.mediaUrls)) {
      for (const v of root.mediaUrls) {
        pushPostImageCandidate(values, v);
      }
    }
    collectAttachmentImageUris(root?.attachments, values);
  }

  return [...new Set(values)];
}

function isFeedPostImageUri(uri: unknown) {
  const value = String(uri || "").trim();
  if (!value) return false;
  if (/\.(mp4|mov|m4v|webm|mkv)(\?|#|$)/i.test(value)) return false;
  if (value.startsWith("data:image/")) return true;
  if (/^https?:\/\//i.test(value)) return true;
  if (value.includes("/uploads/media/")) return true;
  if (value.includes("/church-feed-images/")) return true;
  if (value.startsWith("/uploads/") && !/\/profile-avatars\//i.test(value)) return true;
  return false;
}

export function normalizeHomeFeedApiRow(row: any) {
  if (!row || typeof row !== "object") return row;

  const avatarUriCandidates = [
    row?.authorAvatarUri,
    row?.actorAvatarUri,
    row?.profileAvatarUri,
    row?.authorAvatar,
    row?.churchAvatarUri,
    row?.churchAvatarUrl,
    row?.avatarUri,
    row?.avatarUrl,
    row?.profileImage,
    row?.photoURL,
  ]
    .map((value) => String(value || "").trim())
    .filter(Boolean);

  const imageCandidates = collectPostImageUriValues(row).filter(
    (candidate) => !postImageUriMatchesAvatarCandidates(candidate, avatarUriCandidates)
  );

  let mediaUri = imageCandidates[0] || "";
  if (!mediaUri) {
    const rawPostMediaUri = collectPostImageUriValues(row).find(
      (candidate) =>
        candidate.includes("/uploads/media/") ||
        (/^https?:\/\//i.test(candidate) && !candidate.includes("/profile-avatars/"))
    );
    if (rawPostMediaUri) mediaUri = rawPostMediaUri;
  }
  const videoUrl = String(row?.videoUrl || "").trim();
  const next: any = {
    ...row,
    ...(Array.isArray(row?.images) ? { images: row.images } : {}),
    ...(Array.isArray(row?.mediaUrls) ? { mediaUrls: row.mediaUrls } : {}),
  };

  if (mediaUri) {
    next.mediaUri = mediaUri;
    if (!String(next?.imageUrl || "").trim()) next.imageUrl = mediaUri;
  }

  const mediaType = String(next?.mediaType || "").trim().toLowerCase();
  if (mediaUri && !videoUrl && mediaType !== "video" && !isFeedVideoItem(next)) {
    if (!mediaType || mediaType === "none") next.mediaType = "image";
  }

  if (isChurchRoomMemberFeedPost(next)) {
    if (!String(next?.type || "").trim()) next.type = "post";
    if (!String(next?.source || "").trim()) {
      next.source = String(next?.kind || "post").trim().toLowerCase() || "post";
    }
    if (mediaUri && !videoUrl && String(next?.mediaType || "").trim().toLowerCase() !== "video") {
      next.mediaType = "image";
    }
  }

  if (!String(next?.body || "").trim() && String(next?.text || "").trim()) {
    next.body = String(next.text).trim();
  }

  const authorName = String(
    next?.authorName || next?.actorLabel || next?.postedByName || next?.displayName || ""
  ).trim();
  const resolvedAuthorName = [
    next?.authorName,
    next?.actorLabel,
    next?.postedByName,
    next?.displayName,
  ]
    .map((value) => String(value || "").trim())
    .find((value) => value && !looksLikeFeedAuthorId(value));

  if (resolvedAuthorName) {
    next.authorName = resolvedAuthorName;
    next.actorLabel = resolvedAuthorName;
    next.postedByName = resolvedAuthorName;
    next.displayName = resolvedAuthorName;
  } else if (authorName && !looksLikeFeedAuthorId(authorName) && !String(next?.authorName || "").trim()) {
    next.authorName = authorName;
  }

  const authorAvatar = String(
    next?.authorAvatarUri ||
      next?.actorAvatarUri ||
      next?.profileAvatarUri ||
      next?.authorAvatar ||
      next?.avatarUri ||
      next?.avatarUrl ||
      next?.profileImage ||
      next?.photoURL ||
      ""
  ).trim();
  if (authorAvatar) {
    if (!String(next?.authorAvatarUri || "").trim()) next.authorAvatarUri = authorAvatar;
    if (!String(next?.actorAvatarUri || "").trim()) next.actorAvatarUri = authorAvatar;
    if (!String(next?.profileAvatarUri || "").trim()) next.profileAvatarUri = authorAvatar;
  }

  const posterRaw = String(
    next?.posterUri ||
      next?.videoPosterUri ||
      next?.thumbnailUri ||
      next?.thumbnailUrl ||
      next?.posterUrl ||
      next?.coverUrl ||
      next?.firstFrameUrl ||
      next?.mediaPosterUri ||
      next?.previewUrl ||
      ""
  ).trim();
  if (posterRaw) {
    if (!String(next?.posterUri || "").trim()) next.posterUri = posterRaw;
    if (!String(next?.videoPosterUri || "").trim()) next.videoPosterUri = posterRaw;
    if (!String(next?.thumbnailUri || "").trim()) next.thumbnailUri = posterRaw;
  }

  return next;
}

export function resolveFeedIdentityHeadline(item: any) {
  if (isChurchRoomMemberFeedPost(item)) {
    return resolveChurchRoomMemberAuthorName(item);
  }
  return resolveChurchName(item);
}

export function resolveFeedIdentitySubline(item: any, whenLabel: string) {
  if (isChurchRoomMemberFeedPost(item)) {
    return whenLabel;
  }

  const mediaName = resolveMediaName(item);
  return [mediaName, whenLabel].filter(Boolean).join(" • ");
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
  if (isChurchRoomMemberFeedPost(item)) return false;

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
    item?.actorAvatarUri,
    item?.profileAvatarUri,
    item?.authorAvatar,
    item?.avatarUri,
    item?.avatarUrl,
    item?.profileImage,
    item?.photoURL,
  ];

  if (churchMediaFirst) {
    if (isChurchRoomMemberFeedPost(item)) {
      const authorHasAvatar = authorSources.some((raw) => String(raw || "").trim());
      if (authorHasAvatar) {
        return [...authorSources, ...churchSources, ...mediaSources];
      }
    }
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

/** Active church media schedule row (media-live-slots) for Home Feed / Guest Claim / Live ring.
 *  Visible cross-church; claim eligibility uses the viewer's own church subscription. */
export function isMediaLiveSlotsHomeFeedRow(item: any): boolean {
  if (!item || isStandaloneAvatarFeedPost(item)) return false;
  if (isChurchLiveControlScheduleFeedRow(item)) return false;
  if (!isMediaScheduleFeedItem(item)) return false;

  const scheduleType = String(item?.scheduleType || "").toLowerCase();
  const source = String(item?.source || "").toLowerCase();
  const id = String(item?.id || "").toLowerCase();
  if (id.includes("__slot_") && !isHomeFeedExpandedScheduleSlotRow(item)) return false;
  if (id.startsWith("church-live-now-") || id.startsWith("media-live-now-")) return false;

  if (
    (item?.isLiveNow || item?.kind === "live") &&
    !scheduleType.includes("media-live-slots") &&
    !source.includes("media-schedule")
  ) {
    return false;
  }

  return true;
}

export function resolveHomeFeedActiveScheduleSlot(item: any, nowMs = Date.now()) {
  const slots = Array.isArray(item?.scheduleSlots) ? item.scheduleSlots : [];
  const active =
    slots.find((slot: any) => {
      const startMs = parseSlotStartMs(slot);
      if (!startMs || startMs <= 0) return false;

      const endMs = parseSlotEndMs(slot, startMs);
      return endMs > nowMs;
    }) || null;

  return active || slots[0] || null;
}

/** Schedule cards render outside the video autoplay pipeline. */
export function isHomeFeedScheduleCardRow(item: any, _nowMs = Date.now()): boolean {
  return isExplicitHomeFeedMediaScheduleRow(item) || isMediaLiveSlotsHomeFeedRow(item);
}

/** Phase-1 Home Feed rows: posts with media or text; media-live-slots schedule cards allowed. */
export function isPhase1HomeFeedPost(item: any): boolean {
  if (!item || isStandaloneAvatarFeedPost(item)) return false;
  if (isExplicitHomeFeedMediaScheduleRow(item)) return true;
  if (isMediaLiveSlotsHomeFeedRow(item)) return true;

  const scheduleType = String(item?.scheduleType || "").toLowerCase();
  if (scheduleType.includes("media-live-slots")) return true;

  if (isMediaScheduleFeedItem(item)) return false;

  const slots = Array.isArray(item?.scheduleSlots) ? item.scheduleSlots : [];
  if (slots.length > 0) return false;
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

function isLegacyScheduleFeedRow(item: any) {
  if (!item) return false;
  const slots = Array.isArray(item?.scheduleSlots) ? item.scheduleSlots : [];
  if (!slots.length && !isMediaScheduleFeedItem(item)) return false;
  return !isMediaLiveSlotsHomeFeedRow(item);
}

/** Church media schedule rows — bypass video upload / mediaStatus gates in Phase 1. */
export function isExplicitHomeFeedMediaScheduleRow(item: any): boolean {
  if (!item || isStandaloneAvatarFeedPost(item)) return false;
  if (isChurchLiveControlScheduleFeedRow(item)) return false;

  const scheduleType = String(item?.scheduleType || "").toLowerCase();
  const source = String(item?.source || "").toLowerCase();
  if (!scheduleType.includes("media-live-slots") || !source.includes("media-schedule")) {
    return false;
  }

  const id = String(item?.id || "").toLowerCase();
  if (id.includes("__slot_") && !isHomeFeedExpandedScheduleSlotRow(item)) return false;
  if (id.startsWith("church-live-now-") || id.startsWith("media-live-now-")) return false;

  return true;
}

export function filterPhase1FeedRows(rows: any[]) {
  const scheduleCandidates = rows.filter(
    (row) =>
      isExplicitHomeFeedMediaScheduleRow(row) ||
      isMediaLiveSlotsHomeFeedRow(row) ||
      isLegacyScheduleFeedRow(row)
  );
  const filtered = rows.filter((row) => {
    if (isExplicitHomeFeedMediaScheduleRow(row)) return true;
    if (isMediaLiveSlotsHomeFeedRow(row)) return true;
    if (!isHomeFeedReadyMediaItem(row)) return false;
    return isPhase1HomeFeedPost(row);
  });

  for (const row of scheduleCandidates) {
    const id = String(row?.id || "");
    if (filtered.some((item) => String(item?.id || "") === id)) continue;

    const reason = isLegacyScheduleFeedRow(row)
      ? "legacy_schedule_not_media_live_slots"
      : isExplicitHomeFeedMediaScheduleRow(row)
        ? "explicit_schedule_meta_but_not_in_filtered"
        : "phase1_home_feed_policy";

    console.log("KRISTO_SCHEDULE_FILTERED_OUT", {
      id,
      source: String(row?.source || ""),
      scheduleType: String(row?.scheduleType || ""),
      churchId: String(row?.churchId || ""),
      slotCount: Array.isArray(row?.scheduleSlots) ? row.scheduleSlots.length : 0,
      ownershipType: String(row?.ownershipType || ""),
      mediaStatus: String(row?.mediaStatus || row?.status || ""),
      reason,
      gate: "filterPhase1FeedRows",
    });
  }

  if (isKristoVerboseFeedDebug()) {
    const visibleSchedule = filtered.filter(
      (row) => isExplicitHomeFeedMediaScheduleRow(row) || isMediaLiveSlotsHomeFeedRow(row)
    );
    console.log("KRISTO_HOME_FEED_SCHEDULE_ROWS_VISIBLE", {
      visibleCount: visibleSchedule.length,
      feedCount: filtered.length,
      scheduleCandidateCount: scheduleCandidates.length,
      explicitScheduleCount: filtered.filter(isExplicitHomeFeedMediaScheduleRow).length,
      visibleScheduleIds: visibleSchedule.map((row) => String(row?.id || "")),
    });
  }

  return filtered;
}

/** Likes/comments API id — parent schedule for expanded slot cards. */
export function homeFeedScheduleEngagementId(item: any) {
  const parent = String(item?.parentScheduleId || item?.sourceScheduleId || "").trim();
  if (parent) return baseFeedId(parent);
  return baseFeedId(String(item?.id || item?.feedOriginId || ""));
}

/** Comment drawer / discussion API id — mirrors likes (parent schedule, not :slot:N row id). */
export function homeFeedCommentPostId(item: any) {
  return homeFeedScheduleEngagementId(item);
}

/** FlatList row key — unique per expanded slot card. */
export { feedRenderKey } from "./homeFeedRowKeys";

function resolveHomeFeedSlotNumber(slot: any, fallback: number) {
  const n = Number(slot?.slot || slot?.slotNumber || slot?.order || 0);
  return n > 0 ? n : fallback;
}

export function resolveHomeFeedSlotCardStatus(slot: any): "available" | "claimed" | "taken" {
  if (!slot) return "available";

  const slotStatus = String(slot?.status || "").toLowerCase().trim();
  if (slotStatus === "taken" || slotStatus === "closed") return "taken";
  if (slotStatus === "claimed") return "claimed";

  const claimedByObj =
    typeof slot?.claimedBy === "object" && slot?.claimedBy ? slot.claimedBy : null;
  const claimedByName = String(
    slot?.claimedByName || claimedByObj?.name || slot?.claimedBy || ""
  )
    .trim()
    .toLowerCase();

  const claimedByUserId = String(slot?.claimedByUserId || claimedByObj?.userId || "").trim();
  const isClaimed = Boolean(
    claimedByUserId ||
    slot?.claimed === true ||
    slot?.isClaimed === true ||
    (claimedByName && claimedByName !== "open")
  );

  if (!isClaimed) return "available";
  if (slotStatus === "live" || slot?.isLive === true) return "taken";
  return "claimed";
}

export function isHomeFeedExpandedScheduleSlotRow(item: any): boolean {
  return item?.homeFeedSlotExpanded === true || /:slot:\d+/i.test(String(item?.id || ""));
}

export function shouldExpandHomeFeedScheduleRow(row: any): boolean {
  if (!row || isHomeFeedExpandedScheduleSlotRow(row)) return false;
  return String(row?.scheduleType || "").toLowerCase().includes("media-live-slots");
}

function resolveHomeFeedSlotFeedIndex(slot: any, fallbackIndex: number) {
  const slotNumber = resolveHomeFeedSlotNumber(slot, fallbackIndex + 1);
  return Math.max(0, slotNumber - 1);
}

function logHomeFeedSlotExpiryDebug(
  scheduleId: string,
  slot: any,
  slotNumber: number,
  visual: NonNullable<ReturnType<typeof resolveScheduleSlotVisualState>>
) {
  if (!isKristoVerboseSlotTimeDebug()) return;
  console.log("KRISTO_HOME_SLOT_EXPIRY_DEBUG", {
    scheduleId,
    slotId: String(slot?.id || `${scheduleId}:slot:${slotNumber}`),
    slotNumber,
    startMs: visual.startMs,
    endMs: visual.endMs,
    phase: visual.phase,
    expired: visual.expired,
    rawStart: String(slot?.startTime || slot?.time || ""),
    rawEnd: String(slot?.endTime || ""),
    date: String(slot?.meetingDate || slot?.meetingDay || ""),
    startTime: String(slot?.startTime || slot?.time || ""),
    endTime: String(slot?.endTime || ""),
    durationMinutes: Number(slot?.durationMin || 0) || null,
  });
}

export function isHomeFeedMediaScheduleSourceRow(item: any) {
  return isExplicitHomeFeedMediaScheduleRow(item) || isMediaLiveSlotsHomeFeedRow(item);
}

export function homeFeedSlotHasValidTimeWindow(slot: any) {
  if (!slot) return false;
  const { startMs, endMs } = resolveMediaSlotTimeWindow(slot);
  return startMs > 0 && endMs > startMs;
}

/** Schedule rows need durable slot windows before Home Feed renders them. */
export function scheduleRowHasValidSlotTimes(row: any) {
  if (!isHomeFeedMediaScheduleSourceRow(row)) return true;
  const slots = Array.isArray(row?.scheduleSlots) ? row.scheduleSlots : [];
  if (!slots.length) return false;
  return slots.every((slot: any) => homeFeedSlotHasValidTimeWindow(slot));
}

function resolveHomeFeedScheduleSlotSortKey(row: any) {
  const slot = Array.isArray(row?.scheduleSlots) ? row.scheduleSlots[0] : null;
  const slotNumber = Math.max(1, Number(row?.slotNumber || slot?.slot || slot?.slotNumber || 0));
  const { startMs } = resolveMediaSlotTimeWindow(slot);
  return { slotNumber, startMs: startMs > 0 ? startMs : Number.MAX_SAFE_INTEGER };
}

export function sortHomeFeedScheduleSlotRows(rows: any[]) {
  return [...rows].sort((a, b) => {
    const aKey = resolveHomeFeedScheduleSlotSortKey(a);
    const bKey = resolveHomeFeedScheduleSlotSortKey(b);
    if (aKey.slotNumber !== bKey.slotNumber) return aKey.slotNumber - bKey.slotNumber;
    return aKey.startMs - bKey.startMs;
  });
}

/** One Home Feed card per active/upcoming media-live-slots slot (expired slots omitted). */
export function expandHomeFeedScheduleIntoSlotRows(scheduleRow: any, nowMs = Date.now()): any[] {
  if (shouldExpandHomeFeedScheduleRow(scheduleRow) && !scheduleRowHasValidSlotTimes(scheduleRow)) {
    if (isKristoVerboseSlotTimeDebug()) {
      console.log("KRISTO_HOME_FEED_SCHEDULE_DEFERRED_INVALID_TIME", {
        scheduleId: String(scheduleRow?.id || ""),
        slotCount: Array.isArray(scheduleRow?.scheduleSlots) ? scheduleRow.scheduleSlots.length : 0,
      });
    }
    return [];
  }

  if (!shouldExpandHomeFeedScheduleRow(scheduleRow)) {
    if (isHomeFeedExpandedScheduleSlotRow(scheduleRow)) {
      const slot = Array.isArray(scheduleRow?.scheduleSlots)
        ? scheduleRow.scheduleSlots[0]
        : null;
      const slotFeedIndex = resolveHomeFeedSlotFeedIndex(
        slot,
        Math.max(0, Number(scheduleRow?.slotNumber || 1) - 1)
      );
      const visual =
        slot &&
        resolveScheduleSlotVisualState(slot, slotFeedIndex, nowMs, {
          sl…4835 tokens truncated… localRows: any[],
  nowMs: number
) {
  const freshById = new Map<string, any>();
  for (const row of [...backendRows, ...localRows]) {
    if (!row) continue;
    const id = feedRenderKey(row) || String(row?.id || "").trim();
    if (!id) continue;
    const prev = freshById.get(id);
    freshById.set(id, prev ? pickRicherHomeFeedRow(prev, row) : row);
  }

  const merged = cachedDisplay
    .map((row) => {
      const id = feedRenderKey(row) || String(row?.id || "").trim();
      if (!id) return row;
      const fresh = freshById.get(id);
      return fresh ? pickRicherHomeFeedRow(row, fresh) : row;
    })
    .filter((row) => {
      const id = feedRenderKey(row) || String(row?.id || "").trim();
      return Boolean(id && (freshById.has(id) || String(row?.localOnly || "").trim() === "1"));
    });

  return merged.length ? merged : cachedDisplay;
}

/** Merged Home Feed list: video/posts first, then active schedule slot cards. */
export function buildHomeFeedDisplayRows(
  backendRows: any[],
  localRows: any[],
  nowMs = Date.now(),
  opts?: { rebuildPersonalOrder?: boolean; rebuildReason?: string; force?: boolean }
) {
  if (isHomeFeedDisplayOrderFrozen()) {
    return getFrozenHomeFeedDisplayRows();
  }

  const rebuildPersonalOrder =
    opts?.rebuildPersonalOrder === true ||
    shouldRebuildHomeFeedDisplayOrder(String(opts?.rebuildReason || ""), opts?.force);

  const cachedDisplay = peekHomeFeedDisplayOrderSync();
  if (!rebuildPersonalOrder && cachedDisplay.length) {
    const sanitizedBackendRows = filterRenderableHomeFeedScheduleRows(backendRows, "backend");
    const sanitizedLocalRows = filterRenderableHomeFeedScheduleRows(localRows, "local");
    return mergeCachedHomeFeedDisplayOrderInternal(
      cachedDisplay,
      sanitizedBackendRows,
      sanitizedLocalRows,
      nowMs
    );
  }

  if (!isHomeFeedDisplayOrderCacheHydrateSettled()) {
    if (cachedDisplay.length) {
      const sanitizedBackendRows = filterRenderableHomeFeedScheduleRows(backendRows, "backend");
      const sanitizedLocalRows = filterRenderableHomeFeedScheduleRows(localRows, "local");
      return mergeCachedHomeFeedDisplayOrderInternal(
        cachedDisplay,
        sanitizedBackendRows,
        sanitizedLocalRows,
        nowMs
      );
    }
    return [];
  }

  if (!rebuildPersonalOrder && !cachedDisplay.length) {
    return [];
  }

  const sanitizedBackendRows = filterRenderableHomeFeedScheduleRows(backendRows, "backend");
  const sanitizedLocalRows = filterRenderableHomeFeedScheduleRows(localRows, "local");
  const personalCtx = resolveHomeFeedPersonalOrderContext(nowMs);
  resetHomeFeedPersonalOrderIfNeeded(personalCtx.seedKey);
  logHomeFeedPersonalSeed(personalCtx);

  const viewerChurchId = String((getSessionSync() as any)?.churchId || "").trim();
  const canSeeMediaSlots = resolveHomeFeedCanSeeMediaSlots(viewerChurchId);

  const digest = `${canSeeMediaSlots ? 1 : 0}::${homeFeedBuildDigest(
    sanitizedBackendRows,
    sanitizedLocalRows,
    nowMs,
    personalCtx.seedKey
  )}`;
  if (digest === lastHomeFeedBuildDigest && lastHomeFeedBuildResult.length) {
    return lastHomeFeedBuildResult;
  }

  const byId = new Map<string, any>();

  for (const row of [...sanitizedBackendRows, ...sanitizedLocalRows]) {
    if (!row) continue;
    const id = String(row?.id || "").trim();
    if (!id) continue;
    const prev = byId.get(id);
    byId.set(id, prev ? pickRicherHomeFeedRow(prev, row) : row);
  }

  const filtered = filterPhase1FeedRows(Array.from(byId.values()));

  // Stable schedule rows power More > Live Slots — never mixed into Home Feed display.
  if (canSeeMediaSlots) {
    const scheduleRows = filtered.filter(
      (row) => isExplicitHomeFeedMediaScheduleRow(row) || isMediaLiveSlotsHomeFeedRow(row)
    );
    const expandedScheduleRows = scheduleRows.flatMap((row) =>
      expandHomeFeedScheduleIntoSlotRows(row, nowMs)
    );
    const orderedScheduleRows = filterSameChurchHomeFeedScheduleRows(
      sortHomeFeedScheduleSlotRows(expandedScheduleRows),
      viewerChurchId
    );
    lastStableHomeFeedDisplayRows = orderedScheduleRows.filter((row) =>
      isHomeFeedScheduleSlotRowVisible(row, nowMs)
    );
  } else {
    lastStableHomeFeedDisplayRows = [];
  }

  const contentRows = filtered.filter(
    (row) =>
      !isExplicitHomeFeedMediaScheduleRow(row) &&
      !isMediaLiveSlotsHomeFeedRow(row) &&
      !isLegacyScheduleFeedRow(row) &&
      !isHomeFeedExpandedScheduleSlotRow(row) &&
      !isHomeFeedLivestreamRow(row)
  );
  const sortedContentRows = [...contentRows].sort(
    (a, b) => homeFeedPostSortMs(b) - homeFeedPostSortMs(a)
  );
  const personalizedPosts = interleaveHomeFeedPostRows(
    sortedContentRows,
    viewerChurchId,
    personalCtx,
    nowMs
  );
  let display = personalizedPosts.filter(
    (row) =>
      !isHomeFeedMediaScheduleSlotDisplayRow(row) && !isHomeFeedLivestreamRow(row)
  );

  const scheduleSlotCount = 0;

  logHomeFeedPersonalOrder(display, personalCtx, feedRenderKey);
  logHomeFeedFirstRows(display, feedRenderKey);

  const firstVideoRow = display.find((row) => isVideoPost(row));
  if (firstVideoRow && isHomeFeedInlineVideoAutoplayEnabled()) {
    const rowId = feedRenderKey(firstVideoRow) || String(firstVideoRow?.id || "").trim();
    const original = resolveVideoUri(firstVideoRow);
    const url = homeFeedMediaUrl(original) || original;
    if (rowId && url) tryRegisterStartupFirstVideoTarget(rowId, url);
  }

  if (canSeeMediaSlots) {
    display = display.filter((row) => !isHomeFeedMediaScheduleSlotDisplayRow(row));
  } else {
    display = display.filter((row) => !isHomeFeedMediaScheduleSlotDisplayRow(row));
  }

  lastHomeFeedBuildDigest = digest;
  lastHomeFeedBuildResult = display;

  if (display.length) {
    void saveHomeFeedDisplayOrderCache(display);
  }

  if (isKristoVerboseFeedDebug()) {
    const videoCount = display.filter((row) => isVideoPost(row)).length;
    console.log("KRISTO_HOME_FEED_ORDER_DEBUG", {
      videoCount,
      scheduleSlotCount,
      firstIds: display.slice(0, 8).map((row) => String(row?.id || "")),
      scheduleOrder: lastStableHomeFeedDisplayRows
        .slice(0, 12)
        .map((row) => Number(row?.slotNumber || 0) || null),
    });

    console.log("KRISTO_HOME_FEED_VISIBLE_DATA", {
      backendCount: backendRows.length,
      localCount: localRows.length,
      sanitizedLocalCount: sanitizedLocalRows.length,
      mergedCount: byId.size,
      filteredCount: filtered.length,
      scheduleSourceCount: lastStableHomeFeedDisplayRows.length,
      scheduleCount: lastStableHomeFeedDisplayRows.length,
      displayCount: display.length,
      videoCount,
      scheduleSlotCount,
      scheduleIds: lastStableHomeFeedDisplayRows.map((row) => String(row?.id || "")),
      scheduleSlotCounts: lastStableHomeFeedDisplayRows.map((row) =>
        homeFeedScheduleSlotCount(row)
      ),
      expandedScheduleIds: lastStableHomeFeedDisplayRows.map((row) => String(row?.id || "")),
    });
  }

  return display;
}

export function mergeFeedRowsDeterministic(backendRows: any[], localRows: any[]) {
  return buildHomeFeedDisplayRows(backendRows, localRows);
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

export function resolveFeedViewCount(item: any): number {
  const n = Number(
    item?.viewCount ?? item?.views ?? item?.stats?.views ?? item?.playCount ?? 0
  );
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : 0;
}

export function formatFeedViewLabel(item: any): string {
  const count = resolveFeedViewCount(item);
  if (count <= 0) return "";
  return `${formatActionCount(count)} views`;
}

export function formatFeedMetaLine(item: any, whenLabel: string): string {
  const views = formatFeedViewLabel(item);
  return [whenLabel, views].filter(Boolean).join(" • ");
}

export function resolveFeedChurchVerified(item: any): boolean {
  if (item?.churchVerified === true || item?.church?.verified === true) return true;
  if (item?.verified === true) return true;

  const ownership = String(item?.ownershipType || "").trim().toLowerCase();
  if (ownership === "church" || ownership === "media") return true;

  const source = String(item?.source || "").toLowerCase();
  return source.includes("media") || source === "media-upload";
}

export function formatFeedTimestamp(createdAt?: string) {
  const ms = Date.parse(String(createdAt || ""));
  if (!Number.isFinite(ms)) return "";

  const then = new Date(ms);
  const now = new Date();
  const sameCalendarDay = (a: Date, b: Date) =>
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate();

  if (sameCalendarDay(then, now)) return "Today";

  const yesterday = new Date(now);
  yesterday.setDate(yesterday.getDate() - 1);
  if (sameCalendarDay(then, yesterday)) return "Yesterday";

  const diff = Date.now() - ms;
  const days = Math.floor(diff / 86_400_000);
  if (days < 7) return `${days}d ago`;

  return then.toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

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

/** Video posts use title only — never fall back to caption/body text. */
export function resolveHomeFeedVideoTitle(item: any): string {
  const title = resolvePostTitle(item);
  if (title) return title;
  if (isVideoPost(item)) return "";
  return resolvePostBody(item);
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

export function resolveChurchRoomFeedCaption(item: any) {
  return resolvePostCaption(item);
}

function pickHomeFeedAvatarUri(raw: unknown, cacheBustAt?: number) {
  const trimmed = String(raw || "").trim();
  if (!trimmed) return "";
  const base = commentAvatarUrl(trimmed);
  if (!base) return "";
  if (base.startsWith("file://") || base.startsWith("data:image/")) return base;
  const bust = Number(cacheBustAt || 0);
  return bust > 0 ? avatarCacheBust(base, bust) : base;
}

/** Church/media posts: church logo first; Church Room posts always use church avatar. */
export function resolveHomeFeedDisplayAvatar(item: any): HomeFeedDisplayAvatar {
  const churchRoomPost = isChurchRoomMemberFeedPost(item);
  const initial = String(resolveChurchName(item) || "K").trim().charAt(0).toUpperCase() || "K";
  const churchMediaFirst = churchRoomPost || isHomeFeedChurchMediaPost(item);
  const cacheBustAt = homeFeedAvatarCacheBustAt(item);
  const isExternalVideoAccount = String(item?.source || "").trim().toLowerCase() === "system-admin-video-link";
  const sources = isExternalVideoAccount
    ? [item?.creatorAvatarUrl, item?.actorAvatarUri, item?.avatarUri, item?.authorAvatarUri]
    : homeFeedAvatarSourceFields(item, churchMediaFirst);

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

export function resolveHomeFeedAvatarCacheKey(item: any): string {
  const churchRoomPost = isChurchRoomMemberFeedPost(item);
  const authorUserId = String(item?.createdBy || item?.authorUserId || "").trim();
  if (String(item?.source || "").trim().toLowerCase() === "system-admin-video-link") {
    const creatorKey = String(item?.creatorId || item?.creatorProfileUrl || item?.creatorName || "").trim();
    if (creatorKey) return `external-video-account:${creatorKey.toLowerCase()}`;
  }

  if (churchRoomPost && authorUserId) {
    return `user:${authorUserId}`;
  }

  const churchId = homeFeedRowChurchId(item);
  if (churchId) return `church:${churchId.toUpperCase()}`;

  if (authorUserId) return `user:${authorUserId}`;

  const { uri, backupUri } = resolveHomeFeedDisplayAvatar(item);
  const primary = String(uri || backupUri || "").trim();
  return primary ? homeFeedAvatarUrlCacheKey(primary) : "";
}

export type HomeFeedAvatarCacheContext = HomeFeedDisplayAvatar & {
  cacheKey: string;
  remoteUris: string[];
  avatarUpdatedAt: number;
};

export function resolveHomeFeedAvatarCacheContext(item: any): HomeFeedAvatarCacheContext {
  const display = resolveHomeFeedDisplayAvatar(item);
  const remoteUris = [display.uri, display.backupUri].filter(Boolean);
  const cacheKey =
    resolveHomeFeedAvatarCacheKey(item) ||
    (display.uri ? homeFeedAvatarUrlCacheKey(display.uri) : "") ||
    (display.backupUri ? homeFeedAvatarUrlCacheKey(display.backupUri) : "");

  return {
    ...display,
    cacheKey,
    remoteUris,
    avatarUpdatedAt: homeFeedAvatarCacheBustAt(item),
  };
}

function summarizeFeedAvatarUri(uri: string, fallbackSource = "unknown") {
  const trimmed = String(uri || "").trim();
  if (!trimmed) {
    return { hasAvatar: false, avatarLength: 0, source: "none" as const };
  }
  if (trimmed.startsWith("data:image/")) {
    return { hasAvatar: true, avatarLength: trimmed.length, source: "data-url" as const };
  }
  if (/^https?:\/\//i.test(trimmed)) {
    return { hasAvatar: true, avatarLength: trimmed.length, source: "remote" as const };
  }
  return { hasAvatar: true, avatarLength: trimmed.length, source: fallbackSource as "relative" };
}

export function logHomeFeedIdentityAvatarResolve(
  item: any,
  authorName: string,
  finalAvatarUri: string,
  backupAvatarUri?: string
) {
  if (!isKristoVerboseFeedIdentityDebug()) return;

  const final = summarizeFeedAvatarUri(finalAvatarUri, "final");
  const backup = summarizeFeedAvatarUri(backupAvatarUri || "", "backup");
  console.log("KRISTO_FEED_IDENTITY_AVATAR_RESOLVE", {
    postId: feedRenderKey(item),
    authorName,
    hasAuthorAvatarUri: Boolean(String(item?.authorAvatarUri || "").trim()),
    hasChurchAvatarUri: Boolean(String(item?.churchAvatarUri || "").trim()),
    hasMediaLogoUrl: Boolean(String(item?.mediaLogoUrl || item?.mediaLogo || "").trim()),
    churchAvatarUpdatedAt: item?.churchAvatarUpdatedAt ?? item?.avatarUpdatedAt ?? null,
    finalAvatar: final,
    backupAvatar: backup,
  });
}

export function resolvePostAvatar(item: any) {
  return resolveHomeFeedDisplayAvatar(item).uri;
}

function homeFeedAvatarUriCandidates(item: any): string[] {
  return [
    item?.authorAvatarUri,
    item?.actorAvatarUri,
    item?.profileAvatarUri,
    item?.authorAvatar,
    item?.churchAvatarUri,
    item?.churchAvatarUrl,
    item?.avatarUri,
    item?.avatarUrl,
    item?.profileImage,
    item?.photoURL,
  ]
    .map((value) => String(value || "").trim())
    .filter(Boolean);
}

function postImageUriMatchesAvatarCandidates(candidate: string, avatarCandidates: string[]) {
  const trimmed = String(candidate || "").trim();
  if (!trimmed) return true;
  if (
    trimmed.includes("/uploads/media/") ||
    trimmed.includes("/church-feed-images/") ||
    /\/feed-images\//i.test(trimmed)
  ) {
    return false;
  }
  if (/\/profile-avatars\//i.test(trimmed)) return true;
  const resolvedCandidate = homeFeedMediaUrl(trimmed);
  return avatarCandidates.some((avatar) => {
    if (!avatar) return false;
    if (avatar === trimmed) return true;
    return homeFeedMediaUrl(avatar) === resolvedCandidate;
  });
}

function isExplicitPostImageCandidate(row: any, candidate: string) {
  const trimmed = String(candidate || "").trim();
  if (!trimmed) return false;
  const resolved = homeFeedMediaUrl(trimmed);
  const keys = ["mediaUri", "imageUrl", "imageUri", "mediaUrl", "photoUrl"] as const;
  const roots = [row, row?.payload].filter((entry) => entry && typeof entry === "object");

  for (const root of roots) {
    for (const key of keys) {
      const value = String(root?.[key] || "").trim();
      if (!value) continue;
      if (value === trimmed || homeFeedMediaUrl(value) === resolved) return true;
    }
    if (Array.isArray(root?.images)) {
      for (const value of root.images) {
        const next = String(value || "").trim();
        if (next && (next === trimmed || homeFeedMediaUrl(next) === resolved)) return true;
      }
    }
  }

  return false;
}

function resolveExplicitPostImageUri(row: any): string {
  const mediaType = String(row?.mediaType || "").trim().toLowerCase();
  const churchRoomPost = isChurchRoomMemberFeedPost(row);
  if (mediaType === "video") return "";

  const candidates = collectPostImageUriValues(row);
  for (const raw of candidates) {
    const trimmed = String(raw || "").trim();
    if (!trimmed) continue;
    if (/\.(mp4|mov|m4v|webm|mkv)(\?|#|$)/i.test(trimmed)) continue;
    if (/\/profile-avatars\//i.test(trimmed)) continue;

    const uri = homeFeedMediaUrl(trimmed);
    if (!uri) continue;
    if (/\.(mp4|mov|m4v|webm|mkv)(\?|#|$)/i.test(uri)) continue;

    if (
      mediaType === "image" ||
      churchRoomPost ||
      isExplicitPostImageCandidate(row, trimmed)
    ) {
      return uri;
    }
  }

  return "";
}

export function logImagePostRenderDiag(item: any, resolvedImageUri: string, isVideo: boolean) {
  const hasImageField = Boolean(
    String(item?.imageUrl || item?.imageUri || item?.mediaUri || item?.mediaUrl || item?.photoUrl || "").trim() ||
      (Array.isArray(item?.images) && item.images.length > 0) ||
      (Array.isArray(item?.attachments) && item.attachments.length > 0)
  );
  const shouldLog =
    isChurchRoomMemberFeedPost(item) ||
    String(item?.mediaType || "").trim().toLowerCase() === "image" ||
    hasImageField;

  if (!shouldLog) return;

  console.log("KRISTO_IMAGE_POST_RENDER_DIAG", {
    id: String(item?.id || "").trim() || null,
    kind: String(item?.kind || item?.source || "").trim() || null,
    type: String(item?.type || "").trim() || null,
    hasImageUrl: Boolean(String(item?.imageUrl || "").trim()),
    imageUrl: String(item?.imageUrl || "").trim() || null,
    imageUri: String(item?.imageUri || "").trim() || null,
    mediaUrl: String(item?.mediaUrl || "").trim() || null,
    photoUrl: String(item?.photoUrl || "").trim() || null,
    attachmentsCount: Array.isArray(item?.attachments) ? item.attachments.length : 0,
    imagesCount: Array.isArray(item?.images) ? item.images.length : 0,
    resolvedImageUri: resolvedImageUri || null,
    isVideo,
  });
}

function postImageUriMatchesAvatar(item: any, candidate: string) {
  if (isExplicitPostImageCandidate(item, candidate)) return false;
  return postImageUriMatchesAvatarCandidates(candidate, homeFeedAvatarUriCandidates(item));
}

export function resolvePostImageUri(item: any) {
  const uris = resolvePostImageUris(item, 1);
  if (uris.length) return uris[0];

  const row = normalizeHomeFeedApiRow(item);

  const explicit = resolveExplicitPostImageUri(row);
  if (explicit) return explicit;

  for (const raw of collectPostImageUriValues(row)) {
    if (!isFeedPostImageUri(raw) && !isExplicitPostImageCandidate(row, raw)) continue;
    if (postImageUriMatchesAvatar(row, raw)) continue;
    const uri = homeFeedMediaUrl(raw);
    if (!uri) continue;
    if (/\.(mp4|mov|m4v|webm|mkv)(\?|#|$)/i.test(uri)) continue;
    return uri;
  }
  return "";
}

export function resolvePostImageUris(item: any, maxImages = 5): string[] {
  const row = normalizeHomeFeedApiRow(item);
  const mediaType = String(row?.mediaType || "").trim().toLowerCase();
  if (mediaType === "video") return [];

  const seen = new Set<string>();
  const uris: string[] = [];
  const churchRoomPost = isChurchRoomMemberFeedPost(row);

  const tryPush = (raw: unknown) => {
    if (uris.length >= maxImages) return;
    const trimmed = String(raw || "").trim();
    if (!trimmed) return;
    if (/\.(mp4|mov|m4v|webm|mkv)(\?|#|$)/i.test(trimmed)) return;
    if (/\/profile-avatars\//i.test(trimmed)) return;
    if (
      !isFeedPostImageUri(trimmed) &&
      !isExplicitPostImageCandidate(row, trimmed) &&
      !churchRoomPost &&
      mediaType !== "image"
    ) {
      return;
    }
    if (postImageUriMatchesAvatar(row, trimmed)) return;
    const uri = homeFeedMediaUrl(trimmed);
    if (!uri || seen.has(uri)) return;
    if (/\.(mp4|mov|m4v|webm|mkv)(\?|#|$)/i.test(uri)) return;
    seen.add(uri);
    uris.push(uri);
  };

  const roots = [row, row?.payload].filter((entry) => entry && typeof entry === "object");

  for (const root of roots) {
    if (!Array.isArray(root?.images)) continue;
    for (const value of root.images) tryPush(value);
  }
  for (const root of roots) {
    if (!Array.isArray(root?.attachments)) continue;
    for (const entry of root.attachments) {
      if (typeof entry === "string") {
        tryPush(entry);
        continue;
      }
      if (!entry || typeof entry !== "object") continue;
      const att = entry as Record<string, unknown>;
      for (const key of ["url", "uri", "imageUrl", "mediaUrl", "publicUrl"]) {
        tryPush(att[key]);
      }
    }
  }
  for (const root of roots) {
    if (!Array.isArray(root?.mediaUrls)) continue;
    for (const value of root.mediaUrls) tryPush(value);
  }
  for (const raw of collectPostImageUriValues(row)) {
    tryPush(raw);
  }

  if (!uris.length) {
    const explicit = resolveExplicitPostImageUri(row);
    if (explicit) uris.push(explicit);
  }

  return uris;
}

export function resolveImageUri(item: any) {
  return resolvePostImageUri(item);
}

/** Infer upload/R2 poster path from video URL (matches server poster conventions). */
function resolvePosterSeedForVideo(videoUrl: string): string {
  try {
    const seed = (globalThis as any).__KRISTO_FEED_VIDEO_POSTER_SEED__;
    if (!seed || typeof seed !== "object") return "";
    const seedVideo = String(seed.videoUrl || "").trim().split("?")[0];
    const seedPoster = String(seed.posterUri || "").trim();
    const normalized = String(videoUrl || "").trim().split("?")[0];
    if (!seedVideo || !seedPoster || !normalized || seedVideo !== normalized) return "";
    if (isBrandedPosterUri(seedPoster)) return "";
    return homeFeedMediaUrl(seedPoster);
  } catch {
    return "";
  }
}

/** Ordered poster candidates for Home Feed — cache + metadata (+ inferred off Android), never branded. */
export function collectFeedVideoPosterCandidates(item: any, postId = ""): string[] {
  const video = resolveVideoUri(item);
  if (!video) return [];

  const seen = new Set<string>();
  const out: string[] = [];
  const pid = String(postId || item?.id || "").trim();

  const push = (raw: unknown) => {
    const resolved = homeFeedMediaUrl(raw);
    if (!resolved || isBrandedPosterUri(resolved)) return;
    if (!isValidVideoPosterUri(resolved, video)) return;
    const key = resolved.split("?")[0];
    if (seen.has(key)) return;
    seen.add(key);
    out.push(resolved);
  };

  const cached = resolveCachedMediaPoster(pid, video);
  if (cached) push(cached);

  for (const raw of [
    item?.posterUri,
    item?.videoPosterUri,
    item?.thumbnailUri,
    item?.thumbnailUrl,
    item?.mediaPosterUri,
    item?.posterUrl,
    item?.coverUrl,
    item?.firstFrameUrl,
    item?.coverImage,
    item?.coverImageUrl,
    item?.previewUrl,
    item?.thumbnail,
    item?.poster,
  ]) {
    push(raw);
  }

  push(resolvePosterSeedForVideo(video));
  if (shouldRequestInferredPosterGuess(Platform.OS)) {
    push(inferPosterUriFromVideoUrl(video));
  }

  return out;
}

export function resolveBestFeedPosterUri(item: any, postId = ""): string {
  return collectFeedVideoPosterCandidates(item, postId)[0] || "";
}

/** YouTube Home Feed: backend metadata + in-memory cache only (no inferred/frame URLs). */
export function resolveYouTubeFeedMetadataPosterUri(
  item: any,
  postId = "",
  videoUrl = ""
): string {
  const pid = String(postId || item?.id || "").trim();
  const video = String(videoUrl || resolveVideoUri(item) || "").trim();
  if (!video) return "";

  const cached = resolveCachedMediaPoster(pid, video);
  if (cached && !isInferredPosterUriForVideo(cached, video)) {
    return cached;
  }

  for (const raw of [
    item?.posterUri,
    item?.videoPosterUri,
    item?.thumbnailUri,
    item?.thumbnailUrl,
    item?.mediaPosterUri,
    item?.posterUrl,
    item?.coverUrl,
    item?.firstFrameUrl,
    item?.coverImage,
    item?.coverImageUrl,
    item?.previewUrl,
    item?.thumbnail,
    item?.poster,
  ]) {
    const resolved = homeFeedMediaUrl(raw);
    if (!resolved || isBrandedPosterUri(resolved)) continue;
    if (!isValidVideoPosterUri(resolved, video)) continue;
    if (isInferredPosterUriForVideo(resolved, video)) continue;
    return resolved;
  }

  return "";
}

export type HomeFeedPosterSourceKind =
  | "cache"
  | "metadata"
  | "inferred"
  | "generated-frame"
  | "branded-fallback"
  | "video-preview";

export function classifyHomeFeedPosterUriSource(
  item: any,
  posterUri: string,
  postId: string,
  videoUrl: string
): "cache" | "metadata" | "inferred" {
  const normalized = String(posterUri || "").trim().split("?")[0];
  if (!normalized) return "inferred";

  const cached = resolveCachedMediaPoster(postId, videoUrl);
  if (cached && cached.split("?")[0] === normalized) return "cache";

  const resolution = describePosterResolution(item, posterUri);
  if (String(resolution.source).startsWith("metadata:")) return "metadata";
  if (resolution.source === "inferred-from-video-url" || resolution.source === "seed") {
    return "inferred";
  }

  return "metadata";
}

export function resolvePosterUri(item: any) {
  return resolveBestFeedPosterUri(item, String(item?.id || "").trim());
}

export type PosterMetadataSnapshot = {
  posterUri: string | null;
  videoPosterUri: string | null;
  thumbnailUri: string | null;
  thumbnailUrl: string | null;
  posterUrl: string | null;
  brandedPoster: boolean;
};

export function snapshotPosterMetadata(item: any): PosterMetadataSnapshot {
  return {
    posterUri: String(item?.posterUri || "").trim() || null,
    videoPosterUri: String(item?.videoPosterUri || "").trim() || null,
    thumbnailUri: String(item?.thumbnailUri || "").trim() || null,
    thumbnailUrl: String(item?.thumbnailUrl || "").trim() || null,
    posterUrl: String(item?.posterUrl || "").trim() || null,
    brandedPoster: hasBrandedVideoPoster(item),
  };
}

/** Stable fingerprint for poster-related useMemo deps (immune to feed poll object churn). */
export function posterMetadataFingerprint(item: any): string {
  const metadata = snapshotPosterMetadata(item);
  const video = resolveVideoUri(item);
  return [
    metadata.posterUri,
    metadata.videoPosterUri,
    metadata.thumbnailUri,
    metadata.thumbnailUrl,
    metadata.posterUrl,
    metadata.brandedPoster ? "1" : "0",
    video.split("?")[0],
  ].join("|");
}

export function describePosterResolution(item: any, resolvedPoster: string) {
  const video = resolveVideoUri(item);
  const normalized = String(resolvedPoster || "").trim().split("?")[0];
  const metadata = snapshotPosterMetadata(item);
  const metaFields: Array<[string, string | null]> = [
    ["posterUri", metadata.posterUri],
    ["videoPosterUri", metadata.videoPosterUri],
    ["thumbnailUri", metadata.thumbnailUri],
    ["thumbnailUrl", metadata.thumbnailUrl],
    ["posterUrl", metadata.posterUrl],
  ];

  for (const [field, raw] of metaFields) {
    const resolved = homeFeedMediaUrl(raw);
    if (resolved && resolved.split("?")[0] === normalized) {
      return {
        source: `metadata:${field}`,
        metadata,
        generatedPosterUrl: resolvedPoster,
        videoUrl: video,
        posterExistsInMetadata: true,
      };
    }
  }

  const seeded = resolvePosterSeedForVideo(video);
  if (seeded && seeded.split("?")[0] === normalized) {
    return {
      source: "seed",
      metadata,
      generatedPosterUrl: resolvedPoster,
      videoUrl: video,
      posterExistsInMetadata: false,
    };
  }

  const inferred = inferPosterUriFromVideoUrl(video);
  if (inferred && inferred.split("?")[0] === normalized) {
    return {
      source: "inferred-from-video-url",
      metadata,
      generatedPosterUrl: resolvedPoster,
      videoUrl: video,
      posterExistsInMetadata: false,
    };
  }

  return {
    source: normalized ? "unknown" : "empty",
    metadata,
    generatedPosterUrl: resolvedPoster,
    videoUrl: video,
    posterExistsInMetadata: Boolean(
      metadata.posterUri ||
        metadata.videoPosterUri ||
        metadata.thumbnailUri ||
        metadata.thumbnailUrl ||
        metadata.posterUrl
    ),
  };
}

/**
 * Inferred low-res preview URLs were guessed from the full video URL (e.g.
 * /church-video-previews/* or /uploads/media/previews/*). Many of those objects
 * do not exist in storage, so the player hit 404s → player errors → failed
 * prewarm → unnecessary fallback retries. We no longer invent preview URLs:
 * only an explicit backend-provided previewUrl is used as the low-res startup
 * source, otherwise playback falls back to the full video URL. Backend preview
 * generation is unchanged.
 */
export function inferPreviewVideoUriFromVideoUrl(_videoUrl: string): string {
  return "";
}

export function hasBrandedVideoPoster(item: any) {
  return itemUsesBrandedVideoPoster(item);
}

export function hasHomeFeedVideoPoster(item: any, videoUri?: string) {
  const video = String(videoUri || resolveVideoUri(item) || "").trim();
  if (!video) return false;
  const poster = resolveBestFeedPosterUri(item, String(item?.id || "").trim());
  if (isValidVideoPosterUri(poster, video)) return true;
  if (resolveCachedMediaPoster(String(item?.id || "").trim(), video)) return true;
  return hasBrandedVideoPoster(item);
}

export function isVideoPost(item: any) {
  const uri = resolveVideoUri(item);
  return Boolean(uri) && (item?.mediaType === "video" || isFeedVideoItem(item));
}

export function buildHomeFeedVideoOpenPayload(item: any): HomeFeedVideoOpenPayload | null {
  if (!item || !isVideoPost(item)) return null;
  const postId = String(item?.id || "").trim();
  const videoUri = resolveVideoUri(item);
  if (!postId || !videoUri) return null;

  const churchRoomPost = isChurchRoomMemberFeedPost(item);
  const postTitle = resolveHomeFeedVideoTitle(item);
  const title = churchRoomPost ? resolveFeedPostTypeTitle(item) : postTitle;
  const playbackUri = resolveHomeFeedVideoUri(item) || videoUri;
  const videoDisplayType = resolveHomeFeedVideoDisplayType(item);

  return {
    postId,
    title,
    videoUri: playbackUri,
    posterUri: resolveBestFeedPosterUri(item, postId),
    videoDurationMs: resolveVideoDurationMs(item),
    videoDisplayType,
    item,
  };
}

export function isImagePost(item: any) {
  if (isVideoPost(item)) return false;
  const uri = resolvePostImageUri(item);
  if (!uri) return false;

  const mediaType = String(item?.mediaType || "").trim().toLowerCase();
  if (mediaType === "image") return true;
  if (mediaType === "video") return false;
  if (isChurchRoomMemberFeedPost(item)) return true;

  return !/\.(mp4|mov|m4v|webm|mkv)(\?|#|$)/i.test(uri);
}
