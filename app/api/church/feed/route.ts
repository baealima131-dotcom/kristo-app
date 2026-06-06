import { NextRequest, NextResponse } from "next/server";
import fs from "node:fs";
import path from "node:path";
import { resolveActorIdentity } from "@/app/api/_lib/notificationActor";
import { guard, guardAuth } from "@/app/api/_lib/rbac";
import { ensureActiveMembershipForSession, getActiveMembership } from "@/app/api/_lib/memberships";
import { createNotification } from "@/app/api/_lib/notifications";
import { getChurchById } from "@/app/api/_lib/churches";
import {
  churchAvatarUpdatedAtMs,
  resolveChurchAvatarFields,
} from "@/app/api/_lib/churchAvatar";
import {
  logChurchPastorResolution,
  resolveChurchPastorUserId,
} from "@/app/api/_lib/churchPastor";
import {
  churchSubscriptionRequiredResponse,
  isChurchSubscriptionActive,
} from "@/app/api/_lib/churchSubscription";
import {
  bumpMediaScheduleSync,
  bumpMediaScheduleSyncForFeedItem,
  getMediaScheduleSync,
} from "@/lib/mediaScheduleSync";
import {
  canCreateOrEditScheduleSlots,
  getMinistryMemberRole,
  isPastorAppRole,
  listMinistryLeaderUserIds,
} from "@/app/api/_lib/ministryAuthority";
import {
  ACTIVE_MEDIA_SCHEDULE_ERROR,
  findActiveMediaScheduleForChurch,
  findAllActiveMediaSchedulesForChurch,
  isIncomingMediaScheduleCreate,
  isMediaScheduleForChurch,
  isMediaScheduleFeedItem,
  summarizeActiveMediaSchedule,
} from "@/lib/mediaScheduleLock";
import { getChurchMediaByChurchId } from "@/app/api/_lib/store/mediaDb";
import {
  ChurchFeedItem,
  countScheduleFeedItems,
  deleteFeedItemById,
  deleteFeedItemsWhere,
  ensureFeedStoreReady,
  getFeedItemById,
  isFeedDatabaseError,
  listFeedItems,
  listFeedItemsForChurch,
  upsertFeedItem,
} from "@/app/api/_lib/store/feedDb";
import {
  countDiscussionForPostIdSet,
  countDiscussionForPostIds,
  deleteEngagementForPost,
  ensureCommentStoreReady,
  findFeedCommentById,
  getCommentLikeMetaForIds,
  getPostLikeMeta,
  insertFeedComment,
  isCommentDatabaseError,
  listCommentsForPostIds,
  logCommentStoreEvent,
  resolveCommentStoreMode,
  toggleCommentLike,
  togglePostLike,
  type FeedComment,
} from "@/app/api/_lib/store/feedCommentDb";
import { isKristoServerlessRuntime } from "@/app/api/_lib/store/fs";
import {
  applyBrandedVideoPosterFallback,
  brandedVideoPosterFields,
} from "@/app/api/_lib/media/brandedVideoPoster";
import {
  ensureVideoPosterForUrl,
  isUsableVideoPosterUri,
  posterPublicUrlForVideoUrl,
  publicUploadAbsPath,
  shouldAttemptServerFfmpeg,
} from "@/app/api/_lib/media/videoPoster";

export const runtime = "nodejs";

const BUNDLED_DATA_DIR = path.join(process.cwd(), "data");
const PROFILES_FILE = path.join(BUNDLED_DATA_DIR, "profiles.json");
const FEED_GET_TIMEOUT_MS = isKristoServerlessRuntime() ? 12000 : 30000;

let feedEnrichChurchCache = new Map<string, any>();
let feedEnrichMediaCache = new Map<string, any | null>();

function resetFeedEnrichCaches() {
  feedEnrichChurchCache = new Map();
  feedEnrichMediaCache = new Map();
}

type FeedType = "post" | "announcement" | "video";

export type { ChurchFeedItem, FeedComment };

type FeedCommentTree = FeedComment & {
  likeCount: number;
  likedByMe: boolean;
  replies: Array<
    FeedComment & {
      likeCount: number;
      likedByMe: boolean;
    }
  >;
};

type FeedPostDetail = {
  item: ChurchFeedItem & {
    commentCount: number;
    replyCount: number;
    totalDiscussionCount: number;
  };
  comments: FeedCommentTree[];
};

type ApiOk<T> = { ok: true; data: T };
type ApiErr = { ok: false; error: string };

function ok<T>(data: T, init?: ResponseInit) {
  return NextResponse.json({ ok: true, data } satisfies ApiOk<T>, init);
}

function feedListOk<T>(churchId: string, data: T, init?: ResponseInit) {
  const sync = getMediaScheduleSync(churchId);
  return NextResponse.json(
    {
      ok: true,
      data,
      mediaScheduleVersion: sync.version,
      mediaScheduleUpdatedAt: sync.updatedAt,
    },
    init
  );
}

function err(error: string, status = 400) {
  return NextResponse.json({ ok: false, error } satisfies ApiErr, { status });
}

function makeId(prefix: string) {
  return `${prefix}_${Date.now()}_${Math.random().toString(16).slice(2)}`;
}

