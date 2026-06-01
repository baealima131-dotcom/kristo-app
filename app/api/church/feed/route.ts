import { NextRequest, NextResponse } from "next/server";
import fs from "node:fs";
import path from "node:path";
import { guard, guardAuth } from "@/app/api/_lib/rbac";
import { ensureActiveMembershipForSession, getActiveMembership } from "@/app/api/_lib/memberships";
import { createNotification } from "@/app/api/_lib/notifications";
import { getChurchById } from "@/app/api/_lib/churches";
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
  safeListFeedItems,
  upsertFeedItem,
} from "@/app/api/_lib/store/feedDb";
import { getKristoDataDir, isKristoServerlessRuntime } from "@/app/api/_lib/store/fs";
import {
  ensureVideoPosterForUrl,
  posterPublicUrlForVideoUrl,
  publicUploadAbsPath,
} from "@/app/api/_lib/media/videoPoster";

export const runtime = "nodejs";

const DATA_DIR = getKristoDataDir();
const BUNDLED_DATA_DIR = path.join(process.cwd(), "data");
const PROFILES_FILE = path.join(BUNDLED_DATA_DIR, "profiles.json");
const FEED_GET_TIMEOUT_MS = isKristoServerlessRuntime() ? 12000 : 30000;

let feedEnrichChurchCache = new Map<string, any>();
let feedEnrichMediaCache = new Map<string, any | null>();

function resetFeedEnrichCaches() {
  feedEnrichChurchCache = new Map();
  feedEnrichMediaCache = new Map();
}

function readJsonArrayFromPaths<T>(paths: string[]): T[] {
  for (const file of paths) {
    try {
      if (!fs.existsSync(file)) continue;
      const raw = fs.readFileSync(file, "utf8");
      const parsed = JSON.parse(raw);
      return Array.isArray(parsed) ? parsed : [];
    } catch (error: any) {
      console.error("[ScheduleFeed] read failure", {
        file,
        message: error?.message,
        code: error?.code,
      });
    }
  }
  return [];
}

function readJsonArray<T>(fileName: string): T[] {
  return readJsonArrayFromPaths<T>([
    path.join(DATA_DIR, fileName),
    path.join(BUNDLED_DATA_DIR, fileName),
  ]);
}

function writeJsonArray(fileName: string, rows: any[]) {
  try {
    if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
    fs.writeFileSync(path.join(DATA_DIR, fileName), JSON.stringify(rows, null, 2));
    console.log("[ScheduleFeed] write success", {
      file: fileName,
      dir: DATA_DIR,
      count: Array.isArray(rows) ? rows.length : 0,
      serverless: isKristoServerlessRuntime(),
    });
  } catch (error: any) {
    console.error("[ScheduleFeed] write failure", {
      file: fileName,
      dir: DATA_DIR,
      message: error?.message,
      code: error?.code,
      stack: error?.stack,
      serverless: isKristoServerlessRuntime(),
    });
  }
}

function saveFeedStores() {
  writeJsonArray("church-feed-comments.json", globalThis.__kristoChurchFeedComments || []);
  writeJsonArray("church-feed-comment-likes.json", globalThis.__kristoChurchFeedCommentLikes || []);
  writeJsonArray("church-feed-likes.json", globalThis.__kristoChurchFeedLikes || []);
}

type FeedType = "post" | "announcement" | "video";

export type { ChurchFeedItem };

export type FeedComment = {
  id: string;
  churchId: string;
  postId: string;
  parentCommentId?: string; // set only for replies
  text: string;
  createdAt: string;
  createdBy: string; // userId
};

type FeedCommentLike = {
  churchId: string;
  commentId: string;
  userId: string;
  createdAt: string;
};

type FeedPostLike = {
  churchId: string;
  postId: string;
  userId: string;
  createdAt: string;
};

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