function profileMap(): Record<string, any> {
  try {
    if (!fs.existsSync(PROFILES_FILE)) return {};
    const raw = fs.readFileSync(PROFILES_FILE, "utf8");
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
}

async function churchMediaFor(churchId: string) {
  const cid = String(churchId || "").trim();
  if (!cid) return null;

  if (feedEnrichMediaCache.has(cid)) {
    return feedEnrichMediaCache.get(cid);
  }

  try {
    const media = await getChurchMediaByChurchId(cid);
    feedEnrichMediaCache.set(cid, media);
    return media;
  } catch {
    feedEnrichMediaCache.set(cid, null);
    return null;
  }
}

async function churchProfileFor(churchId: string) {
  const cid = String(churchId || "").trim();
  if (!cid) return null;
  // Always read latest church profile so feed author avatars update after profile save.
  return getChurchById(cid).catch(() => null);
}

function publicUser(userId: string) {
  const p = profileMap()[userId] || {};
  const name =
    String(p.fullName || p.displayName || p.name || p.username || "").trim() ||
    String(p.email || "").split("@")[0] ||
    userId;

  const avatarUri = String(
    p.avatarUri || p.avatarUrl || p.profileImage || p.photoURL || p.image || ""
  ).trim();

  return {
    authorName: name,
    authorAvatarUri: avatarUri,
    authorInitial: name.trim().charAt(0).toUpperCase() || "U",
  };
}

function commentAuthorNameLooksLikeUserId(value: string, userId: string) {
  const v = String(value || "").trim();
  const uid = String(userId || "").trim();
  if (!v) return true;
  if (uid && v === uid) return true;
  if (/^u[-_]?/i.test(v)) return true;
  if (/^[a-f0-9-]{18,}$/i.test(v)) return true;
  if (v.length >= 20 && !v.includes(" ")) return true;
  return false;
}

function nameFromViewer(viewer: any) {
  const email = String(viewer?.email || "").trim();
  const emailPrefix = email.includes("@") ? email.split("@")[0] : "";
  const candidates = [
    viewer?.fullName,
    viewer?.displayName,
    viewer?.name,
    viewer?.username,
    emailPrefix,
  ];
  for (const candidate of candidates) {
    const value = String(candidate || "").trim();
    if (value) return value;
  }
  return "";
}

function firstNonEmptyAvatar(...values: unknown[]) {
  for (const value of values) {
    const uri = String(value || "").trim();
    if (uri) return uri;
  }
  return "";
}

function avatarFromViewer(viewer: any) {
  const profile = viewer?.profile;
  return firstNonEmptyAvatar(
    viewer?.avatarUri,
    viewer?.avatarUrl,
    viewer?.profileImage,
    viewer?.photoURL,
    viewer?.image,
    viewer?.picture,
    profile?.avatarUri,
    profile?.avatarUrl,
    profile?.profileImage,
    profile?.photoURL,
    profile?.image
  );
}

function avatarFromProfileMap(userId: string) {
  const p = profileMap()[userId] || {};
  return firstNonEmptyAvatar(
    p.avatarUri,
    p.avatarUrl,
    p.profileImage,
    p.photoURL,
    p.image,
    p.picture
  );
}

async function resolveCommentAuthorSnapshot(viewerUserId: string, ctx: any) {
  const viewer = ctx?.viewer || {};
  const ctxName = nameFromViewer(viewer);
  const ctxAvatar = avatarFromViewer(viewer);
  const mapAvatar = avatarFromProfileMap(viewerUserId);
  const fallback = publicUser(viewerUserId);
  const publicUserName = fallback.authorName;
  const identity = await resolveActorIdentity(viewerUserId);

  let finalAuthorName = ctxName || identity.name || publicUserName;
  if (commentAuthorNameLooksLikeUserId(finalAuthorName, viewerUserId)) {
    const profileEmail = String(profileMap()[viewerUserId]?.email || "").trim();
    const emailPrefix = String(viewer?.email || profileEmail || "")
      .split("@")[0]
      .trim();
    if (emailPrefix && !commentAuthorNameLooksLikeUserId(emailPrefix, viewerUserId)) {
      finalAuthorName = emailPrefix;
    } else {
      finalAuthorName = "Member";
    }
  }

  const finalAuthorAvatarUri = firstNonEmptyAvatar(
    ctxAvatar,
    mapAvatar,
    identity.avatar,
    fallback.authorAvatarUri
  );
  const finalAuthorInitial = finalAuthorName.trim().charAt(0).toUpperCase() || "M";

  console.log("KRISTO_COMMENT_AUTHOR_RESOLVED", {
    userId: viewerUserId,
    finalAuthorName,
    finalAuthorAvatarUri: finalAuthorAvatarUri || null,
    hasAvatar: Boolean(finalAuthorAvatarUri),
  });

  return {
    authorName: finalAuthorName,
    authorAvatarUri: finalAuthorAvatarUri,
    authorInitial: finalAuthorInitial,
  };
}

function profileAvatarForUserId(userId: string) {
  const p = profileMap()[userId] || {};
  return String(
    p.avatarUri || p.avatarUrl || p.profileImage || p.photoURL || p.image || ""
  ).trim();
}

function enrichScheduleSlotClaimAvatar(slot: any) {
  const userId = String(slot?.claimedByUserId || slot?.claimedBy?.userId || "").trim();
  if (!userId) return slot;

  const existing = String(
    slot?.claimedByAvatarUri ||
      slot?.claimedByAvatar ||
      slot?.claimedByAvatarUrl ||
      slot?.claimedBy?.avatarUri ||
      slot?.claimedBy?.avatarUrl ||
      slot?.claimedBy?.profileImage ||
      slot?.claimedBy?.photoURL ||
      slot?.claimedBy?.image ||
      ""
  ).trim();

  const avatarUri = existing || profileAvatarForUserId(userId);
  if (!avatarUri) return slot;

  const claimedBy =
    slot?.claimedBy && typeof slot.claimedBy === "object"
      ? {
          ...slot.claimedBy,
          userId,
          avatarUri,
        }
      : {
          userId,
          name: String(slot?.claimedByName || "Member"),
          role: String(slot?.claimedByRole || "Member"),
          avatarUri,
        };

  return {
    ...slot,
    claimedByAvatarUri: avatarUri,
    claimedByAvatar: avatarUri,
    claimedBy,
  };
}

function enrichScheduleSlotsClaimAvatars(slots: any[]) {
  if (!Array.isArray(slots)) return [];
  return slots.map(enrichScheduleSlotClaimAvatar);
}

type CommentActorIdentity = { name: string; avatar: string };

function resolveReadAuthorName(
  userId: string,
  snapName: string,
  identity: CommentActorIdentity,
  fallback: ReturnType<typeof publicUser>
) {
  if (snapName && !commentAuthorNameLooksLikeUserId(snapName, userId)) {
    return snapName;
  }

  for (const candidate of [identity.name, fallback.authorName]) {
    const value = String(candidate || "").trim();
    if (value && !commentAuthorNameLooksLikeUserId(value, userId)) return value;
  }

  const profileEmail = String(profileMap()[userId]?.email || "").trim();
  const emailPrefix = profileEmail.includes("@") ? profileEmail.split("@")[0].trim() : "";
  if (emailPrefix && !commentAuthorNameLooksLikeUserId(emailPrefix, userId)) {
    return emailPrefix;
  }

  return "Member";
}

async function hydrateCommentIdentityMap(comments: FeedComment[]) {
  const identityByUser = new Map<string, CommentActorIdentity>();
  const userIds = [
    ...new Set(comments.map((row) => String(row.createdBy || "").trim()).filter(Boolean)),
  ];

  await Promise.all(
    userIds.map(async (userId) => {
      identityByUser.set(userId, await resolveActorIdentity(userId));
    })
  );

  return identityByUser;
}

async function enrichComment<T extends FeedComment>(
  c: T,
  identityByUser?: Map<string, CommentActorIdentity>
): Promise<
  T & {
    authorName: string;
    authorAvatarUri: string;
    authorInitial: string;
  }
> {
  const commentId = String(c.id || "").trim();
  const beforeName = String(c.authorName || "").trim();
  const hadAvatar = Boolean(String(c.authorAvatarUri || "").trim());
  const userId = String(c.createdBy || "").trim();

  let identity = identityByUser?.get(userId);
  if (!identity && userId) {
    identity = await resolveActorIdentity(userId);
    identityByUser?.set(userId, identity);
  }
  identity = identity || { name: "", avatar: "" };

  const fallback = publicUser(userId);
  const snapName = beforeName;
  const snapAvatar = String(c.authorAvatarUri || "").trim();
  const hasValidSnapName = Boolean(snapName) && !commentAuthorNameLooksLikeUserId(snapName, userId);

  const finalName = resolveReadAuthorName(userId, snapName, identity, fallback);
  const finalAuthorAvatarUri = firstNonEmptyAvatar(
    snapAvatar,
    identity.avatar,
    fallback.authorAvatarUri
  );
  const hasAvatar = Boolean(finalAuthorAvatarUri);
  const finalInitial =
    String(c.authorInitial || "").trim() ||
    finalName.charAt(0).toUpperCase() ||
    "M";

  let source: "snapshot" | "actorIdentity" | "snapshot+avatarHydrate" = "actorIdentity";
  if (hasValidSnapName) {
    if (snapAvatar) {
      source = "snapshot";
    } else if (hasAvatar) {
      source = "snapshot+avatarHydrate";
    } else {
      source = "snapshot";
    }
  }

  console.log("KRISTO_COMMENT_AUTHOR_ENRICH", {
    commentId,
    source,
    beforeName: beforeName || null,
    finalName,
    hadAvatar,
    hasAvatar,
  });

  return {
    ...c,
    authorName: finalName,
    authorAvatarUri: finalAuthorAvatarUri,
    authorInitial: finalInitial,
  };
}


function uploadedMediaFileExists(uri: unknown) {
  const value = String(uri || "").trim();
  if (!value) return false;

  // Remote/storage URLs cannot be checked locally, so do not block them here.
  if (!value.startsWith("/uploads/")) return true;

  const clean = value.split("?")[0].replace(/^\/+/, "");
  const full = path.join(process.cwd(), "public", clean.replace(/^public\//, ""));
  return fs.existsSync(full);
}

function feedVideoAssetExists(item: any) {
  const isVideo = item?.type === "video" || Boolean(String(item?.videoUrl || "").trim());
  if (!isVideo) return true;
  return uploadedMediaFileExists(item?.videoUrl);
}

function cleanText(input: unknown, max = 5000): string {
  const s = typeof input === "string" ? input.trim() : "";
  if (!s) return "";
  return s.length > max ? s.slice(0, max) : s;
}

function parsePositiveNumber(input: unknown): number | undefined {
  const n = Number(input);
  if (!Number.isFinite(n) || n <= 0) return undefined;
  return n;
}

function computeVideoBitrateEstimate(sizeBytes: number, durationMs: number): number | undefined {
  if (!Number.isFinite(sizeBytes) || sizeBytes <= 0) return undefined;
  if (!Number.isFinite(durationMs) || durationMs <= 0) return undefined;
  return Math.round((sizeBytes * 8) / (durationMs / 1000));
}

function applyVideoMetadataFields(item: any, body?: any) {
  const durationMs =
    parsePositiveNumber(body?.durationMs) ??
    parsePositiveNumber(item?.durationMs);
  const sizeBytes =
    parsePositiveNumber(body?.sizeBytes) ??
    parsePositiveNumber(body?.fileSizeBytes) ??
    parsePositiveNumber(item?.sizeBytes) ??
    parsePositiveNumber(item?.fileSizeBytes);
  const faststart =
    body?.faststart === true || item?.faststart === true || item?.hasFaststart === true;
  const faststartPending =
    body?.faststartPending === true || item?.faststartPending === true;
  const faststartReason = String(body?.faststartReason || item?.faststartReason || "").trim();
  let bitrateEstimate =
    parsePositiveNumber(body?.bitrateEstimate) ?? parsePositiveNumber(item?.bitrateEstimate);

  if (!bitrateEstimate && durationMs && sizeBytes) {
    bitrateEstimate = computeVideoBitrateEstimate(sizeBytes, durationMs);
  }

  if (durationMs) {
    item.durationMs = Math.round(durationMs);
    item.durationSec = item.durationMs / 1000;
  }
  if (sizeBytes) {
    item.sizeBytes = Math.round(sizeBytes);
    item.fileSizeBytes = item.sizeBytes;
  }
  if (bitrateEstimate) {
    item.bitrateEstimate = Math.round(bitrateEstimate);
  }
  if (faststart) {
    item.faststart = true;
    item.faststartPending = false;
    delete item.faststartReason;
  } else if (faststartPending) {
    item.faststartPending = true;
    if (faststartReason) item.faststartReason = faststartReason;
  } else if (faststartReason) {
    item.faststartReason = faststartReason;
  }

  return item;
}

function withVideoMetadataReturnFields(item: any) {
  const isVideo =
    item?.type === "video" || Boolean(String(item?.videoUrl || "").trim());
  if (!isVideo) return item;

  const next = applyVideoMetadataFields({ ...item });
  const hasMetadata =
    Number(next?.durationMs || 0) > 0 ||
    Number(next?.sizeBytes || 0) > 0 ||
    Number(next?.bitrateEstimate || 0) > 0 ||
    next?.faststart === true;

  if (hasMetadata) {
    console.log("KRISTO_VIDEO_METADATA_RETURNED", {
      id: String(next?.id || ""),
      durationMs: Number(next?.durationMs || 0) || null,
      durationSec: Number(next?.durationSec || 0) || null,
      sizeBytes: Number(next?.sizeBytes || 0) || null,
      fileSizeBytes: Number(next?.fileSizeBytes || 0) || null,
      bitrateEstimate: Number(next?.bitrateEstimate || 0) || null,
      faststart: next?.faststart === true,
      source: String(next?.source || ""),
    });
  }

  return next;
}

function feedUrlLooksLikeAvatarOrLogo(raw: unknown) {
  const v = String(raw || "").trim().toLowerCase();
  if (!v) return false;
  return /avatar|profile|logo|church-logo|profile-avatars|media-avatar/i.test(v);
}

function feedUriMatchesAvatarMetadata(uri: unknown, fields: unknown[]) {
  const value = String(uri || "").trim();
  if (!value) return false;
  if (feedUrlLooksLikeAvatarOrLogo(value)) return true;
  const normalized = value.toLowerCase();
  return fields.some((field) => {
    const candidate = String(field || "").trim().toLowerCase();
    return Boolean(candidate && candidate === normalized);
  });
}

function isRemotePosterUri(uri: unknown) {
  const value = String(uri || "").trim();
  if (!value) return false;
  if (/^https?:\/\//i.test(value)) return true;
  return value.includes("/church-video-posters/") || value.includes("/uploads/media/posters/");
}

type MediaStatus = "uploading" | "processing" | "ready";

function normalizeMediaStatus(value: unknown): MediaStatus | undefined {
  const status = String(value || "").trim().toLowerCase();
  if (status === "uploading" || status === "processing" || status === "ready") {
    return status;
  }
  return undefined;
}

function isMediaUploadCreateBody(body: any) {
  if (body?.isMediaPost === true) return true;
  if (String(body?.source || "").toLowerCase() === "media-upload") return true;
  if (
    String(body?.postOrigin || "").toLowerCase() === "media" &&
    String(body?.storageType || "").toLowerCase() === "media"
  ) {
    return true;
  }
  return false;
}

function isHomeFeedReadyItem(item: any) {
  const isVideo = item?.type === "video" || Boolean(String(item?.videoUrl || "").trim());
  if (!isVideo) return true;

  const status = normalizeMediaStatus(item?.mediaStatus);
  if (!status) return true;
  return status === "ready";
}

function logMediaStatus(event: string, meta: Record<string, unknown>) {
  console.log(event, meta);
}

async function finalizeMediaUploadVideoPost(itemId: string) {
  try {
    await new Promise((resolve) => setTimeout(resolve, 2500));

    const existing = await getFeedItemById(itemId);
    if (!existing) return;

    let posterUri = String((existing as any)?.posterUri || (existing as any)?.videoPosterUri || "").trim();
    const videoUrl = String(existing.videoUrl || "").trim();

    if (!posterUri && videoUrl) {
      if (shouldAttemptServerFfmpeg()) {
        const generated = await ensureVideoPosterForUrl(videoUrl);
        if (generated) posterUri = generated;
      }
    }

    const next: any = {
      ...existing,
      mediaStatus: "ready",
    };

    if (posterUri) {
      next.posterUri = posterUri;
      next.videoPosterUri = posterUri;
      next.thumbnailUri = posterUri;
    } else if (videoUrl) {
      Object.assign(next, brandedVideoPosterFields());
    }

    await upsertFeedItem(next);
    logMediaStatus("KRISTO_MEDIA_STATUS_READY", {
      id: itemId,
      videoUrl,
      posterUri: posterUri || null,
    });
  } catch (error) {
    logMediaStatus("KRISTO_MEDIA_STATUS_READY_ERROR", {
      id: itemId,
      message: error instanceof Error ? error.message : String(error),
    });
  }
}

function sanitizeFeedPostMediaFields(input: {
  type: FeedType;
  videoUrl?: string;
  mediaUri?: string;
  posterUri?: string;
  thumbnailUri?: string;
  actorAvatarUri?: string;
  churchAvatarUri?: string;
  avatarUri?: string;
  profileImage?: string;
  logo?: string;
}) {
  const isVideo =
    input.type === "video" || Boolean(String(input.videoUrl || "").trim());

  const avatarFields = [
    input.actorAvatarUri,
    input.churchAvatarUri,
    input.avatarUri,
    input.profileImage,
    input.logo,
  ];

  let mediaUri = input.mediaUri;
  let posterUri = input.posterUri;
  let thumbnailUri = input.thumbnailUri;

  if (isVideo) {
    mediaUri = undefined;
  } else if (feedUriMatchesAvatarMetadata(mediaUri, avatarFields)) {
    mediaUri = undefined;
  }

  if (isVideo) {
    if (!isRemotePosterUri(posterUri) && feedUriMatchesAvatarMetadata(posterUri, avatarFields)) {
      posterUri = undefined;
    }
    if (!isRemotePosterUri(thumbnailUri) && feedUriMatchesAvatarMetadata(thumbnailUri, avatarFields)) {
      thumbnailUri = undefined;
    }
  }

  return { mediaUri, posterUri, thumbnailUri };
}

function commentPostIdAliases(item: { id?: string; sourceScheduleId?: string; liveId?: string }, requestPostId?: string) {
  const ids = new Set<string>();
  const canonical = String(item?.id || "").trim();
  if (canonical) ids.add(canonical);
  const requested = String(requestPostId || "").trim();
  if (requested) ids.add(requested);
  const sourceScheduleId = String(item?.sourceScheduleId || "").trim();
  const liveId = String(item?.liveId || "").trim();
  if (sourceScheduleId) ids.add(sourceScheduleId);
  if (liveId) ids.add(liveId);
  return ids;
}

function isClaimableScheduleFeedItem(item: any) {
  const slots = Array.isArray(item?.scheduleSlots) ? item.scheduleSlots : [];
  return (
    slots.length > 0 ||
    String(item?.scheduleType || "").includes("media-live-slots") ||
    String(item?.source || "").includes("media-schedule")
  );
}

function inferOwnershipType(item: any): "church" | "media" | "member" {
  const explicit = String(item?.ownershipType || "").trim().toLowerCase();
  if (explicit === "church" || explicit === "media" || explicit === "member") {
    return explicit;
  }

  if (isMediaOwnedFeedItem(item)) return "media";
  return "member";
}

function isMediaChurchFeedPost(item: any, ownershipType: string) {
  const source = String(item?.source || "").toLowerCase();
  return (
    ownershipType === "media" ||
    ownershipType === "church" ||
    source === "media-upload" ||
    source.includes("media")
  );
}

function resolveFeedAuthorEnrichment(args: {
  item: any;
  itemChurchProfile: any;
  itemMediaProfile: any;
  ownershipType: "church" | "media" | "member";
  fallbackAuthor: { authorName: string; authorAvatarUri: string };
}) {
  const { item, itemChurchProfile, itemMediaProfile, ownershipType, fallbackAuthor } = args;

  const churchAvatarFields = itemChurchProfile
    ? resolveChurchAvatarFields(itemChurchProfile)
    : null;
  const churchAvatarUpdatedAt = churchAvatarUpdatedAtMs(itemChurchProfile);

  const churchLogoUrl =
    firstNonEmptyAvatar(
      churchAvatarFields?.churchLogoUrl,
      churchAvatarFields?.logoUrl,
      item?.churchLogoUrl,
      item?.churchLogoUri,
      item?.churchLogo,
      itemChurchProfile?.churchLogoUrl,
      itemChurchProfile?.churchLogoUri,
      itemChurchProfile?.logoUrl,
      itemChurchProfile?.logoUri
    ) || undefined;

  const churchAvatarUri =
    firstNonEmptyAvatar(
      churchAvatarFields?.churchAvatarUri,
      churchAvatarFields?.finalAvatarUri,
      churchAvatarFields?.avatarUri,
      churchAvatarFields?.avatarUrl,
      item?.churchAvatarUri,
      item?.churchAvatarUrl,
      item?.churchAvatar,
      item?.ownerChurchAvatarUri,
      churchLogoUrl,
      itemChurchProfile?.avatarUri,
      itemChurchProfile?.avatarUrl,
      itemChurchProfile?.profileImage
    ) || "";

  const mediaLogoUrl =
    firstNonEmptyAvatar(
      item?.mediaLogoUrl,
      item?.mediaLogo,
      itemMediaProfile?.mediaLogoUrl,
      itemMediaProfile?.logoUrl,
      itemMediaProfile?.logoUri
    ) || undefined;

  const mediaAvatarUri =
    firstNonEmptyAvatar(
      item?.mediaAvatarUri,
      item?.mediaAvatar,
      mediaLogoUrl,
      item?.actorAvatarUri,
      itemMediaProfile?.avatarUri,
      itemMediaProfile?.avatarUrl,
      itemMediaProfile?.mediaAvatarUri
    ) || undefined;

  const authorAvatarCandidate = firstNonEmptyAvatar(
    item?.authorAvatarUri,
    fallbackAuthor.authorAvatarUri,
    item?.profileAvatarUri,
    item?.avatarUri,
    item?.profileImage
  );

  const isMediaPost = isMediaChurchFeedPost(item, ownershipType);
  const isMediaUpload = String(item?.source || "").toLowerCase() === "media-upload";
  const hasMediaAvatar = Boolean(mediaAvatarUri || mediaLogoUrl);

  const candidates: Array<{ source: string; uri: string }> = [];
  const push = (source: string, uri: unknown) => {
    const value = String(uri || "").trim();
    if (!value) return;
    if (candidates.some((c) => c.uri === value)) return;
    candidates.push({ source, uri: value });
  };

  if (isMediaPost && isMediaUpload && !hasMediaAvatar) {
    push("churchAvatarUri", churchAvatarUri);
    push("churchLogoUrl", churchLogoUrl);
    push("churchLogo", item?.churchLogo);
    push("ownerChurchAvatarUri", item?.ownerChurchAvatarUri);
    push("mediaAvatarUri", mediaAvatarUri);
    push("mediaLogoUrl", mediaLogoUrl);
    push("authorAvatarUri", authorAvatarCandidate);
    push("profileAvatarUri", item?.profileAvatarUri);
  } else if (isMediaPost) {
    push("churchAvatarUri", churchAvatarUri);
    push("churchLogoUrl", churchLogoUrl);
    push("churchLogo", item?.churchLogo);
    push("ownerChurchAvatarUri", item?.ownerChurchAvatarUri);
    push("mediaAvatarUri", mediaAvatarUri);
    push("mediaLogoUrl", mediaLogoUrl);
    push("authorAvatarUri", authorAvatarCandidate);
    push("profileAvatarUri", item?.profileAvatarUri);
  } else {
    push("authorAvatarUri", authorAvatarCandidate);
    push("churchAvatarUri", churchAvatarUri);
    push("churchLogoUrl", churchLogoUrl);
    push("mediaAvatarUri", mediaAvatarUri);
    push("profileAvatarUri", item?.profileAvatarUri);
  }

  const chosen = candidates[0];
  const finalAvatarUri = chosen?.uri || "";

  return {
    authorAvatarUri: finalAvatarUri,
    churchAvatarUri: churchAvatarUri || undefined,
    churchLogoUrl,
    mediaAvatarUri,
    mediaLogoUrl,
    finalAvatarUri,
    churchAvatarUpdatedAt: churchAvatarUpdatedAt || undefined,
    source: chosen?.source || "none",
  };
}

function isMediaOwnedFeedItem(item: any) {
  const ownership = String(item?.ownershipType || "").trim().toLowerCase();
  if (ownership === "media") return true;

  const source = String(item?.source || "").toLowerCase();
  const scheduleType = String(item?.scheduleType || "").toLowerCase();

  if (source.includes("media")) return true;
  if (scheduleType.includes("media-live") || scheduleType.includes("live")) return true;
  if (isClaimableScheduleFeedItem(item)) return true;
  if (String(item?.type || "").toLowerCase() === "video" && String(item?.mediaName || "").trim()) {
    return true;
  }

  return false;
}

function viewerRoleLower(role: unknown) {
  return String(role || "").toLowerCase();
}

function isPastorOrAdminRole(role: unknown) {
  const r = viewerRoleLower(role);
  return r.includes("pastor") || r.includes("admin");
}

async function isMediaHostForChurch(churchId: string, userId: string) {
  const mediaProfile: any = await churchMediaFor(churchId);
  const mediaHosts = Array.isArray(mediaProfile?.hosts) ? mediaProfile.hosts : [];
  return mediaHosts.some((h: any) => String(h?.userId || h?.id || "") === String(userId || ""));
}

async function canAccessMediaStorage(churchId: string, role: unknown, userId: string) {
  return isPastorOrAdminRole(role) || (await isMediaHostForChurch(churchId, userId));
}

async function canDeleteFeedPost(item: any, churchId: string, role: unknown, userId: string) {
  const itemChurchId = String(item?.churchId || "");
  if (!itemChurchId || itemChurchId !== String(churchId || "")) return false;

  if (isPastorOrAdminRole(role)) return true;

  const pastorResolution = await resolveChurchPastorUserId(churchId);
  if (String(pastorResolution.actualChurchPastorUserId || "").trim() === String(userId || "")) {
    return true;
  }

  const ownership = inferOwnershipType(item);
  const isOwnPost = String(item?.createdBy || "") === String(userId || "");

  if (await isMediaHostForChurch(churchId, userId)) {
    if (ownership === "media") return true;
  }
  if (isOwnPost && ownership === "member") return true;

  return false;
}

function resolveScheduleMinistryId(item: any, body: any) {
  return String(
    body?.ministryId ||
      body?.roomId ||
      body?.sourceRoomId ||
      item?.ministryId ||
      item?.roomId ||
      item?.sourceRoomId ||
      ""
  ).trim();
}

function formatScheduleSlotLabel(slot: any) {
  const title = String(slot?.name || slot?.slotLabel || slot?.title || "schedule slot").trim();
  const time = String(slot?.timeLabel || slot?.startTime || "").trim();
  return time ? `${title} (${time})` : title;
}

async function assertScheduleEditPermission(args: {
  churchId: string;
  viewerUserId: string;
  viewerAppRole: string;
  item: any;
  body: any;
}) {
  const itemChurchId = String(args.item?.churchId || args.churchId || "");
  if (itemChurchId && itemChurchId !== String(args.churchId || "")) {
    return "Feed item not in your church";
  }

  const isMedia =
    isMediaScheduleFeedItem(args.item) ||
    isIncomingMediaScheduleCreate(args.body) ||
    String(args.item?.source || "").includes("media");
  const isMediaHost = await isMediaHostForChurch(args.churchId, args.viewerUserId);
  const ministryId = resolveScheduleMinistryId(args.item, args.body);

  const allowed = await canCreateOrEditScheduleSlots({
    churchId: args.churchId,
    viewerUserId: args.viewerUserId,
    viewerAppRole: args.viewerAppRole,
    ministryId,
    isMediaSchedule: isMedia,
    isMediaHost,
  });

  if (!allowed) return "Only Pastor, Leader, or Host can edit schedule slots";
  return null;
}

async function notifyScheduleSlotEdit(args: {
  churchId: string;
  editorUserId: string;
  editorName: string;
  editorAppRole: string;
  ministryId?: string;
  slotLabel: string;
}) {
  if (isPastorAppRole(args.editorAppRole)) return;

  const ministryId = String(args.ministryId || "").trim();
  const editorMinistryRole = ministryId
    ? await getMinistryMemberRole(args.churchId, ministryId, args.editorUserId)
    : "";

  const isLeaderOrHost =
    editorMinistryRole === "Leader" ||
    editorMinistryRole === "Assistant" ||
    editorMinistryRole === "Host";

  if (!isLeaderOrHost) return;

  const pastorResolution = await resolveChurchPastorUserId(args.churchId);
  const pastorUserId = String(pastorResolution.actualChurchPastorUserId || "").trim();
  const leaderIds = ministryId ? await listMinistryLeaderUserIds(args.churchId, ministryId) : [];

  const notifyIds = new Set<string>();
  if (pastorUserId) notifyIds.add(pastorUserId);
  for (const id of leaderIds) notifyIds.add(id);
  notifyIds.delete(args.editorUserId);

  const message = `${args.editorName || args.editorUserId} edited ${args.slotLabel}`;

  for (const targetUserId of notifyIds) {
    createNotification({
      churchId: args.churchId,
      type: "Generic",
      title: "Schedule updated",
      message,
      targetUserId,
      ministryId: ministryId || undefined,
    });
  }
}

async function removePostAndRelated(postId: string) {
  await deleteFeedItemById(postId);
  await deleteEngagementForPost(postId);
}

type FeedListEngagementMeta = {
  discussionByPostId: Map<string, { commentCount: number; replyCount: number }>;
};

async function enrichFeedListItem(
  item: any,
  viewerUserId: string,
  engagement?: FeedListEngagementMeta
) {
  const itemChurchId = String(item.churchId || "");
  const itemChurchProfile = await churchProfileFor(itemChurchId);
  const itemMediaProfile: any = await churchMediaFor(itemChurchId);
  const author = publicUser(item.createdBy);

  const itemChurchName = String(
    (itemChurchProfile as any)?.name ||
    item?.churchName ||
    item?.churchLabel ||
    itemChurchId ||
    "Church"
  ).trim();

  const ownershipType = inferOwnershipType(item);
  const itemMediaName = String(
    itemMediaProfile?.mediaName || item?.mediaName || itemChurchName || "Church Media"
  ).trim();

  const authorEnrichment = resolveFeedAuthorEnrichment({
    item,
    itemChurchProfile,
    itemMediaProfile,
    ownershipType,
    fallbackAuthor: author,
  });

  const postId = String(item?.id || "").trim();

  let posterUri =
    String(item?.posterUri || item?.videoPosterUri || "").trim() || undefined;
  let thumbnailUri =
    String(item?.thumbnailUri || item?.thumbnailUrl || item?.videoPosterUri || "").trim() ||
    undefined;
  let videoBrandedPoster = item?.brandedPoster === true;
  const isVideoItem =
    item?.type === "video" || Boolean(String(item?.videoUrl || "").trim());

  if (isVideoItem && item?.videoUrl) {
    const videoUrlStr = String(item.videoUrl).trim();
    const hasUsablePoster =
      item?.brandedPoster === true ||
      isUsableVideoPosterUri(posterUri, videoUrlStr) ||
      isUsableVideoPosterUri(thumbnailUri, videoUrlStr);

    if (!hasUsablePoster) {
      if (shouldAttemptServerFfmpeg()) {
        const existingPoster = posterPublicUrlForVideoUrl(videoUrlStr);
        const posterAbsPath = publicUploadAbsPath(existingPoster);
        if (posterAbsPath && fs.existsSync(posterAbsPath)) {
          posterUri = existingPoster;
          thumbnailUri = existingPoster;
        } else {
          const generatedPoster = await ensureVideoPosterForUrl(videoUrlStr);
          if (generatedPoster) {
            posterUri = generatedPoster;
            thumbnailUri = generatedPoster;
          }
        }
      }

      const usingBranded = !isUsableVideoPosterUri(posterUri, videoUrlStr);
      if (usingBranded) {
        const branded = brandedVideoPosterFields();
        posterUri = branded.posterUri;
        thumbnailUri = branded.thumbnailUri;
        videoBrandedPoster = true;
      }

      if (postId) {
        void upsertFeedItem({
          ...item,
          posterUri,
          videoPosterUri: posterUri,
          thumbnailUri,
          ...(usingBranded ? brandedVideoPosterFields() : {}),
        }).catch(() => {});
      }
    }
  }

  const videoPosterUri = posterUri || thumbnailUri;

  if (postId) {
    console.log("KRISTO_FEED_AUTHOR_ENRICH", {
      postId,
      churchId: itemChurchId,
      source: authorEnrichment.source,
      authorName: itemChurchName,
      mediaName: itemMediaName,
      authorAvatarUri: authorEnrichment.authorAvatarUri || "",
      churchAvatarUri: authorEnrichment.churchAvatarUri || "",
      churchAvatarUpdatedAt: authorEnrichment.churchAvatarUpdatedAt || null,
      churchLogoUrl: authorEnrichment.churchLogoUrl || "",
      mediaAvatarUri: authorEnrichment.mediaAvatarUri || "",
      mediaLogoUrl: authorEnrichment.mediaLogoUrl || "",
      finalAvatarUri: authorEnrichment.finalAvatarUri || "",
    });
  }

  const churchAvatarUpdatedAt = authorEnrichment.churchAvatarUpdatedAt;

  const postIdAliases = commentPostIdAliases(item, postId);
  let discussion = { commentCount: 0, replyCount: 0 };
  if (postId) {
    if (engagement?.discussionByPostId.has(postId)) {
      discussion = engagement.discussionByPostId.get(postId)!;
    } else {
      const map = await countDiscussionForPostIds([postId]);
      discussion = map.get(postId) || discussion;
    }
  }
  const likeMeta = postId
    ? await getPostLikeMeta(itemChurchId, postId, viewerUserId, postIdAliases)
    : { likeCount: 0, likedByMe: false };

  return withVideoMetadataReturnFields({
    ...item,
    ...(posterUri ? { posterUri } : {}),
    ...(thumbnailUri ? { thumbnailUri } : {}),
    ...(videoPosterUri ? { videoPosterUri } : {}),
    ...(videoBrandedPoster ? { brandedPoster: true } : {}),
    ownershipType,
    ownerChurchId: String(item?.ownerChurchId || itemChurchId || ""),
    ownerMediaId: String(item?.ownerMediaId || item?.mediaName || itemMediaProfile?.mediaName || "").trim() || undefined,
    authorName: author.authorName,
    authorAvatarUri: authorEnrichment.finalAvatarUri || authorEnrichment.authorAvatarUri,
    churchName: itemChurchName,
    churchAvatarUri: authorEnrichment.churchAvatarUri,
    ...(churchAvatarUpdatedAt
      ? { churchAvatarUpdatedAt, avatarUpdatedAt: churchAvatarUpdatedAt }
      : {}),
    ...(authorEnrichment.churchLogoUrl ? { churchLogoUrl: authorEnrichment.churchLogoUrl } : {}),
    ...(authorEnrichment.mediaAvatarUri ? { mediaAvatarUri: authorEnrichment.mediaAvatarUri } : {}),
    ...(authorEnrichment.mediaLogoUrl ? { mediaLogoUrl: authorEnrichment.mediaLogoUrl } : {}),
    churchCountry: String((itemChurchProfile as any)?.country || "").trim(),
    churchProvince: String((itemChurchProfile as any)?.province || "").trim(),
    churchCity: String((itemChurchProfile as any)?.city || "").trim(),
    churchNormalizedCountry: String((itemChurchProfile as any)?.normalizedCountry || "").trim(),
    churchNormalizedProvince: String((itemChurchProfile as any)?.normalizedProvince || "").trim(),
    churchNormalizedCity: String((itemChurchProfile as any)?.normalizedCity || "").trim(),
    churchPrimaryLanguage: String((itemChurchProfile as any)?.primaryLanguage || "").trim(),
    churchPhoneCountryCode: String((itemChurchProfile as any)?.phoneCountryCode || "").trim(),
    mediaName: itemMediaName,
    scheduleSlots: enrichScheduleSlotsClaimAvatars(
      Array.isArray(item?.scheduleSlots) ? item.scheduleSlots : []
    ),
    commentCount: discussion.commentCount,
    replyCount: discussion.replyCount,
    totalDiscussionCount: discussion.commentCount + discussion.replyCount,
    likeCount: likeMeta.likeCount,
    likedByMe: likeMeta.likedByMe,
  });
}

async function safeEnrichFeedListItem(
  item: any,
  viewerUserId: string,
  engagement?: FeedListEngagementMeta
) {
  try {
    return await enrichFeedListItem(item, viewerUserId, engagement);
  } catch (error) {
    console.error("[church/feed] enrich item failed", {
      postId: String(item?.id || ""),
      error: error instanceof Error ? error.message : String(error),
    });
    const postId = String(item?.id || "").trim();
    const itemChurchId = String(item?.churchId || "").trim();
    const discussion =
      (postId && engagement?.discussionByPostId.get(postId)) ||
      { commentCount: 0, replyCount: 0 };
    const likeMeta = postId
      ? await getPostLikeMeta(
          itemChurchId,
          postId,
          viewerUserId,
          commentPostIdAliases(item, postId)
        ).catch(() => ({
          likeCount: 0,
          likedByMe: false,
        }))
      : { likeCount: 0, likedByMe: false };
    const fallbackAuthor = publicUser(item?.createdBy);
    const ownershipType = inferOwnershipType(item);
    const authorEnrichment = resolveFeedAuthorEnrichment({
      item,
      itemChurchProfile: null,
      itemMediaProfile: null,
      ownershipType,
      fallbackAuthor,
    });
    return {
      ...item,
      ownershipType,
      authorName: fallbackAuthor.authorName,
      authorAvatarUri: authorEnrichment.finalAvatarUri || authorEnrichment.authorAvatarUri,
      churchAvatarUri: authorEnrichment.churchAvatarUri,
      ...(authorEnrichment.churchLogoUrl ? { churchLogoUrl: authorEnrichment.churchLogoUrl } : {}),
      ...(authorEnrichment.mediaAvatarUri ? { mediaAvatarUri: authorEnrichment.mediaAvatarUri } : {}),
      ...(authorEnrichment.mediaLogoUrl ? { mediaLogoUrl: authorEnrichment.mediaLogoUrl } : {}),
      scheduleSlots: enrichScheduleSlotsClaimAvatars(
        Array.isArray(item?.scheduleSlots) ? item.scheduleSlots : []
      ),
      commentCount: discussion.commentCount,
      replyCount: discussion.replyCount,
      totalDiscussionCount: discussion.commentCount + discussion.replyCount,
      likeCount: likeMeta.likeCount,
      likedByMe: likeMeta.likedByMe,
    };
  }
}

async function viewerHasActiveChurchMembership(churchId: string, userId?: string) {
  const cid = String(churchId || "").trim();
  if (!cid) return false;
  if (!userId) return true;
  const active = await getActiveMembership(userId);
  return !!active && String(active.churchId || "").trim() === cid;
}

function feedItemVisibility(item: any) {
  return String(item?.visibility || item?.audience || "public").toLowerCase();
}

function isDiscoverableFeedItem(item: any, viewerChurchId: string) {
  const itemChurchId = String(item?.churchId || "").trim();
  const viewerCid = String(viewerChurchId || "").trim();

  if (isMediaScheduleFeedItem(item)) {
    if (!viewerCid) return false;
    if (!itemChurchId) return true;
    return itemChurchId === viewerCid;
  }

  const visibility = feedItemVisibility(item);
  const member = Boolean(String(viewerChurchId || "").trim());

  if (visibility.includes("church")) {
    return member && itemChurchId === viewerCid;
  }

  if (member) {
    if (
      visibility.includes("public") ||
      visibility.includes("global") ||
      visibility.includes("members")
    ) {
      return true;
    }

    return itemChurchId === viewerCid;
  }

  return visibility.includes("public") || visibility.includes("global");
}

async function resolveViewerChurchId(
  req: NextRequest,
  headerChurchId: string,
  viewerUserId: string,
  viewerRole: string
) {
  const fromHeader = String(headerChurchId || "").trim();

  await ensureActiveMembershipForSession({
    userId: viewerUserId,
    churchId: fromHeader,
    role: viewerRole,
  });

  const membershipOrRes = await guard(req);
  if (membershipOrRes instanceof NextResponse) {
    const active = await getActiveMembership(viewerUserId);
    return String(active?.churchId || fromHeader).trim();
  }

  return String(membershipOrRes.churchId || fromHeader).trim();
}

async function buildCommentTree(
  _itemChurchId: string,
  canonicalPostId: string,
  viewerUserId: string,
  extraPostIds: string[] = []
): Promise<FeedCommentTree[]> {
  const postIds = commentPostIdAliases({ id: canonicalPostId }, canonicalPostId);
  for (const extra of extraPostIds) {
    const v = String(extra || "").trim();
    if (v) postIds.add(v);
  }

  const all = (await listCommentsForPostIds(postIds))
    .slice()
    .sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));

  const roots = all.filter((x) => !x.parentCommentId);
  const replies = all.filter((x) => !!x.parentCommentId);
  const commentIds = all.map((x) => String(x.id || "")).filter(Boolean);
  const likeMeta = await getCommentLikeMetaForIds(commentIds, viewerUserId);
  const identityByUser = await hydrateCommentIdentityMap(all);

  return Promise.all(
    roots.map(async (root) => {
      const rootLikes = likeMeta.get(root.id) || { likeCount: 0, likedByMe: false };
      const enrichedRoot = await enrichComment(root, identityByUser);
      return {
        ...enrichedRoot,
        likeCount: rootLikes.likeCount,
        likedByMe: rootLikes.likedByMe,
        replies: await Promise.all(
          replies
            .filter((r) => r.parentCommentId === root.id)
            .slice()
            .sort((a, b) => (a.createdAt < b.createdAt ? -1 : 1))
            .map(async (reply) => {
              const replyLikes = likeMeta.get(reply.id) || { likeCount: 0, likedByMe: false };
              const enrichedReply = await enrichComment(reply, identityByUser);
              return {
                ...enrichedReply,
                likeCount: replyLikes.likeCount,
                likedByMe: replyLikes.likedByMe,
              };
            })
        ),
      };
    })
  );
}

function emptyFeedListResponse(churchId: string) {
  return feedListOk(churchId, []);
}

export async function GET(req: NextRequest) {
  let churchIdForFallback = String(req.headers.get("x-kristo-church-id") || "").trim();

  try {
    return await Promise.race([
      handleFeedGet(req, () => churchIdForFallback, (next) => {
        churchIdForFallback = next;
      }),
      new Promise<NextResponse>((resolve) => {
        setTimeout(() => {
          console.error("[church/feed] GET timed out", { churchId: churchIdForFallback });
          resolve(emptyFeedListResponse(churchIdForFallback));
        }, FEED_GET_TIMEOUT_MS);
      }),
    ]);
  } catch (error: any) {
    console.error("[church/feed] GET failed", {
      churchId: churchIdForFallback,
      message: error?.message,
      stack: error?.stack,
    });
    return emptyFeedListResponse(churchIdForFallback);
  }
}

async function handleFeedGet(
  req: NextRequest,
  getFallbackChurchId: () => string,
  setFallbackChurchId: (next: string) => void
) {
  resetFeedEnrichCaches();

  try {
    try {
      await ensureFeedStoreReady();
    } catch (error: any) {
      if (isFeedDatabaseError(error)) {
        console.error("[church/feed] GET feed store unavailable", {
          error: error instanceof Error ? error.message : String(error),
        });
        return emptyFeedListResponse(getFallbackChurchId());
      }
      throw error;
    }

    try {
      await ensureCommentStoreReady();
    } catch (error: any) {
      if (isCommentDatabaseError(error)) {
        console.warn("[church/feed] GET comment store unavailable", {
          mode: resolveCommentStoreMode(),
          error: error instanceof Error ? error.message : String(error),
        });
      } else {
        throw error;
      }
    }

    logCommentStoreEvent({ op: "read", count: 0, detail: "feed-get-start" });

    const ctxOrRes = await guardAuth(req);
    if ("ok" in (ctxOrRes as any) === false && ctxOrRes instanceof NextResponse) return ctxOrRes;

    const ctx = ctxOrRes as any;
    const headerChurchId = String(ctx?.viewer?.churchId || "").trim();
    const viewerUserId = String(ctx?.viewer?.userId || ctx?.viewer?.id || "u-unknown");
    const viewerRole = String(ctx?.viewer?.role || "Member").trim();
    const churchId = await resolveViewerChurchId(req, headerChurchId, viewerUserId, viewerRole);
    setFallbackChurchId(churchId || getFallbackChurchId());
    const url = new URL(req.url);

    const type = url.searchParams.get("type") as FeedType | null;
    const id = String(url.searchParams.get("id") || "").trim();
    const storageMode = String(url.searchParams.get("storage") || "").trim().toLowerCase();

    if (storageMode === "media" || storageMode === "church") {
      const membershipOrRes = await guard(req);
      if ("ok" in (membershipOrRes as any) === false && membershipOrRes instanceof NextResponse) {
        return membershipOrRes;
      }

      const membershipCtx = membershipOrRes as any;
      const viewerChurchId = String(membershipCtx.churchId || "").trim();
      const viewerRole = membershipCtx?.viewer?.role;

      if (!viewerChurchId) {
        return err("Active church membership required", 403);
      }

      if (storageMode === "media" && !(await canAccessMediaStorage(viewerChurchId, viewerRole, viewerUserId))) {
        return err("Pastor or media host access required", 403);
      }

      if (storageMode === "church" && !isPastorOrAdminRole(viewerRole)) {
        return err("Pastor or admin access required", 403);
      }

      const storageItems = (await listFeedItems())
        .filter((x: any) => String(x?.churchId || "") === viewerChurchId)
        .filter((x: any) => (storageMode === "media" ? isMediaOwnedFeedItem(x) : true))
        .filter((x) => (type ? x.type === type : true))
        .slice()
        .sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1))
        .map((item) => safeEnrichFeedListItem(item, viewerUserId));

      const resolvedStorageItems = await Promise.all(storageItems);

      return feedListOk(viewerChurchId, resolvedStorageItems);
    }

    if (url.searchParams.get("debug") === "feed") {
      const all = await listFeedItems();
      const byChurch = await listFeedItemsForChurch(churchId);
      return ok({
        churchId,
        headerChurchId,
        totalAll: all.length,
        totalByChurch: byChurch.length,
        mediaAll: all.filter((x: any) => String(x?.source || "") === "media-upload").map((x: any) => ({
          id: x.id,
          churchId: x.churchId,
          ownerChurchId: x.ownerChurchId,
          source: x.source,
          type: x.type,
          mediaStatus: x.mediaStatus,
          hasVideoUrl: Boolean(x.videoUrl),
        })).slice(0, 10),
      });
    }

    if (id) {
      const item = await getFeedItemById(id);
      if (!item) return err("Feed item not found", 404);

      const viewerChurchId = String(churchId || "").trim();
      const itemChurchId = String(item.churchId || "").trim();
      const requestPostId = String(id || "").trim();
      const canonicalPostId = String(item.id || requestPostId).trim();

      console.log("KRISTO_COMMENT_READ_SCOPE", {
        viewerChurchId,
        itemChurchId,
        postId: canonicalPostId,
        viewerUserId,
      });

      if (!isDiscoverableFeedItem(item, churchId)) {
        return err("Feed item not found", 404);
      }

      if (isClaimableScheduleFeedItem(item) && !(await viewerHasActiveChurchMembership(churchId, viewerUserId))) {
        return err("Feed item not found", 404);
      }

      const postIdAliases = commentPostIdAliases(item, requestPostId);
      const discussion = await countDiscussionForPostIdSet(postIdAliases);
      const commentCount = discussion.commentCount;
      const replyCount = discussion.replyCount;
      const comments = await buildCommentTree(
        itemChurchId,
        canonicalPostId,
        viewerUserId,
        requestPostId !== canonicalPostId ? [requestPostId] : []
      );

      console.log("KRISTO_COMMENT_BACKEND_READ", {
        postId: canonicalPostId,
        requestPostId,
        itemChurchId,
        viewerChurchId,
        storeMode: resolveCommentStoreMode(),
        totalForPost: comments.length,
        ids: comments.map((c) => c.id),
      });

      const detail: FeedPostDetail = {
        item: {
          ...item,
          commentCount,
          replyCount,
          totalDiscussionCount: commentCount + replyCount,
        },
        comments,
      };

      return ok(detail);
    }

    let rawRows = await listFeedItemsForChurch(churchId);
    if (rawRows.length === 0) {
      const fallbackRows = await listFeedItems();
      rawRows = fallbackRows.filter((x: any) => {
        const cid = String(x?.churchId || "").trim();
        const ownerCid = String(x?.ownerChurchId || "").trim();
        return cid === churchId || ownerCid === churchId;
      });
    }
    const allRows = rawRows.filter((x: any) => {
      const isMediaUpload =
        String(x?.source || "") === "media-upload" ||
        String(x?.ownershipType || "") === "media";
      const hasRemoteVideo =
        String(x?.videoUrl || x?.videoUri || x?.mediaUrl || "").startsWith("http");
      if (isMediaUpload && hasRemoteVideo) return true;
      return feedVideoAssetExists(x);
    });
    console.log("[FeedDb] list churchId count scheduleCount", {
      churchId,
      count: allRows.length,
      scheduleCount: countScheduleFeedItems(allRows),
    });
    console.log("[ScheduleFeed] GET rows before filter", {
      churchId,
      headerChurchId,
      total: allRows.length,
      scheduleCandidates: allRows.filter((x) => isMediaScheduleFeedItem(x)).length,
    });

    console.log("KRISTO_FEED_DEBUG_COUNTS", {
      churchId,
      rawRows: rawRows.length,
      afterAsset: allRows.length,
      mediaRaw: rawRows.filter((x: any) => String(x?.source || "") === "media-upload").length,
      mediaAfterAsset: allRows.filter((x: any) => String(x?.source || "") === "media-upload").length,
    });

    const afterDiscover = allRows.filter((x: any) => isDiscoverableFeedItem(x, churchId));
    const homeReadyRows = afterDiscover.filter((x: any) => isHomeFeedReadyItem(x));

    console.log("KRISTO_FEED_DEBUG_AFTER_FILTERS", {
      churchId,
      afterDiscover: afterDiscover.length,
      homeReadyRows: homeReadyRows.length,
      mediaAfterDiscover: afterDiscover.filter((x: any) => String(x?.source || "") === "media-upload").length,
      mediaHomeReady: homeReadyRows.filter((x: any) => String(x?.source || "") === "media-upload").length,
    });

    if (process.env.NODE_ENV !== 'production') {
      const skipped = afterDiscover.length - homeReadyRows.length;
      if (skipped > 0) {
        console.log("KRISTO_HOME_FEED_MEDIA_STATUS_FILTER", {
          churchId,
          skipped,
          kept: homeReadyRows.length,
        });
      }
    }

    console.log("[ScheduleFeed] GET rows after church filter", {
      churchId,
      total: homeReadyRows.length,
      scheduleCandidates: homeReadyRows.filter((x) => isMediaScheduleFeedItem(x)).length,
    });

    const hasMembership = await viewerHasActiveChurchMembership(churchId, viewerUserId);

    const forcedMediaHomeRows = rawRows.filter((x: any) => {
      const sameChurch =
        String(x?.churchId || "").trim() === churchId ||
        String(x?.ownerChurchId || "").trim() === churchId;
      const isMediaUpload = String(x?.source || "").toLowerCase() === "media-upload";
      const isReady = String(x?.mediaStatus || "ready").toLowerCase() === "ready";
      const hasVideo = Boolean(String(x?.videoUrl || x?.videoUri || x?.mediaUrl || "").trim());
      return sameChurch && isMediaUpload && isReady && hasVideo;
    });

    const mergedHomeRows = [...forcedMediaHomeRows, ...homeReadyRows].filter(
      (x: any, idx, arr) => arr.findIndex((y: any) => String(y?.id || "") === String(x?.id || "")) === idx
    );

    const listRows = mergedHomeRows
      .filter((x: any) => {
        if (isClaimableScheduleFeedItem(x) && !hasMembership) {
          return false;
        }
        if (isClaimableScheduleFeedItem(x)) {
          const itemCid = String(x?.churchId || "").trim();
          if (itemCid && churchId && itemCid !== churchId) return false;
        }
        return true;
      })
      .filter((x) => (type ? x.type === type : true))
      .slice()
      .sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));

    const listPostIds = listRows
      .map((x: any) => String(x?.id || "").trim())
      .filter(Boolean);
    const discussionByPostId = await countDiscussionForPostIds(listPostIds);
    const listEngagement: FeedListEngagementMeta = { discussionByPostId };

    const items = listRows.map((item) =>
      safeEnrichFeedListItem(item, viewerUserId, listEngagement)
    );

    const resolvedItems = await Promise.all(items);

    const scheduleRows = resolvedItems.filter((x: any) => isMediaScheduleFeedItem(x));
    console.log("KRISTO_FEED_SCHEDULES_RETURNED", {
      churchId,
      headerChurchId,
      viewerUserId,
      viewerRole,
      hasMembership,
      total: resolvedItems.length,
      scheduleCount: scheduleRows.length,
      scheduleIds: scheduleRows.map((x: any) => String(x?.id || "")),
    });
    console.log("[ScheduleFeed] GET schedule rows returned", {
      churchId,
      scheduleCount: scheduleRows.length,
      scheduleIds: scheduleRows.map((x: any) => String(x?.id || "")),
    });

    console.log("KRISTO_FEED_GET_VIDEO_ROWS", {
      total: resolvedItems.length,
      videoRows: resolvedItems.filter(
        (x: any) => x?.type === "video" || x?.videoUrl
      ).length,
    });

    return feedListOk(churchId, resolvedItems);
  } catch (error: any) {
    console.error("[church/feed] GET handler failed", {
      churchId: getFallbackChurchId(),
      message: error?.message,
      stack: error?.stack,
    });
    return emptyFeedListResponse(getFallbackChurchId());
  }
}