declare global {
  // eslint-disable-next-line no-var
  var __kristoChurchFeedComments: FeedComment[] | undefined;
  // eslint-disable-next-line no-var
  var __kristoChurchFeedCommentLikes: FeedCommentLike[] | undefined;
  // eslint-disable-next-line no-var
  var __kristoChurchFeedLikes: FeedPostLike[] | undefined;
}

function hydrateCommentStoreFromDisk() {
  if (!globalThis.__kristoChurchFeedComments) {
    globalThis.__kristoChurchFeedComments = readJsonArray<FeedComment>("church-feed-comments.json");
  }
}

function commentStore(): FeedComment[] {
  hydrateCommentStoreFromDisk();
  if (!globalThis.__kristoChurchFeedComments) globalThis.__kristoChurchFeedComments = [];
  return globalThis.__kristoChurchFeedComments;
}

function commentLikeStore(): FeedCommentLike[] {
  if (!globalThis.__kristoChurchFeedCommentLikes) {
    globalThis.__kristoChurchFeedCommentLikes = readJsonArray<FeedCommentLike>(
      "church-feed-comment-likes.json"
    );
  }
  return globalThis.__kristoChurchFeedCommentLikes;
}

function postLikeStore(): FeedPostLike[] {
  if (!globalThis.__kristoChurchFeedLikes) {
    globalThis.__kristoChurchFeedLikes = readJsonArray<FeedPostLike>("church-feed-likes.json");
  }
  return globalThis.__kristoChurchFeedLikes;
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

  if (feedEnrichChurchCache.has(cid)) {
    return feedEnrichChurchCache.get(cid);
  }

  const profile = await getChurchById(cid).catch(() => null);
  feedEnrichChurchCache.set(cid, profile);
  return profile;
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

function enrichComment<T extends FeedComment>(c: T) {
  return {
    ...c,
    ...publicUser(c.createdBy),
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

    const current = normalizeMediaStatus((existing as any)?.mediaStatus);
    if (current === "ready") return;

    let posterUri = String((existing as any)?.posterUri || (existing as any)?.videoPosterUri || "").trim();
    const videoUrl = String(existing.videoUrl || "").trim();

    if (!posterUri && videoUrl) {
      const generated = await ensureVideoPosterForUrl(videoUrl);
      if (generated) posterUri = generated;
    }

    const next: any = {
      ...existing,
      mediaStatus: "ready",
    };

    if (posterUri) {
      next.posterUri = posterUri;
      next.videoPosterUri = posterUri;
      next.thumbnailUri = posterUri;
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

function postLikeCount(churchId: string, postId: string) {
  return postLikeStore().filter((x) => x.churchId === churchId && x.postId === postId).length;
}

function postLikedByUser(churchId: string, postId: string, userId: string) {
  return postLikeStore().some((x) => x.churchId === churchId && x.postId === postId && x.userId === userId);
}

function commentCountForPost(postId: string) {
  return commentStore().filter((x) => x.postId === postId && !x.parentCommentId).length;
}

function replyCountForPost(postId: string) {
  return commentStore().filter((x) => x.postId === postId && !!x.parentCommentId).length;
}

function commentLikeCount(churchId: string, commentId: string) {
  return commentLikeStore().filter((x) => x.churchId === churchId && x.commentId === commentId).length;
}

function commentLikedByUser(churchId: string, commentId: string, userId: string) {
  return commentLikeStore().some(
    (x) => x.churchId === churchId && x.commentId === commentId && x.userId === userId
  );
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

  const removedCommentIds = new Set(
    commentStore()
      .filter((x) => String(x.postId || "") === postId)
      .map((x) => String(x.id || ""))
  );

  globalThis.__kristoChurchFeedComments = commentStore().filter(
    (x) => String(x.postId || "") !== postId
  );

  globalThis.__kristoChurchFeedLikes = postLikeStore().filter(
    (x) => String(x.postId || "") !== postId
  );

  globalThis.__kristoChurchFeedCommentLikes = commentLikeStore().filter(
    (x) => !removedCommentIds.has(String(x.commentId || ""))
  );
}

async function enrichFeedListItem(item: any, viewerUserId: string) {
  const itemChurchId = String(item.churchId || "");
  const itemChurchProfile = await churchProfileFor(itemChurchId);
  const itemMediaProfile: any = await churchMediaFor(itemChurchId);
  const author = publicUser(item.createdBy);

  const itemChurchName = String(
    (itemChurchProfile as any)?.name ||
    itemChurchId ||
    "Church"
  ).trim();

  const itemChurchAvatarUri = String(
    (itemChurchProfile as any)?.avatarUri ||
    (itemChurchProfile as any)?.avatarUrl ||
    ""
  ).trim();

  const ownershipType = inferOwnershipType(item);

  let posterUri =
    String(item?.posterUri || item?.videoPosterUri || "").trim() || undefined;
  let thumbnailUri =
    String(item?.thumbnailUri || item?.thumbnailUrl || item?.videoPosterUri || "").trim() ||
    undefined;
  const isVideoItem =
    item?.type === "video" || Boolean(String(item?.videoUrl || "").trim());

  if (isVideoItem && !posterUri && !thumbnailUri && item?.videoUrl) {
    const existingPoster = posterPublicUrlForVideoUrl(String(item.videoUrl));
    const posterAbsPath = publicUploadAbsPath(existingPoster);
    if (posterAbsPath && fs.existsSync(posterAbsPath)) {
      posterUri = existingPoster;
      thumbnailUri = existingPoster;
    }
  }

  const videoPosterUri = posterUri || thumbnailUri;

  return {
    ...item,
    ...(posterUri ? { posterUri } : {}),
    ...(thumbnailUri ? { thumbnailUri } : {}),
    ...(videoPosterUri ? { videoPosterUri } : {}),
    ownershipType,
    ownerChurchId: String(item?.ownerChurchId || itemChurchId || ""),
    ownerMediaId: String(item?.ownerMediaId || item?.mediaName || itemMediaProfile?.mediaName || "").trim() || undefined,
    authorName: author.authorName,
    authorAvatarUri: author.authorAvatarUri,
    churchName: itemChurchName,
    churchAvatarUri: itemChurchAvatarUri,
    churchCountry: String((itemChurchProfile as any)?.country || "").trim(),
    churchProvince: String((itemChurchProfile as any)?.province || "").trim(),
    churchCity: String((itemChurchProfile as any)?.city || "").trim(),
    churchNormalizedCountry: String((itemChurchProfile as any)?.normalizedCountry || "").trim(),
    churchNormalizedProvince: String((itemChurchProfile as any)?.normalizedProvince || "").trim(),
    churchNormalizedCity: String((itemChurchProfile as any)?.normalizedCity || "").trim(),
    churchPrimaryLanguage: String((itemChurchProfile as any)?.primaryLanguage || "").trim(),
    churchPhoneCountryCode: String((itemChurchProfile as any)?.phoneCountryCode || "").trim(),
    mediaName: String(itemMediaProfile?.mediaName || item?.mediaName || itemChurchName || "Church Media").trim(),
    scheduleSlots: enrichScheduleSlotsClaimAvatars(
      Array.isArray(item?.scheduleSlots) ? item.scheduleSlots : []
    ),
    commentCount: commentCountForPost(item.id),
    replyCount: replyCountForPost(item.id),
    totalDiscussionCount: commentCountForPost(item.id) + replyCountForPost(item.id),
    likeCount: postLikeCount(itemChurchId, item.id),
    likedByMe: postLikedByUser(itemChurchId, item.id, viewerUserId),
  };
}

async function safeEnrichFeedListItem(item: any, viewerUserId: string) {
  try {
    return await enrichFeedListItem(item, viewerUserId);
  } catch (error) {
    console.error("[church/feed] enrich item failed", {
      postId: String(item?.id || ""),
      error: error instanceof Error ? error.message : String(error),
    });
    return {
      ...item,
      ownershipType: inferOwnershipType(item),
      authorName: publicUser(item?.createdBy).authorName,
      authorAvatarUri: publicUser(item?.createdBy).authorAvatarUri,
      scheduleSlots: enrichScheduleSlotsClaimAvatars(
        Array.isArray(item?.scheduleSlots) ? item.scheduleSlots : []
      ),
      commentCount: commentCountForPost(String(item?.id || "")),
      replyCount: replyCountForPost(String(item?.id || "")),
      totalDiscussionCount:
        commentCountForPost(String(item?.id || "")) +
        replyCountForPost(String(item?.id || "")),
      likeCount: postLikeCount(String(item?.churchId || ""), String(item?.id || "")),
      likedByMe: postLikedByUser(
        String(item?.churchId || ""),
        String(item?.id || ""),
        viewerUserId
      ),
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

function buildCommentTree(churchId: string, postId: string, viewerUserId: string): FeedCommentTree[] {
  const all = commentStore()
    .filter((x) => x.churchId === churchId && x.postId === postId)
    .slice()
    .sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));

  const roots = all.filter((x) => !x.parentCommentId);
  const replies = all.filter((x) => !!x.parentCommentId);

  return roots.map((root) => ({
    ...enrichComment(root),
    likeCount: commentLikeCount(churchId, root.id),
    likedByMe: commentLikedByUser(churchId, root.id, viewerUserId),
    replies: replies
      .filter((r) => r.parentCommentId === root.id)
      .slice()
      .sort((a, b) => (a.createdAt < b.createdAt ? -1 : 1))
      .map((reply) => ({
        ...enrichComment(reply),
        likeCount: commentLikeCount(churchId, reply.id),
        likedByMe: commentLikedByUser(churchId, reply.id, viewerUserId),
      })),
  }));
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

      const storageItems = (await safeListFeedItems())
        .filter((x: any) => String(x?.churchId || "") === viewerChurchId)
        .filter((x: any) => (storageMode === "media" ? isMediaOwnedFeedItem(x) : true))
        .filter((x) => (type ? x.type === type : true))
        .slice()
        .sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1))
        .map((item) => safeEnrichFeedListItem(item, viewerUserId));

      const resolvedStorageItems = await Promise.all(storageItems);

      return feedListOk(viewerChurchId, resolvedStorageItems);
    }

    if (id) {
      const item = await getFeedItemById(id);
      if (!item) return err("Feed item not found", 404);

      const itemChurchId = String(item.churchId || churchId);

      if (!isDiscoverableFeedItem(item, churchId)) {
        return err("Feed item not found", 404);
      }

      if (isClaimableScheduleFeedItem(item) && !(await viewerHasActiveChurchMembership(churchId, viewerUserId))) {
        return err("Feed item not found", 404);
      }

      const commentCount = commentCountForPost(item.id);
      const replyCount = replyCountForPost(item.id);

      const detail: FeedPostDetail = {
        item: {
          ...item,
          commentCount,
          replyCount,
          totalDiscussionCount: commentCount + replyCount,
        },
        comments: buildCommentTree(itemChurchId, item.id, viewerUserId),
      };

      return ok(detail);
    }

    const allRows = (await safeListFeedItems()).filter(feedVideoAssetExists);
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

    const afterDiscover = allRows.filter((x: any) => isDiscoverableFeedItem(x, churchId));
    const homeReadyRows = afterDiscover.filter((x: any) => isHomeFeedReadyItem(x));

    if (__DEV__) {
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

    const items = homeReadyRows
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
      .sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1))
      .map((item) => safeEnrichFeedListItem(item, viewerUserId));

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
    const postId = cleanText(body?.postId, 240);

    if (!postId) return err("postId is required", 400);

    const item = await getFeedItemById(postId);

    if (!item) return err("Feed item not found", 404);

    const itemChurchId = String(item.churchId || churchId);

    const likes = postLikeStore();

    const existingIndex = likes.findIndex(
      (x) =>
        x.churchId === itemChurchId &&
        x.postId === postId &&
        x.userId === viewerUserId
    );

    const wantsLiked =
      typeof body?.liked === "boolean" ? Boolean(body.liked) : null;

    let likedByMe = false;

    if (wantsLiked === true) {
      if (existingIndex < 0) {
        likes.push({
          churchId: itemChurchId,
          postId,
          userId: viewerUserId,
          createdAt: new Date().toISOString(),
        });
      }

      likedByMe = true;
    } else if (wantsLiked === false) {
      if (existingIndex >= 0) {
        likes.splice(existingIndex, 1);
      }

      likedByMe = false;
    } else if (existingIndex >= 0) {
      likes.splice(existingIndex, 1);
      likedByMe = false;
    } else {
      likes.push({
        churchId: itemChurchId,
        postId,
        userId: viewerUserId,
        createdAt: new Date().toISOString(),
      });

      likedByMe = true;
    }

    saveFeedStores();

    return ok({
      postId,
      likedByMe,
      likeCount: postLikeCount(itemChurchId, postId),
    });
  }

  if (action === "add_comment" || action === "add_reply") {
    const postId = cleanText(body?.postId, 240);
    const text = cleanText(body?.text, 5000);

    if (!postId) return err("postId is required", 400);
    if (!text) return err("text is required", 400);

    const item = await getFeedItemById(postId);

    if (!item) return err("Feed item not found", 404);

    const itemChurchId = String(item.churchId || churchId);

    const comment = {
      id: makeId("comment"),
      churchId: itemChurchId,
      postId,
      parentCommentId:
        action === "add_reply"
          ? cleanText(body?.parentCommentId, 240)
          : undefined,
      text,
      createdAt: new Date().toISOString(),
      createdBy: viewerUserId,
    };

    commentStore().push(comment);

    saveFeedStores();

    return ok({
      comment: enrichComment(comment),
      commentCount: commentCountForPost(postId),
      replyCount: replyCountForPost(postId),
    });
  }

  if (action === "toggle_comment_like") {
    const commentId = cleanText(body?.commentId, 240);

    if (!commentId) return err("commentId is required", 400);

    const comment = commentStore().find(
      (x) => String(x.id || "") === commentId
    );

    if (!comment) return err("Comment not found", 404);

    const likes = commentLikeStore();

    const existingIndex = likes.findIndex(
      (x) =>
        x.churchId === comment.churchId &&
        x.commentId === commentId &&
        x.userId === viewerUserId
    );

    let likedByMe = false;

    if (existingIndex >= 0) {
      likes.splice(existingIndex, 1);
    } else {
      likes.push({
        churchId: comment.churchId,
        commentId,
        userId: viewerUserId,
        createdAt: new Date().toISOString(),
      });

      likedByMe = true;
    }

    saveFeedStores();

    return ok({
      commentId,
      likedByMe,
      likeCount: commentLikeCount(comment.churchId, commentId),
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
    saveFeedStores();

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
  const scheduleSlots = rawScheduleSlots?.map((slot: any) => {
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

  if ((type === "video" || videoUrl) && !resolvedPosterUri && videoUrl) {
    const generatedPoster = await ensureVideoPosterForUrl(videoUrl);
    if (generatedPoster) {
      resolvedPosterUri = generatedPoster;
      resolvedThumbnailUri = generatedPoster;
    }
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
  }

  const isMediaUploadVideo = type === "video" && Boolean(videoUrl) && isMediaUploadCreateBody(body);
  const requestedMediaStatus = normalizeMediaStatus(body?.mediaStatus);
  const mediaStatus: MediaStatus | undefined = isMediaUploadVideo
    ? requestedMediaStatus === "uploading" || !requestedMediaStatus
      ? "processing"
      : requestedMediaStatus
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

  await upsertFeedItem(item);

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

  const savedFeedRow = {
    ...item,
    commentCount: 0,
    replyCount: 0,
    totalDiscussionCount: 0,
  };

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