export async function POST(req: NextRequest) {
  let body: any = null;
  try {
    await ensureFeedStoreReady();
  } catch (error: any) {
    if (isFeedDatabaseError(error)) {
      return err("Feed database not configured", 503);
    }
    throw error;
  }

  try {
    await ensureCommentStoreReady();
  } catch (error: any) {
    if (isCommentDatabaseError(error)) {
      return err("Comment storage not configured for this deployment", 503);
    }
    throw error;
  }

  try {
    body = await req.json();
  } catch {
    return err("Invalid JSON body", 400);
  }

  if (isIncomingMediaScheduleCreate(body)) {
    console.log("[ScheduleFeed] POST body", {
      action: String(body?.action || "create_post"),
      churchId: String(body?.churchId || ""),
      source: String(body?.source || ""),
      scheduleType: String(body?.scheduleType || ""),
      sourceScheduleId: String(body?.sourceScheduleId || body?.liveId || ""),
      slotCount: Array.isArray(body?.scheduleSlots) ? body.scheduleSlots.length : 0,
      visibility: String(body?.visibility || ""),
    });
  }

  try {
    return await handleFeedPost(req, body);
  } catch (error: any) {
    console.error("[ScheduleFeed] POST unhandled error", {
      message: error?.message,
      stack: error?.stack,
      body,
    });
    return NextResponse.json(
      { ok: false, error: error?.message || "Internal feed error" },
      { status: 500 }
    );
  }
}

async function handleFeedPost(req: NextRequest, body: any) {
  const action = String(body?.action || "create_post").trim();
  const ctxOrRes =
    action === "toggle_like" ? await guardAuth(req) : await guard(req);
  if ("ok" in (ctxOrRes as any) === false && ctxOrRes instanceof NextResponse) return ctxOrRes;

  const ctx = ctxOrRes as any;
  const churchId =
    action === "toggle_like"
      ? String(ctx?.viewer?.churchId || ctx?.churchId || "").trim()
      : String(ctx.churchId || "");
  const viewerUserId = String(ctx?.viewer?.userId || ctx?.viewer?.id || "u-unknown");

  console.log("KRISTO_FEED_POST_ACTION_RECEIVED", {
    action,
    hasPostId: Boolean(body?.postId),
    postId: String(body?.postId || ""),
    hasText: Boolean(body?.text),
    userId: viewerUserId,
  });

  const viewerName = String(ctx?.viewer?.name || "").trim();
  const actorLabel = viewerName || viewerUserId;

  if (["add_comment", "add_reply"].includes(action) && !String(churchId || "").trim()) {
    return err("Join a church to comment", 403);
  }

  if (action === "clear_media_schedules") {
    const role = String(ctx?.viewer?.role || ctx?.role || req.headers.get("x-kristo-role") || "").toLowerCase();
    const isPastorOrAdmin =
      role.includes("pastor") ||
      role.includes("admin") ||
      role.includes("leader");

    const targetChurchId = String(body?.churchId || churchId || "").trim();
    if (!targetChurchId) return err("churchId is required", 400);

    const mediaProfile: any = await churchMediaFor(targetChurchId);
    const mediaHosts = Array.isArray(mediaProfile?.hosts) ? mediaProfile.hosts : [];
    const isMediaHost = mediaHosts.some(
      (h: any) => String(h?.userId || h?.id || "") === viewerUserId
    );

    if (!isPastorOrAdmin && !isMediaHost) {
      return err("Only pastor or approved media host can clear media schedules", 403);
    }

    const removedCount = await deleteFeedItemsWhere((it: any) =>
      isMediaScheduleForChurch(it, targetChurchId)
    );

    bumpMediaScheduleSync(targetChurchId, "clear_media_schedules");

    const remainingRows = await listFeedItems();
    const remainingActiveSchedules = findAllActiveMediaSchedulesForChurch(
      remainingRows,
      targetChurchId,
      { strictChurch: true }
    ).map((item) => summarizeActiveMediaSchedule(item));

    const result = {
      churchId: targetChurchId,
      removed: removedCount,
      removedCount,
      remaining: remainingRows.length,
      remainingActiveCount: remainingActiveSchedules.length,
      remainingActiveSchedules,
      role,
      isPastorOrAdmin,
      isMediaHost,
      clearedBy: viewerUserId,
    };

    console.log("KRISTO_DEL_OLD_BACKEND_RESULT", result);
    console.log("KRISTO_MEDIA_CLEAR_SCHEDULES_RESULT", result);

    return ok(result);
  }

  if (action === "toggle_like") {
    const requestPostId = cleanText(body?.postId, 240);

    if (!requestPostId) return err("postId is required", 400);

    const item = await getFeedItemById(requestPostId);

    if (!item) return err("Feed item not found", 404);

    const itemChurchId = String(item.churchId || churchId);
    const canonicalPostId = String(item.id || requestPostId).trim();

    const wantsLiked =
      typeof body?.liked === "boolean" ? Boolean(body.liked) : null;

    const likeResult = await togglePostLike({
      churchId: itemChurchId,
      postId: canonicalPostId,
      viewerUserId,
      wantsLiked,
    });

    console.log("KRISTO_POST_LIKE_TOGGLE", {
      postId: canonicalPostId,
      viewerUserId,
      likedByMe: likeResult.likedByMe,
      likeCount: likeResult.likeCount,
    });

    return ok({
      postId: canonicalPostId,
      likedByMe: likeResult.likedByMe,
      likeCount: likeResult.likeCount,
    });
  }

  if (action === "add_comment" || action === "add_reply") {
    const postId = cleanText(body?.postId, 240);
    const text = cleanText(body?.text, 5000);

    if (!postId) return err("postId is required", 400);
    if (!text) return err("text is required", 400);

    const requestPostId = postId;
    const item = await getFeedItemById(requestPostId);

    if (!item) return err("Feed item not found", 404);

    const itemChurchId = String(item.churchId || churchId);
    const canonicalPostId = String(item.id || requestPostId).trim();

    console.log("KRISTO_COMMENT_BACKEND_WRITE_START", {
      postId: canonicalPostId,
      requestPostId,
      userId: viewerUserId,
      storeMode: resolveCommentStoreMode(),
      text: text.slice(0, 120),
    });

    const author = await resolveCommentAuthorSnapshot(viewerUserId, ctx);

    const comment: FeedComment = {
      id: makeId("comment"),
      churchId: itemChurchId,
      postId: canonicalPostId,
      parentCommentId:
        action === "add_reply"
          ? cleanText(body?.parentCommentId, 240)
          : undefined,
      text,
      createdAt: new Date().toISOString(),
      createdBy: viewerUserId,
      authorName: author.authorName,
      authorAvatarUri: author.authorAvatarUri,
      authorInitial: author.authorInitial,
    };

    await insertFeedComment(comment);

    const postIdAliases = commentPostIdAliases(item, requestPostId);
    const discussion = await countDiscussionForPostIdSet(postIdAliases);

    console.log("KRISTO_COMMENT_BACKEND_WRITE_DONE", {
      postId: canonicalPostId,
      requestPostId,
      commentId: comment.id,
      storeMode: resolveCommentStoreMode(),
      totalForPost: discussion.commentCount + discussion.replyCount,
    });

    const identityByUser = await hydrateCommentIdentityMap([comment]);

    return ok({
      comment: await enrichComment(comment, identityByUser),
      commentCount: discussion.commentCount,
      replyCount: discussion.replyCount,
    });
  }

  if (action === "toggle_comment_like") {
    const commentId = cleanText(body?.commentId, 240);

    if (!commentId) return err("commentId is required", 400);

    const comment = await findFeedCommentById(commentId);

    if (!comment) return err("Comment not found", 404);

    const likeResult = await toggleCommentLike({
      churchId: comment.churchId,
      commentId,
      viewerUserId,
    });

    return ok({
      commentId,
      likedByMe: likeResult.likedByMe,
      likeCount: likeResult.likeCount,
    });
  }


  if (action === "update-schedule-slots") {
    const postId = cleanText(body?.postId || body?.feedId, 240);
    const slotId = cleanText(body?.slotId, 240);
    const minutes = Number(body?.minutes || 0);
    const nextSlots = Array.isArray(body?.slots) ? body.slots : null;

    if (!postId) return err("postId/feedId is required", 400);

    const item = await getFeedItemById(postId);
    if (!item) return err("Feed item not found", 404);

    const viewerAppRole = String(ctx?.viewer?.role || ctx?.role || "");
    const permissionErr = await assertScheduleEditPermission({
      churchId,
      viewerUserId,
      viewerAppRole,
      item,
      body,
    });
    if (permissionErr) return err(permissionErr, 403);

    const ministryId = resolveScheduleMinistryId(item, body);
    const slots = Array.isArray((item as any).scheduleSlots) ? (item as any).scheduleSlots : [];

    function addMinutesToClock(timeText: string, minutesToAdd: number) {
      const match = String(timeText || "").trim().match(/^(\d{1,2})(?::(\d{2}))?\s*(AM|PM)?$/i);
      if (!match) return timeText;

      let hour = Number(match[1] || 0);
      const minute = Number(match[2] || 0);
      const meridiem = String(match[3] || "").toUpperCase();

      if (meridiem === "PM" && hour < 12) hour += 12;
      if (meridiem === "AM" && hour === 12) hour = 0;

      const date = new Date();
      date.setHours(hour, minute + minutesToAdd, 0, 0);

      return date.toLocaleTimeString("en-US", {
        hour: "numeric",
        minute: "2-digit",
        hour12: true,
      });
    }

    if (nextSlots) {
      const updatedItem = { ...item, scheduleSlots: nextSlots };
      await upsertFeedItem(updatedItem);
      bumpMediaScheduleSyncForFeedItem(updatedItem, "update-schedule-slots");

      const firstSlot = nextSlots[0];
      void notifyScheduleSlotEdit({
        churchId,
        editorUserId: viewerUserId,
        editorName: actorLabel,
        editorAppRole: viewerAppRole,
        ministryId,
        slotLabel: formatScheduleSlotLabel(firstSlot),
      });

      return ok({ postId, slots: nextSlots });
    }

    if (!slotId) return err("slotId is required", 400);

    const targetIndex = slots.findIndex((slot: any) => String(slot?.id || "") === String(slotId));
    if (targetIndex < 0) return err("Slot not found", 404);

    let previousEnd = "";

    const updated = slots.map((slot: any, index: number) => {
      const current = { ...slot };

      if (index < targetIndex) {
        previousEnd = String(current.endTime || previousEnd || "");
        return current;
      }

      if (index === targetIndex) {
        const startTime = String(current.startTime || "");
        const currentDuration = Number(current.durationMin || 1);
        const nextDuration = Math.max(1, currentDuration + minutes);
        const endTime = startTime ? addMinutesToClock(startTime, nextDuration) : current.endTime;
        const timeLabel = startTime && endTime ? `${startTime} - ${endTime}` : current.timeLabel;

        previousEnd = String(endTime || previousEnd || "");

        return {
          ...current,
          durationMin: nextDuration,
          endTime,
          timeLabel,
          manuallyModified: true,
        };
      }

      const duration = Number(current.durationMin || 1);
      const startTime = previousEnd || current.startTime;
      const endTime = startTime ? addMinutesToClock(startTime, duration) : current.endTime;
      const timeLabel = startTime && endTime ? `${startTime} - ${endTime}` : current.timeLabel;
      previousEnd = String(endTime || previousEnd || "");

      return {
        ...current,
        startTime,
        endTime,
        timeLabel,
      };
    });

    const updatedItem = { ...item, scheduleSlots: updated };
    await upsertFeedItem(updatedItem);
    bumpMediaScheduleSyncForFeedItem(updatedItem, "update-schedule-slots");

    void notifyScheduleSlotEdit({
      churchId,
      editorUserId: viewerUserId,
      editorName: actorLabel,
      editorAppRole: viewerAppRole,
      ministryId,
      slotLabel: formatScheduleSlotLabel(updated[targetIndex]),
    });

    return ok({ postId, slotId, slots: updated, slot: updated[targetIndex] });
  }

  if (action === "claim_schedule_slot") {
    if (!(await viewerHasActiveChurchMembership(churchId, viewerUserId))) {
      return err("Join a church to claim schedule slots", 403);
    }

    const postId = cleanText(body?.postId, 240);
    const slotId = cleanText(body?.slotId, 240);
    const claim = body?.claim || {};

    if (!postId) return err("postId is required", 400);
    if (!slotId) return err("slotId is required", 400);

    const item = await getFeedItemById(postId);
    if (!item) return err("Feed item not found", 404);

    const slots = Array.isArray((item as any).scheduleSlots) ? (item as any).scheduleSlots : [];
    const slotIndex = slots.findIndex((slot: any) => String(slot?.id || "") === String(slotId));
    if (slotIndex < 0) return err("Slot not found", 404);

    const existing = slots[slotIndex] || {};
    const existingOwner = String(
      existing.claimedByUserId ||
      existing.claimedBy?.userId ||
      ""
    ).trim();

    if (existingOwner && existingOwner !== viewerUserId) {
      return err("Slot already claimed", 409);
    }

    const name = cleanText(claim?.name || actorLabel || "Church Member", 240) || "Church Member";
    const role = cleanText(claim?.role || ctx?.viewer?.role || "Member", 120) || "Member";
    const avatarUri =
      cleanText(
        claim?.avatarUri ||
          claim?.avatarUrl ||
          claim?.claimedByAvatarUri ||
          profileAvatarForUserId(viewerUserId) ||
          "",
        2000
      ) || "";

    slots[slotIndex] = {
      ...existing,
      claimed: true,
      isClaimed: true,
      status: "claimed",
      claimedByUserId: viewerUserId,
      claimedByName: name,
      claimedByAvatarUri: avatarUri,
      claimedByAvatar: avatarUri,
      claimedBy: {
        slotId,
        userId: viewerUserId,
        name,
        role,
        avatarUri,
      },
    };

    const updatedItem = { ...item, scheduleSlots: slots };
    await upsertFeedItem(updatedItem);
    bumpMediaScheduleSyncForFeedItem(updatedItem, "claim_schedule_slot");

    return ok({
      postId: String(item.id || postId),
      slotId,
      slot: slots[slotIndex],
    });
  }

  if (action === "unclaim_schedule_slot") {
    const postId = cleanText(body?.postId || body?.feedId, 240);
    const slotId = cleanText(body?.slotId, 240);
    const targetUserId = cleanText(body?.userId || viewerUserId, 240);

    if (!postId) return err("postId is required", 400);
    if (!slotId) return err("slotId is required", 400);

    const item = await getFeedItemById(postId);
    if (!item) return err("Feed item not found", 404);

    const slots = Array.isArray((item as any).scheduleSlots) ? (item as any).scheduleSlots : [];
    const slotIndex = slots.findIndex((slot: any) => String(slot?.id || "") === String(slotId));
    if (slotIndex < 0) return err("Slot not found", 404);

    const existing = slots[slotIndex] || {};
    const existingOwner = String(
      existing.claimedByUserId || existing.claimedBy?.userId || ""
    ).trim();

    if (existingOwner && targetUserId && existingOwner !== targetUserId) {
      return err("Slot claimed by another member", 409);
    }

    const nextSlot = { ...existing };
    delete nextSlot.claimed;
    delete nextSlot.isClaimed;
    delete nextSlot.claimedByUserId;
    delete nextSlot.claimedByName;
    delete nextSlot.claimedByAvatar;
    delete nextSlot.claimedByAvatarUri;
    delete nextSlot.claimedBy;
    delete nextSlot.claimedAt;
    nextSlot.status = "open";
    nextSlot.approved = false;
    nextSlot.locked = false;

    slots[slotIndex] = nextSlot;

    const updatedItem = { ...item, scheduleSlots: slots };
    await upsertFeedItem(updatedItem);
    bumpMediaScheduleSyncForFeedItem(updatedItem, "unclaim_schedule_slot");

    return ok({
      postId,
      slotId,
      slot: slots[slotIndex],
    });
  }

  if (action === "delete_post") {
    const postId = cleanText(body?.postId || body?.feedId || body?.id, 240);
    if (!postId) return err("postId is required", 400);

    const item = await getFeedItemById(postId);
    if (!item) return err("Feed item not found", 404);

    const itemChurchId = String(item?.churchId || churchId || "").trim();
    if (!itemChurchId || itemChurchId !== String(churchId || "").trim()) {
      return err("Feed item not in your church", 403);
    }

    const viewerRole = ctx?.viewer?.role;
    if (!(await canDeleteFeedPost(item, churchId, viewerRole, viewerUserId))) {
      return err("Forbidden", 403);
    }

    if (isClaimableScheduleFeedItem(item)) {
      bumpMediaScheduleSyncForFeedItem(item, "delete_post");
    }

    await removePostAndRelated(String(item.id || postId));

    const deletedId = String(item.id || postId);
    return NextResponse.json({
      ok: true,
      data: { postId: deletedId, deleted: true },
      postId: deletedId,
      deleted: true,
    });
  }

  // back-compat/default: create post
  const type = body?.type as FeedType | undefined;
  if (!type || !["post", "announcement", "video"].includes(type)) {
    return err('type is required: "post" | "announcement" | "video"', 400);
  }

  const title = cleanText(body?.title, 240) || undefined;
  const text = cleanText(body?.text, 5000) || undefined;
  const videoUrl = cleanText(body?.videoUrl, 2000) || undefined;
  const mediaUri = cleanText(body?.mediaUri, 2000) || undefined;
  const source = cleanText(body?.source, 80) || undefined;
  const scheduleType = cleanText(body?.scheduleType, 120) || undefined;
  const rawScheduleSlots = Array.isArray(body?.scheduleSlots) ? body.scheduleSlots : undefined;
  const scheduleSlots = rawScheduleSlots?.map((slot: any, index: number) => {
    const cleaned = { ...slot };

    // Never let copied/local schedule templates create pre-claimed slots.
    delete cleaned.claimed;
    delete cleaned.isClaimed;
    delete cleaned.claimedByUserId;
    delete cleaned.claimedByName;
    delete cleaned.claimedByAvatar;
    delete cleaned.claimedBy;
    if (String(cleaned.status || "").toLowerCase() === "claimed") {
      delete cleaned.status;
    }

    const startMs = Number(cleaned.startMs || 0);
    const endMs = Number(cleaned.endMs || 0);
    const startsAt = String(cleaned.startsAt || "").trim();
    const endsAt = String(cleaned.endsAt || "").trim();
    const durationMin = Math.max(
      1,
      Number(cleaned.durationMin || cleaned.durationMinutes || cleaned.minutes || 1)
    );

    const normalizedStartMs =
      startMs > 0 ? startMs : startsAt ? Date.parse(startsAt) : 0;
    const normalizedEndMs =
      endMs > normalizedStartMs
        ? endMs
        : endsAt
          ? Date.parse(endsAt)
          : normalizedStartMs > 0
            ? normalizedStartMs + durationMin * 60 * 1000
            : 0;

    const formatLocalDate = (ms: number) => {
      if (!Number.isFinite(ms) || ms <= 0) return "";
      const d = new Date(ms);
      const y = d.getFullYear();
      const m = String(d.getMonth() + 1).padStart(2, "0");
      const day = String(d.getDate()).padStart(2, "0");
      return `${y}-${m}-${day}`;
    };

    const formatClock = (ms: number) => {
      if (!Number.isFinite(ms) || ms <= 0) return "";
      const d = new Date(ms);
      let hour = d.getHours();
      const minute = String(d.getMinutes()).padStart(2, "0");
      const meridiem = hour >= 12 ? "PM" : "AM";
      hour = hour % 12;
      if (hour === 0) hour = 12;
      return `${hour}:${minute} ${meridiem}`;
    };

    if (normalizedStartMs > 0 && normalizedEndMs > normalizedStartMs) {
      cleaned.startMs = normalizedStartMs;
      cleaned.endMs = normalizedEndMs;
      cleaned.startsAt = startsAt || new Date(normalizedStartMs).toISOString();
      cleaned.endsAt = endsAt || new Date(normalizedEndMs).toISOString();
      cleaned.meetingDate = formatLocalDate(normalizedStartMs);
      cleaned.meetingEndDate = formatLocalDate(normalizedEndMs);
      cleaned.startTime = String(cleaned.startTime || "").trim() || formatClock(normalizedStartMs);
      cleaned.endTime = String(cleaned.endTime || "").trim() || formatClock(normalizedEndMs);
      cleaned.durationMin = durationMin;
      cleaned.durationMinutes = durationMin;
    }

    if (__DEV__ && normalizedStartMs > 0) {
      console.log("KRISTO_MEDIA_SLOT_PAYLOAD_TIME", {
        source: "api.church.feed.create",
        index,
        slotId: String(cleaned.id || ""),
        startMs: normalizedStartMs,
        endMs: normalizedEndMs > normalizedStartMs ? normalizedEndMs : null,
        startsAt: cleaned.startsAt || null,
        endsAt: cleaned.endsAt || null,
        meetingDate: cleaned.meetingDate || null,
        meetingEndDate: cleaned.meetingEndDate || null,
      });
    }

    return cleaned;
  });
  const visibility = cleanText(body?.visibility, 80) || undefined;
  const audience = body?.audience || undefined;
  const mediaName = cleanText(body?.mediaName || body?.actorLabel, 240) || undefined;
  const churchName = cleanText(body?.churchName || body?.churchLabel, 240) || undefined;
  const churchLabel = cleanText(body?.churchLabel || body?.churchName, 240) || undefined;
  const feedActorLabel = cleanText(body?.actorLabel || body?.mediaName, 240) || undefined;
  const scheduleCreatedByUserId =
    cleanText(body?.scheduleCreatedByUserId || body?.createdByUserId || body?.createdBy, 240) || viewerUserId;
  const sourceScheduleId = cleanText(body?.sourceScheduleId || body?.liveId, 240) || undefined;
  const publishedAt = cleanText(body?.publishedAt, 80) || new Date().toISOString();

  const pastorResolution = await resolveChurchPastorUserId(churchId);
  const clientPastorId = cleanText(
    body?.actualChurchPastorUserId || body?.churchPastorUserId,
    240
  );

  let actualChurchPastorUserId = pastorResolution.actualChurchPastorUserId || clientPastorId || undefined;

  if (
    actualChurchPastorUserId &&
    scheduleCreatedByUserId &&
    actualChurchPastorUserId === scheduleCreatedByUserId &&
    pastorResolution.actualChurchPastorUserId &&
    pastorResolution.actualChurchPastorUserId !== scheduleCreatedByUserId
  ) {
    actualChurchPastorUserId = pastorResolution.actualChurchPastorUserId;
  }

  if (!actualChurchPastorUserId && pastorResolution.actualChurchPastorUserId) {
    actualChurchPastorUserId = pastorResolution.actualChurchPastorUserId;
  }

  logChurchPastorResolution({
    churchId,
    actualChurchPastorUserId: String(actualChurchPastorUserId || ""),
    sourceField: pastorResolution.sourceField || (clientPastorId ? "client.actualChurchPastorUserId" : ""),
    scheduleCreatedByUserId,
    currentUserId: viewerUserId,
  });

  const mediaOwnerPastorUserId = actualChurchPastorUserId || undefined;
  const mediaHostIds = cleanText(body?.mediaHostIds, 2000) || undefined;

  const isGlobalMediaSlot =
    body?.isGlobalMediaSlot === true ||
    String(body?.isGlobalMediaSlot || "").trim() === "1";

  const actorAvatarUri = cleanText(body?.actorAvatarUri || body?.avatarUri || body?.profileImage, 2000) || undefined;
  const churchAvatarUri = cleanText(body?.churchAvatarUri || body?.churchAvatarUrl || body?.actorAvatarUri || body?.avatarUri || body?.profileImage, 2000) || undefined;
  const posterUri =
    cleanText(body?.posterUri || body?.videoPosterUri, 4000) || undefined;
  const thumbnailUri =
    cleanText(body?.thumbnailUri || body?.thumbnailUrl || body?.videoPosterUri, 4000) ||
    undefined;
  const videoPosterUri =
    cleanText(body?.videoPosterUri || body?.posterUri || body?.thumbnailUri, 4000) || undefined;

  const sanitizedMedia = sanitizeFeedPostMediaFields({
    type,
    videoUrl,
    mediaUri,
    posterUri,
    thumbnailUri,
    actorAvatarUri,
    churchAvatarUri,
    avatarUri: cleanText(body?.avatarUri, 2000) || undefined,
    profileImage: cleanText(body?.profileImage, 2000) || undefined,
    logo: cleanText(body?.logo, 2000) || undefined,
  });

  let resolvedPosterUri =
    sanitizedMedia.posterUri || sanitizedMedia.thumbnailUri || videoPosterUri || undefined;
  let resolvedThumbnailUri =
    sanitizedMedia.thumbnailUri || sanitizedMedia.posterUri || videoPosterUri || undefined;

  if ((type === "video" || videoUrl) && !resolvedPosterUri && videoUrl && shouldAttemptServerFfmpeg()) {
    const generatedPoster = await ensureVideoPosterForUrl(videoUrl);
    if (generatedPoster) {
      resolvedPosterUri = generatedPoster;
      resolvedThumbnailUri = generatedPoster;
    }
  }

  const requestBrandedPoster =
    body?.brandedPoster === true ||
    String(body?.posterUri || "").trim() === brandedVideoPosterFields().posterUri;

  if ((type === "video" || videoUrl) && !resolvedPosterUri && (requestBrandedPoster || !shouldAttemptServerFfmpeg())) {
    const branded = brandedVideoPosterFields();
    resolvedPosterUri = branded.posterUri;
    resolvedThumbnailUri = branded.thumbnailUri;
  }

  const viewerRole = ctx?.viewer?.role;
  const ownershipType =
    isIncomingMediaScheduleCreate(body) || String(source || "").toLowerCase().includes("media")
      ? "media"
      : isPastorOrAdminRole(viewerRole)
        ? "church"
        : "member";
  const ownerChurchId = churchId;
  const ownerMediaProfile =
    ownershipType === "media" ? await churchMediaFor(churchId) : null;
  const ownerMediaId =
    ownershipType === "media"
      ? cleanText(body?.ownerMediaId || mediaName || ownerMediaProfile?.mediaName, 240) || undefined
      : undefined;

  if (type === "video" && !videoUrl) return err("videoUrl is required for type=video", 400);
  if ((type === "post" || type === "announcement") && !text) return err("text is required", 400);

  if (isIncomingMediaScheduleCreate(body)) {
    const subscriptionActive = await isChurchSubscriptionActive(churchId);
    if (!subscriptionActive) {
      return churchSubscriptionRequiredResponse();
    }

    const viewerAppRole = String(ctx?.viewer?.role || ctx?.role || "");
    const ministryId = resolveScheduleMinistryId(null, body);
    const isMediaHost = await isMediaHostForChurch(churchId, viewerUserId);
    const canCreate = await canCreateOrEditScheduleSlots({
      churchId,
      viewerUserId,
      viewerAppRole,
      ministryId,
      isMediaSchedule: true,
      isMediaHost,
    });
    if (!canCreate) {
      return err("Only Pastor, Leader, or Host can create schedule slots", 403);
    }

    const existingActive = findActiveMediaScheduleForChurch(await listFeedItems(), churchId, {
      strictChurch: true,
    });
    if (existingActive) {
      const activeSchedule = summarizeActiveMediaSchedule(existingActive);
      console.log("KRISTO_MEDIA_LOCK_BACKEND_ACTIVE", activeSchedule);
      return NextResponse.json(
        {
          ok: false,
          error: ACTIVE_MEDIA_SCHEDULE_ERROR,
          activeSchedule,
        },
        { status: 409 }
      );
    }
  }

  const item: ChurchFeedItem = {
    id: makeId("feed"),
    churchId,
    type,
    title,
    text,
    videoUrl,
    mediaUri: sanitizedMedia.mediaUri,
    source,
    scheduleType,
    scheduleSlots,
    visibility,
    audience,
    mediaName,
    churchName,
    churchLabel,
    actorLabel: feedActorLabel,
    actorAvatarUri,
    churchAvatarUri,
    avatarUri: actorAvatarUri,
    mediaOwnerPastorUserId,
    actualChurchPastorUserId,
    churchPastorUserId: actualChurchPastorUserId,
    scheduleCreatedByUserId,
    sourceScheduleId,
    publishedAt,
    mediaHostIds,

    isGlobalMediaSlot,

    ownershipType,
    ownerChurchId,
    ownerMediaId,

    createdAt: new Date().toISOString(),
    createdBy: viewerUserId,
  };

  const scheduleMinistryId = resolveScheduleMinistryId(null, body);
  if (scheduleMinistryId) {
    (item as any).ministryId = scheduleMinistryId;
    (item as any).roomId = scheduleMinistryId;
  }

  if (resolvedPosterUri) {
    (item as any).posterUri = resolvedPosterUri;
    (item as any).videoPosterUri = resolvedPosterUri;
  }
  if (resolvedThumbnailUri) {
    (item as any).thumbnailUri = resolvedThumbnailUri;
    if (!resolvedPosterUri) {
      (item as any).posterUri = resolvedThumbnailUri;
      (item as any).videoPosterUri = resolvedThumbnailUri;
    }
  }

  if (type === "video" || videoUrl) {
    item.mediaUri = undefined;
    if (!resolvedPosterUri) delete (item as any).posterUri;
    if (!resolvedThumbnailUri) delete (item as any).thumbnailUri;
    delete (item as any).imageUrl;
    applyBrandedVideoPosterFallback(item as any, videoUrl);
  }

  const isMediaUploadVideo = type === "video" && Boolean(videoUrl) && isMediaUploadCreateBody(body);
  const requestedMediaStatus = normalizeMediaStatus(body?.mediaStatus);
  const mediaStatus: MediaStatus | undefined = isMediaUploadVideo
    ? requestedMediaStatus === "uploading"
      ? "processing"
      : requestedMediaStatus || "ready"
    : requestedMediaStatus;

  if (cleanText(body?.mediaType, 40)) {
    (item as any).mediaType = cleanText(body?.mediaType, 40);
  }
  if (cleanText(body?.storageType, 40)) {
    (item as any).storageType = cleanText(body?.storageType, 40);
  }
  if (cleanText(body?.postOrigin, 40)) {
    (item as any).postOrigin = cleanText(body?.postOrigin, 40);
  }
  if (body?.isMediaPost === true) {
    (item as any).isMediaPost = true;
  }
  if (mediaStatus) {
    (item as any).mediaStatus = mediaStatus;
    if (mediaStatus === "processing") {
      logMediaStatus("KRISTO_MEDIA_STATUS_PROCESSING", {
        id: item.id,
        videoUrl: videoUrl || null,
        source: source || null,
      });
    } else if (mediaStatus === "uploading") {
      logMediaStatus("KRISTO_MEDIA_STATUS_UPLOADING", {
        id: item.id,
        videoUrl: videoUrl || null,
        source: source || null,
      });
    } else if (mediaStatus === "ready") {
      logMediaStatus("KRISTO_MEDIA_STATUS_READY", {
        id: item.id,
        videoUrl: videoUrl || null,
        source: source || null,
      });
    }
  }

  if (type === "video" || videoUrl) {
    applyVideoMetadataFields(item as any, body);
  }

  if ((type === "video" || videoUrl) && (item as any).faststart !== true) {
    console.log("KRISTO_VIDEO_FASTSTART_REQUIRED", {
      videoUrl: videoUrl || null,
      faststart: false,
    });
  }

  console.log("KRISTO_VIDEO_POST_BEFORE_SAVE", {
    type,
    videoUrl,
    mediaType: (item as any).mediaType,
    mediaStatus: (item as any).mediaStatus,
    faststart: (item as any).faststart === true,
    faststartPending: (item as any).faststartPending === true,
    faststartReason: (item as any).faststartReason || null,
    posterUri: (item as any).posterUri || resolvedPosterUri || null,
    brandedPoster: (item as any).brandedPoster === true,
    churchId,
  });

  await upsertFeedItem(item);

  console.log("KRISTO_VIDEO_POST_SAVED", {
    id: item.id,
    type: item.type,
    videoUrl: item.videoUrl,
  });

  if (isMediaUploadVideo && mediaStatus === "processing") {
    void finalizeMediaUploadVideoPost(String(item.id));
  }

  if (type === "video" || videoUrl) {
    console.log("KRISTO_FEED_VIDEO_POSTER_SAVED", {
      id: item.id,
      videoUrl,
      posterUri: resolvedPosterUri || null,
      videoPosterUri: (item as any).videoPosterUri || null,
      thumbnailUri: resolvedThumbnailUri || null,
    });
  }

  const savedFeedRow = withVideoMetadataReturnFields({
    ...item,
    commentCount: 0,
    replyCount: 0,
    totalDiscussionCount: 0,
  });

  if (isIncomingMediaScheduleCreate(body)) {
    bumpMediaScheduleSync(churchId, "create_media_schedule");
    console.log("[ScheduleFeed] persisted row", {
      churchId,
      sourceScheduleId: item.sourceScheduleId || item.id,
      feedId: item.id,
      slotCount: Array.isArray(item.scheduleSlots) ? item.scheduleSlots.length : 0,
      store: "postgres",
    });

    const firstSlot = Array.isArray(item.scheduleSlots) ? item.scheduleSlots[0] : null;
    void notifyScheduleSlotEdit({
      churchId,
      editorUserId: viewerUserId,
      editorName: actorLabel,
      editorAppRole: String(ctx?.viewer?.role || ctx?.role || ""),
      ministryId: scheduleMinistryId,
      slotLabel: formatScheduleSlotLabel(firstSlot || { name: title || "schedule" }),
    });
  }

  return NextResponse.json(
    {
      ok: true,
      data: savedFeedRow,
      item: savedFeedRow,
    },
    { status: 201 }
  );
}
