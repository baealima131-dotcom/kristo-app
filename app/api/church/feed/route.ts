import { NextRequest, NextResponse } from "next/server";
import fs from "node:fs";
import path from "node:path";
import { resolveActorIdentity } from "@/app/api/_lib/notificationActor";
import { getUserById } from "@/app/api/auth/_lib/session";
import { guard, guardAuth } from "@/app/api/_lib/rbac";
import { ensureActiveMembershipForSession, getActiveMembership, getMembershipsForUser } from "@/app/api/_lib/memberships";
import { createNotification } from "@/app/api/_lib/notifications";
import { getProfile, getProfileByUserCode } from "@/app/api/auth/_lib/profile";
import {
  ensureProfileAvatarUrlForClaim,
  isPersistedProfileAvatarUrl,
  pickPersistedProfileAvatarUrl,
} from "@/app/api/_lib/profileAvatarUpload";
import { getChurchById } from "@/app/api/_lib/churches";
import {
  churchAvatarUpdatedAtMs,
  resolveChurchAvatarFields,
} from "@/app/api/_lib/churchAvatar";
import {
  logChurchPastorResolution,
  resolveChurchPastorUserId,
} from "@/app/api/_lib/churchPastor";
import { resolveCanDeleteChurchActivityPost } from "@/app/api/_lib/churchActivityDelete";
import { notifyChurchFeedPostPublished } from "@/app/api/_lib/churchContentNotifications";
import {
  isPrayerRequestFeedItem,
  notifyFeedCommentLiked,
  notifyFeedCommentOnPost,
  notifyFeedPostLiked,
  notifyFeedReplyToComment,
  notifyPrayerRequestPrayedFor,
  resolveFeedPostAuthorUserId,
} from "@/app/api/_lib/feedEngagementNotifications";
import {
  notifyLiveEventScheduled,
  notifyLiveSlotAssignmentDiff,
  notifyLiveSlotCancelled,
} from "@/app/api/_lib/liveEventNotifications";
import {
  isChurchSubscriptionActive,
  requireChurchSubscriptionActive,
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
  areAllScheduleSlotsExpired,
  findActiveMediaScheduleForChurch,
  findAllActiveMediaSchedulesForChurch,
  getActiveScheduleSlots,
  isIncomingMediaScheduleCreate,
  isMediaScheduleForChurch,
  isMediaScheduleFeedItem,
  summarizeActiveMediaSchedule,
} from "@/lib/mediaScheduleLock";
import {
  formatLocalIsoDateFromMs,
  localCalendarDateFromString,
} from "@/lib/scheduleDateUtils";
import {
  logHomeFeedScheduleCreated,
  logHomeFeedScheduleExpired,
  logHomeFeedScheduleRemoved,
} from "@/lib/homeFeedScheduleLifecycle";
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
  isBrandedVideoPosterUri,
} from "@/app/api/_lib/media/brandedVideoPoster";
import {
  ensureVideoPosterForUrl,
  isUsableVideoPosterUri,
  posterPublicUrlForVideoUrl,
  publicUploadAbsPath,
  shouldAttemptServerFfmpeg,
} from "@/app/api/_lib/media/videoPoster";
import { findExistingPreviewVideoUrl } from "@/app/api/_lib/media/videoPreview";
import { probeMp4FaststartFromUrl } from "@/app/api/_lib/media/mp4FaststartProbe";
import {
  headStorageObject,
  storageKeyFromPublicUrl,
} from "@/app/api/_lib/media/objectStorage";
import { reconcileMediaScheduleFeedRowsForChurch } from "@/app/api/_lib/reconcileMediaScheduleFeed";
import {
  filterHomeFeedRowsBySearchQuery,
  parseHomeFeedSearchQueryParam,
} from "@/app/api/_lib/homeFeedSearch";

export const runtime = "nodejs";

const isServerDev = process.env.NODE_ENV !== "production";

const BUNDLED_DATA_DIR = path.join(process.cwd(), "data");
const PROFILES_FILE = path.join(BUNDLED_DATA_DIR, "profiles.json");
const USERS_FILE = path.join(BUNDLED_DATA_DIR, "users.json");
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

/** Paginated feed response: data page + cursor metadata for endless scroll. */
function feedListPageOk<T>(
  churchId: string,
  data: T,
  page: { hasMore: boolean; nextCursor: string | null; total: number; offset: number },
  init?: ResponseInit
) {
  const sync = getMediaScheduleSync(churchId);
  return NextResponse.json(
    {
      ok: true,
      data,
      hasMore: page.hasMore,
      nextCursor: page.nextCursor,
      total: page.total,
      offset: page.offset,
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

function usersMapFromFile(): Record<string, any> {
  try {
    if (!fs.existsSync(USERS_FILE)) return {};
    const raw = fs.readFileSync(USERS_FILE, "utf8");
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return {};
    const map: Record<string, any> = {};
    for (const row of parsed) {
      const id = String(row?.id || "").trim();
      if (id) map[id] = row;
    }
    return map;
  } catch {
    return {};
  }
}

function emailPrefixFromAddress(email: string) {
  const raw = String(email || "").trim();
  if (!raw.includes("@")) return "";
  return raw.split("@")[0]?.trim() || "";
}

function looksLikeEmailAddress(value: string) {
  const s = String(value || "").trim();
  return Boolean(s) && /^[^\s@]+@[^\s@]+\.[^\s@]+$/i.test(s);
}

function pickSafeUserDisplayName(args: { userId: string; profile?: any; user?: any }) {
  const { userId, profile, user } = args;
  const emailPrefix = emailPrefixFromAddress(
    String(profile?.email || user?.email || "").trim()
  );
  const candidates = [
    profile?.fullName,
    profile?.displayName,
    profile?.name,
    profile?.username,
    profile?.kristoId,
    user?.fullName,
    user?.displayName,
    user?.name,
    user?.username,
    user?.kristoId,
    emailPrefix,
  ];

  for (const candidate of candidates) {
    const value = String(candidate || "").trim();
    if (
      value &&
      !looksLikeEmailAddress(value) &&
      !commentAuthorNameLooksLikeUserId(value, userId)
    ) {
      return value;
    }
  }

  return "";
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
  const u = usersMapFromFile()[userId] || {};
  const name =
    pickSafeUserDisplayName({ userId, profile: p, user: u }) || "Member";

  const avatarUri = String(
    p.avatarUri ||
      p.avatarUrl ||
      p.profileImage ||
      p.photoURL ||
      p.image ||
      u.avatarUri ||
      u.avatarUrl ||
      u.profileImage ||
      u.photoURL ||
      u.image ||
      ""
  ).trim();

  return {
    authorName: name,
    authorAvatarUri: avatarUri,
    authorInitial: name.trim().charAt(0).toUpperCase() || "M",
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

function resolveFeedAuthorDisplayName(item: any, fallbackAuthor: { authorName: string }) {
  const userId = String(item?.createdBy || "").trim();
  const storedCandidates = [
    item?.authorName,
    item?.actorLabel,
    item?.postedByName,
    item?.displayName,
  ]
    .map((value) => String(value || "").trim())
    .filter(Boolean);

  for (const candidate of storedCandidates) {
    if (!commentAuthorNameLooksLikeUserId(candidate, userId)) return candidate;
  }

  const fallback = String(fallbackAuthor.authorName || "").trim();
  if (fallback && !commentAuthorNameLooksLikeUserId(fallback, userId)) return fallback;

  return "Member";
}

function buildPersistedAuthorFields(
  name: string,
  userId: string,
  source?: any
): {
  authorName: string;
  actorLabel: string;
  postedByName: string;
  displayName: string;
  authorAvatarUri?: string;
} {
  const trimmed = String(name || "").trim();
  const clean =
    trimmed && !commentAuthorNameLooksLikeUserId(trimmed, userId) ? trimmed : "Member";
  const avatar = firstNonEmptyAvatar(
    source?.authorAvatarUri,
    source?.actorAvatarUri,
    source?.profileAvatarUri,
    source?.avatarUri,
    source?.profileImage
  );

  return {
    authorName: clean,
    actorLabel: clean,
    postedByName: clean,
    displayName: clean,
    ...(avatar ? { authorAvatarUri: avatar } : {}),
  };
}

async function resolvePersistedFeedAuthorFields(args: {
  userId: string;
  ctx?: any;
  body?: any;
  item?: any;
}): Promise<{
  authorName: string;
  actorLabel: string;
  postedByName: string;
  displayName: string;
  authorAvatarUri?: string;
}> {
  const userId = String(args.userId || "").trim();
  const source = args.item || args.body || {};

  const storedCandidates = [
    source?.authorName,
    source?.actorLabel,
    source?.postedByName,
    source?.displayName,
    cleanText(args.body?.authorName, 240),
    cleanText(args.body?.actorLabel, 240),
    cleanText(args.body?.postedByName, 240),
    cleanText(args.body?.displayName, 240),
  ]
    .map((value) => String(value || "").trim())
    .filter(Boolean);

  for (const candidate of storedCandidates) {
    if (!commentAuthorNameLooksLikeUserId(candidate, userId)) {
      return finalizePersistedAuthorFields(
        buildPersistedAuthorFields(candidate, userId, source),
        userId,
        source
      );
    }
  }

  const viewerId = String(args.ctx?.viewer?.userId || args.ctx?.userId || "").trim();
  if (userId && viewerId && userId === viewerId) {
    const viewer = args.ctx?.viewer || {};
    const ctxName = nameFromViewer(viewer);
    if (ctxName && !commentAuthorNameLooksLikeUserId(ctxName, userId)) {
      return finalizePersistedAuthorFields(
        buildPersistedAuthorFields(ctxName, userId, {
          ...source,
          authorAvatarUri: avatarFromViewer(viewer) || source?.authorAvatarUri,
          actorAvatarUri: avatarFromViewer(viewer) || source?.actorAvatarUri,
        }),
        userId,
        {
          ...source,
          authorAvatarUri: avatarFromViewer(viewer) || source?.authorAvatarUri,
          actorAvatarUri: avatarFromViewer(viewer) || source?.actorAvatarUri,
        }
      );
    }
  }

  const identity = userId ? await resolveActorIdentity(userId) : { name: "", avatar: "" };
  const authUser = userId ? await getUserById(userId).catch(() => null) : null;
  const fallback = publicUser(userId);
  let finalName = resolveReadAuthorName(userId, "", identity, fallback, authUser?.email);
  if (finalName === "Member") {
    const fromAuthUser = pickSafeUserDisplayName({
      userId,
      profile: profileMap()[userId],
      user: authUser,
    });
    if (fromAuthUser) finalName = fromAuthUser;
  }

  const authorAvatarUri = await resolveFeedAuthorAvatarUri(userId, source, identity);

  return finalizePersistedAuthorFields(
    buildPersistedAuthorFields(finalName, userId, {
      ...source,
      authorAvatarUri,
    }),
    userId,
    { ...source, authorAvatarUri },
    identity
  );
}

function nameFromViewer(viewer: any) {
  const email = String(viewer?.email || "").trim();
  const emailPrefix = email.includes("@") ? email.split("@")[0] : "";
  const candidates = [
    viewer?.fullName,
    viewer?.displayName,
    viewer?.name,
    viewer?.username,
    viewer?.kristoId,
    emailPrefix,
  ];
  for (const candidate of candidates) {
    const value = String(candidate || "").trim();
    // Never use a full email address as a public actor/author display name.
    if (value && !looksLikeEmailAddress(value)) return value;
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

async function resolveFeedAuthorAvatarUri(
  userId: string,
  source: any,
  identity?: { avatar?: string }
) {
  const uid = String(userId || "").trim();
  const fromSource = firstNonEmptyAvatar(
    source?.authorAvatarUri,
    source?.actorAvatarUri,
    source?.profileAvatarUri,
    source?.avatarUri,
    source?.avatarUrl,
    source?.profileImage,
    source?.photoURL,
    identity?.avatar,
    avatarFromProfileMap(uid),
    uid ? publicUser(uid).authorAvatarUri : ""
  );
  if (fromSource) return fromSource;

  if (!uid) return "";

  try {
    const profile = (await getProfile(uid)) || null;
    const persisted = profile ? pickPersistedProfileAvatarUrl(profile) : "";
    if (persisted) return persisted;
  } catch {
    // ignore profile read errors
  }

  return "";
}

async function finalizePersistedAuthorFields(
  fields: ReturnType<typeof buildPersistedAuthorFields>,
  userId: string,
  source: any,
  identity?: { avatar?: string }
) {
  if (String(fields.authorAvatarUri || "").trim()) return fields;
  const authorAvatarUri = await resolveFeedAuthorAvatarUri(userId, source, identity);
  if (!authorAvatarUri) return fields;
  return { ...fields, authorAvatarUri };
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
    const authUser = await getUserById(viewerUserId).catch(() => null);
    const profileEmail = String(profileMap()[viewerUserId]?.email || "").trim();
    const fileUserEmail = String(usersMapFromFile()[viewerUserId]?.email || "").trim();
    const emailPrefix = emailPrefixFromAddress(
      String(viewer?.email || authUser?.email || profileEmail || fileUserEmail || "").trim()
    );
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

function pickProfileAvatar(profile: any) {
  const candidates = [
    profile?.avatarUrl,
    profile?.avatarUri,
    profile?.profileImage,
    profile?.photoURL,
    profile?.image,
  ];
  for (const raw of candidates) {
    const sanitized = sanitizeClaimSlotAvatarUri(raw, "pickProfileAvatar");
    if (sanitized) return sanitized;
  }
  return "";
}

function sanitizeClaimSlotAvatarUri(raw: unknown, context = "backend") {
  const trimmed = String(raw || "").trim();
  if (!trimmed) return "";
  if (trimmed.toLowerCase().startsWith("data:image")) {
    return "";
  }
  if (trimmed.startsWith("file://")) return "";
  if (/^https?:\/\//i.test(trimmed)) return trimmed;
  if (trimmed.startsWith("/uploads/") || /^uploads\//i.test(trimmed)) return trimmed;
  return "";
}

async function resolveClaimerAvatarUri(userId: string, claim?: any) {
  const uid = String(userId || "").trim();
  const claimCandidates = [
    claim?.avatarUrl,
    claim?.avatarUri,
    claim?.claimedByAvatarUri,
    claim?.claimedByAvatar,
    claim?.claimedByPhotoUrl,
  ];
  for (const raw of claimCandidates) {
    const sanitized = sanitizeClaimSlotAvatarUri(raw, "claim-payload");
    if (sanitized) return sanitized;
  }

  const fromMapRaw = profileAvatarForUserId(uid);
  if (isPersistedProfileAvatarUrl(fromMapRaw)) {
    const fromMap = sanitizeClaimSlotAvatarUri(fromMapRaw, "profile-map");
    if (fromMap) {
      console.log("KRISTO_CLAIMED_SLOT_AVATAR_HYDRATED", {
        userId: uid,
        source: "profile-map",
      });
      return fromMap;
    }
  }

  const ensured = await ensureProfileAvatarUrlForClaim(uid);
  if (ensured) {
    const sanitized = sanitizeClaimSlotAvatarUri(ensured, "ensure-profile-avatar");
    if (sanitized) {
      console.log("KRISTO_CLAIMED_SLOT_AVATAR_HYDRATED", {
        userId: uid,
        source: "ensureProfileAvatarUrlForClaim",
      });
      return sanitized;
    }
  }

  try {
    const profile = await getProfile(uid);
    const avatar = pickProfileAvatar(profile);
    if (avatar) {
      console.log("KRISTO_CLAIMED_SLOT_AVATAR_HYDRATED", {
        userId: uid,
        source: "getProfile",
      });
      return avatar;
    }
  } catch {
    // ignore profile lookup failures
  }

  console.log("KRISTO_CLAIMED_SLOT_AVATAR_MISSING", {
    userId: uid,
    stage: "backend-avatar-resolve",
  });
  return "";
}

async function enrichScheduleSlotClaimAvatar(slot: any) {
  const userId = String(slot?.claimedByUserId || slot?.claimedBy?.userId || "").trim();
  if (!userId) return slot;

  const existingRaw = String(
    slot?.claimedByAvatarUri ||
      slot?.claimedByAvatar ||
      slot?.claimedByAvatarUrl ||
      slot?.claimedByPhotoUrl ||
      slot?.claimedBy?.avatarUri ||
      slot?.claimedBy?.avatarUrl ||
      slot?.claimedBy?.profileImage ||
      slot?.claimedBy?.photoURL ||
      slot?.claimedBy?.image ||
      ""
  ).trim();
  const existing = sanitizeClaimSlotAvatarUri(existingRaw, "feed-enrich-existing");

  const avatarUri = existing || (await resolveClaimerAvatarUri(userId));
  if (!avatarUri) return slot;

  if (!existing) {
    console.log("KRISTO_CLAIMED_SLOT_AVATAR_HYDRATED", {
      userId,
      slotId: String(slot?.id || ""),
      source: "feed-enrich",
    });
  }

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
    claimedByPhotoUrl: avatarUri,
    claimedBy,
  };
}

async function enrichScheduleSlotsClaimAvatars(slots: any[]) {
  if (!Array.isArray(slots)) return [];
  return Promise.all(slots.map((slot) => enrichScheduleSlotClaimAvatar(slot)));
}

type CommentActorIdentity = { name: string; avatar: string };

function resolveReadAuthorName(
  userId: string,
  snapName: string,
  identity: CommentActorIdentity,
  fallback: ReturnType<typeof publicUser>,
  authUserEmail?: string
) {
  if (snapName && !commentAuthorNameLooksLikeUserId(snapName, userId)) {
    return snapName;
  }

  for (const candidate of [identity.name, fallback.authorName]) {
    const value = String(candidate || "").trim();
    if (value && !commentAuthorNameLooksLikeUserId(value, userId)) return value;
  }

  const profileEmail = String(profileMap()[userId]?.email || "").trim();
  const fileUserEmail = String(usersMapFromFile()[userId]?.email || "").trim();
  const emailPrefix = emailPrefixFromAddress(
    String(authUserEmail || profileEmail || fileUserEmail || "").trim()
  );
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
  const authUser = userId ? await getUserById(userId).catch(() => null) : null;

  const finalName = resolveReadAuthorName(userId, snapName, identity, fallback, authUser?.email);
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

function isPersistedFeedPostImageUri(uri: unknown) {
  const value = String(uri || "").trim();
  if (!value) return false;
  if (value.startsWith("data:image/")) return true;
  if (/^https?:\/\//i.test(value)) return true;
  if (value.includes("/uploads/media/")) return true;
  if (value.includes("/church-feed-images/")) return true;
  if (value.startsWith("/uploads/") && !feedUrlLooksLikeAvatarOrLogo(value)) return true;
  return false;
}

function isChurchRoomFeedSource(source: unknown) {
  const normalized = String(source || "").trim().toLowerCase();
  return ["testimony", "post", "announcement", "counsel"].includes(normalized);
}

function isChurchRoomFeedPost(item: any) {
  const source = String(item?.source || item?.kind || "").trim().toLowerCase();
  const type = String(item?.type || "").trim().toLowerCase();
  if (!isChurchRoomFeedSource(source)) return false;
  if (type === "video" || Boolean(String(item?.videoUrl || "").trim())) return false;
  return type === "post" || type === "announcement" || !type;
}

function feedPostImageAvatarFields(item: any) {
  return [
    item?.authorAvatarUri,
    item?.actorAvatarUri,
    item?.profileAvatarUri,
    item?.churchAvatarUri,
    item?.churchAvatarUrl,
    item?.avatarUri,
    item?.profileImage,
    item?.photoURL,
    item?.logo,
  ];
}

const FEED_POST_IMAGE_FIELD_KEYS = [
  "mediaUri",
  "imageUrl",
  "photoUrl",
  "imageUri",
  "attachmentUrl",
  "photoUri",
  "uploadedMediaUri",
  "mediaUrl",
  "url",
  "photo",
  "image",
  "coverImage",
  "coverImageUrl",
];

const FEED_POST_IMAGE_AVATAR_FIELD_KEYS = new Set([
  "authorAvatarUri",
  "actorAvatarUri",
  "profileAvatarUri",
  "authorAvatar",
  "churchAvatarUri",
  "churchAvatarUrl",
  "churchAvatar",
  "avatarUri",
  "avatarUrl",
  "profileImage",
  "photoURL",
  "logo",
  "logoUrl",
  "logoUri",
  "mediaAvatarUri",
  "mediaLogoUrl",
]);

function isRepairableFeedPostImageUri(uri: unknown) {
  return isPersistedFeedPostImageUri(uri);
}

function isVideoFeedPostItem(item: any) {
  return (
    String(item?.type || "").toLowerCase() === "video" ||
    Boolean(String(item?.videoUrl || "").trim())
  );
}

function pickFeedPostImageCandidate(candidates: string[], avatarFields: unknown[]) {
  for (const candidate of candidates) {
    const value = String(candidate || "").trim();
    if (!value) continue;
    if (/\.(mp4|mov|m4v|webm|mkv)(\?|#|$)/i.test(value)) continue;
    if (!isRepairableFeedPostImageUri(value)) continue;
    if (
      !isPersistedFeedPostImageUri(value) &&
      feedUriMatchesAvatarMetadata(value, avatarFields)
    ) {
      continue;
    }
    return value;
  }
  return "";
}

function collectExplicitFeedPostImageCandidates(item: any): string[] {
  const roots = [item, item?.payload].filter((row) => row && typeof row === "object");
  const candidates: string[] = [];

  for (const root of roots) {
    for (const key of FEED_POST_IMAGE_FIELD_KEYS) {
      const value = String(root?.[key] || "").trim();
      if (value) candidates.push(value);
    }
    if (Array.isArray(root?.images)) {
      for (const value of root.images) {
        const next = String(value || "").trim();
        if (next) candidates.push(next);
      }
    }
    if (Array.isArray(root?.mediaUrls)) {
      for (const value of root.mediaUrls) {
        const next = String(value || "").trim();
        if (next) candidates.push(next);
      }
    }
  }

  return [...new Set(candidates)];
}

function scanFeedItemForRepairImageUri(item: any, avatarFields: unknown[]): string {
  const queue: Array<{ value: unknown; key?: string; depth: number }> = [{ value: item, depth: 0 }];
  const seen = new Set<string>();

  while (queue.length) {
    const current = queue.shift();
    if (!current) continue;
    const { value, key, depth } = current;
    if (depth > 5 || value == null) continue;

    if (typeof value === "string") {
      const trimmed = value.trim();
      if (!trimmed || seen.has(trimmed)) continue;
      seen.add(trimmed);
      const picked = pickFeedPostImageCandidate([trimmed], avatarFields);
      if (picked) return picked;
      continue;
    }

    if (Array.isArray(value)) {
      for (const entry of value) queue.push({ value: entry, key, depth: depth + 1 });
      continue;
    }

    if (typeof value === "object") {
      for (const [entryKey, entryValue] of Object.entries(value as Record<string, unknown>)) {
        if (FEED_POST_IMAGE_AVATAR_FIELD_KEYS.has(entryKey)) continue;
        queue.push({ value: entryValue, key: entryKey, depth: depth + 1 });
      }
    }
  }

  return "";
}

function resolveFeedPostImageFields(item: any) {
  if (isVideoFeedPostItem(item)) return { repaired: false as const };

  const avatarFields = feedPostImageAvatarFields(item);
  const explicitCandidates = collectExplicitFeedPostImageCandidates(item);
  let mediaUri = pickFeedPostImageCandidate(explicitCandidates, avatarFields);
  let repaired = false;

  if (!mediaUri && isChurchRoomFeedPost(item)) {
    const scanned = scanFeedItemForRepairImageUri(item, avatarFields);
    if (scanned) {
      mediaUri = scanned;
      repaired = true;
    }
  }

  if (!mediaUri) return { repaired: false as const };

  const source = String(item?.source || item?.kind || "").trim().toLowerCase();
  const existingType = String(item?.type || "").trim().toLowerCase();

  return {
    repaired,
    mediaUri,
    imageUrl: String(item?.imageUrl || item?.photoUrl || mediaUri).trim(),
    mediaType: "image" as const,
    ...(isChurchRoomFeedSource(source) && !existingType ? { type: "post" as const } : {}),
    ...(isChurchRoomFeedSource(source) ? { source } : {}),
  };
}

function buildFeedPostImageAttachment(uri: string) {
  return {
    url: uri,
    uri,
    imageUrl: uri,
    type: "image",
    mimeType: "image/jpeg",
  };
}

const MAX_FEED_POST_IMAGES = 5;

function pushFeedPostCreateImageUri(
  uris: string[],
  seen: Set<string>,
  raw: unknown,
  max = MAX_FEED_POST_IMAGES
) {
  if (uris.length >= max) return;
  const value = cleanText(raw, 2000);
  if (!value || !isPersistedFeedPostImageUri(value)) return;
  if (seen.has(value)) return;
  seen.add(value);
  uris.push(value);
}

function extractFeedPostCreateImageUris(body: any, max = MAX_FEED_POST_IMAGES): string[] {
  const seen = new Set<string>();
  const uris: string[] = [];

  if (Array.isArray(body?.images)) {
    for (const raw of body.images) pushFeedPostCreateImageUri(uris, seen, raw, max);
  }
  if (Array.isArray(body?.mediaUrls)) {
    for (const raw of body.mediaUrls) pushFeedPostCreateImageUri(uris, seen, raw, max);
  }
  if (Array.isArray(body?.attachments)) {
    for (const raw of body.attachments) {
      if (typeof raw === "string") {
        pushFeedPostCreateImageUri(uris, seen, raw, max);
      } else if (raw && typeof raw === "object") {
        for (const key of ["url", "uri", "imageUrl", "mediaUrl", "publicUrl"]) {
          pushFeedPostCreateImageUri(uris, seen, (raw as Record<string, unknown>)[key], max);
        }
      }
    }
  }
  for (const key of FEED_POST_IMAGE_FIELD_KEYS) {
    pushFeedPostCreateImageUri(uris, seen, body?.[key], max);
  }

  return uris;
}

function buildFeedPostImageFieldsPatch(imageUris: string[]) {
  const uris = (Array.isArray(imageUris) ? imageUris : [])
    .map((uri) => String(uri || "").trim())
    .filter(Boolean)
    .slice(0, MAX_FEED_POST_IMAGES);
  if (!uris.length) return {} as Record<string, unknown>;

  const primary = uris[0];
  return {
    mediaUri: primary,
    imageUrl: primary,
    photoUrl: primary,
    mediaType: "image",
    images: uris,
    mediaUrls: uris,
    attachments: uris.map(buildFeedPostImageAttachment),
  };
}

function buildFeedPostImageFieldPatch(imageUri: string) {
  return buildFeedPostImageFieldsPatch([String(imageUri || "").trim()].filter(Boolean));
}

function applyFeedPostImageFieldsToItem(item: any, imageUri: string | string[]) {
  const uris = Array.isArray(imageUri)
    ? imageUri
    : [String(imageUri || "").trim()].filter(Boolean);
  Object.assign(item, buildFeedPostImageFieldsPatch(uris));
}

function extractFeedPostCreateImageUri(body: any): string {
  return extractFeedPostCreateImageUris(body, 1)[0] || "";
}

function logFeedPostImageFieldsDiag(item: any) {
  const id = String(item?.id || "").trim();
  if (!id) return;

  const kind = String(item?.kind || item?.source || item?.type || "").trim().toLowerCase();
  const imageUrl = String(item?.imageUrl || item?.photoUrl || item?.mediaUri || "").trim() || null;
  const attachmentsCount = Array.isArray(item?.attachments) ? item.attachments.length : 0;
  const imagesCount = Array.isArray(item?.images) ? item.images.length : 0;

  console.log("KRISTO_FEED_IMAGE_FIELDS_DIAG", {
    id,
    kind,
    hasImageUrl: Boolean(imageUrl),
    imageUrl,
    attachmentsCount,
    imagesCount,
  });
}

function applyFeedPostImageEnrichment(item: any) {
  const postId = String(item?.id || "").trim();
  const isVideoItem = isVideoFeedPostItem(item);
  const resolved = resolveFeedPostImageFields(item);
  const finalMediaUri = String(
    resolved.mediaUri || item?.mediaUri || item?.imageUrl || item?.photoUrl || ""
  ).trim();
  const finalImageUrl = String(
    resolved.imageUrl || item?.imageUrl || item?.photoUrl || finalMediaUri || ""
  ).trim();
  let finalMediaType = String(resolved.mediaType || item?.mediaType || "")
    .trim()
    .toLowerCase();

  if (finalMediaUri && !isVideoItem) {
    finalMediaType = "image";
  }

  if (!finalMediaUri || isVideoItem) {
    if (isChurchRoomFeedPost(item) || isChurchRoomFeedSource(item?.source || item?.kind)) {
      logFeedPostImageFieldsDiag(item);
    }
    return { patch: {} as Record<string, unknown>, repaired: false as const };
  }

  const storedImageUris = extractFeedPostCreateImageUris(item);
  if (storedImageUris.length > 1) {
    const patch = buildFeedPostImageFieldsPatch(storedImageUris);
    if (finalImageUrl) patch.imageUrl = finalImageUrl;
    logFeedPostImageFieldsDiag({ ...item, ...patch });
    return {
      repaired: false as const,
      patch,
    };
  }

  const patch = buildFeedPostImageFieldPatch(finalMediaUri);
  patch.imageUrl = finalImageUrl;

  if (resolved.repaired && postId) {
    void upsertFeedItem({
      ...(item as ChurchFeedItem),
      ...(patch as ChurchFeedItem),
    }).catch((error) => {
      console.warn("KRISTO_FEED_IMAGE_REPAIR_PERSIST_FAILED", {
        postId,
        message: error instanceof Error ? error.message : String(error),
      });
    });
  }

  logFeedPostImageFieldsDiag({ ...item, ...patch });

  return {
    repaired: resolved.repaired === true,
    patch,
  };
}

function collectFeedItemStringFieldPaths(
  value: unknown,
  prefix = "",
  depth = 0,
  out: Array<{ path: string; value: string }> = []
) {
  if (depth > 6 || value == null) return out;

  if (typeof value === "string") {
    const trimmed = value.trim();
    if (trimmed) out.push({ path: prefix || "(root)", value: trimmed });
    return out;
  }

  if (Array.isArray(value)) {
    value.forEach((entry, index) => {
      collectFeedItemStringFieldPaths(entry, `${prefix}[${index}]`, depth + 1, out);
    });
    return out;
  }

  if (typeof value === "object") {
    for (const [key, entry] of Object.entries(value as Record<string, unknown>)) {
      const nextPrefix = prefix ? `${prefix}.${key}` : key;
      collectFeedItemStringFieldPaths(entry, nextPrefix, depth + 1, out);
    }
  }

  return out;
}

function buildFeedItemImageDebugReport(item: any, rawPayload: Record<string, unknown> | null) {
  const avatarFields = feedPostImageAvatarFields(item);
  const explicitCandidates = collectExplicitFeedPostImageCandidates(item);
  const resolved = resolveFeedPostImageFields(item);
  const scannedImageUri = scanFeedItemForRepairImageUri(item, avatarFields);
  const rawStringFields = collectFeedItemStringFieldPaths({
    item,
    rawPayload,
  });
  const imageLikeFields = rawStringFields.filter(({ value }) =>
    isRepairableFeedPostImageUri(value)
  );

  return {
    explicitCandidates,
    scannedImageUri: scannedImageUri || null,
    resolvedMediaUri: resolved.mediaUri || null,
    resolvedImageUrl: resolved.imageUrl || null,
    resolvedMediaType: resolved.mediaType || null,
    repaired: resolved.repaired === true,
    imageLikeFields,
  };
}

function isRemotePosterUri(uri: unknown) {
  const value = String(uri || "").trim();
  if (!value) return false;
  if (/^https?:\/\//i.test(value)) return true;
  return value.includes("/church-video-posters/") || value.includes("/uploads/media/posters/");
}

function resolveClientUploadPosterUri(body: any, videoUrl?: string): string | undefined {
  const candidates = [
    body?.posterUri,
    body?.videoPosterUri,
    body?.thumbnailUri,
    body?.thumbnailUrl,
  ];
  for (const raw of candidates) {
    const uri = cleanText(raw, 4000);
    if (!uri || isBrandedVideoPosterUri(uri)) continue;
    if (isRemotePosterUri(uri) || isUsableVideoPosterUri(uri, videoUrl)) {
      return uri;
    }
  }
  return undefined;
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
    const videoUrl = resolveFeedItemVideoUrl(existing);

    if (isUsableVideoPosterUri(posterUri, videoUrl)) {
      await upsertFeedItem({
        ...existing,
        mediaStatus: "ready",
        posterUri,
        videoPosterUri: posterUri,
        thumbnailUri: String((existing as any)?.thumbnailUri || posterUri).trim() || posterUri,
        brandedPoster: false,
      });
      logMediaStatus("KRISTO_MEDIA_STATUS_READY", {
        id: itemId,
        videoUrl,
        posterUri,
        source: "client-saved-cover",
      });
      return;
    }

    if (!isUsableVideoPosterUri(posterUri, videoUrl) && videoUrl) {
      if (shouldAttemptServerFfmpeg()) {
        const generated = await ensureVideoPosterForUrl(videoUrl);
        if (generated) posterUri = generated;
      }
    }

    const next: any = {
      ...existing,
      mediaStatus: "ready",
    };

    if (posterUri && isUsableVideoPosterUri(posterUri, videoUrl)) {
      next.posterUri = posterUri;
      next.videoPosterUri = posterUri;
      next.thumbnailUri = posterUri;
      next.brandedPoster = false;
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
  } else if (
    feedUriMatchesAvatarMetadata(mediaUri, avatarFields) &&
    !isPersistedFeedPostImageUri(mediaUri)
  ) {
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

function parseMeridiemTimeOnDate(base: Date, timeText: string): number {
  const rawTime = String(timeText || "").trim();
  if (!rawTime || !Number.isFinite(base.getTime())) return NaN;

  const match = rawTime.match(/(\d{1,2})(?::(\d{2}))?\s*(AM|PM)?/i);
  if (!match) return NaN;

  let hour = Number(match[1] || 0);
  const minute = Number(match[2] || 0);
  const meridiem = String(match[3] || "").toUpperCase();

  if (meridiem === "PM" && hour < 12) hour += 12;
  if (meridiem === "AM" && hour === 12) hour = 0;
  if (!meridiem && hour >= 24) return NaN;

  const d = new Date(base);
  d.setHours(hour, minute, 0, 0);
  return d.getTime();
}

function parseMediaScheduleSlotStartMs(slot: any): number {
  const explicitStart = Number(slot?.startMs || 0);
  if (explicitStart > 0) return explicitStart;

  const startsAt = String(slot?.startsAt || "").trim();
  if (startsAt) {
    const parsed = Date.parse(startsAt);
    if (Number.isFinite(parsed) && parsed > 0) return parsed;
  }

  const meetingDate = String(slot?.meetingDate || slot?.meetingDay || "").trim();
  const startTime = String(slot?.startTime || slot?.time || slot?.timeLabel || "").trim();
  if (!meetingDate) return 0;

  const base = localCalendarDateFromString(meetingDate);
  if (!base) return 0;
  if (!startTime) return base.getTime();

  const startMs = parseMeridiemTimeOnDate(base, startTime);
  return Number.isFinite(startMs) ? startMs : base.getTime();
}

function parseMediaScheduleSlotEndMs(slot: any, startMs = 0): number {
  const explicitEnd = Number(slot?.endMs || 0);
  if (explicitEnd > startMs) return explicitEnd;

  const endsAt = String(slot?.endsAt || "").trim();
  if (endsAt) {
    const parsed = Date.parse(endsAt);
    if (Number.isFinite(parsed) && parsed > startMs) return parsed;
  }

  const endDate = String(slot?.meetingEndDate || slot?.meetingDate || slot?.meetingDay || "").trim();
  const endTime = String(slot?.endTime || "").trim();
  if (endDate && endTime) {
    const base = localCalendarDateFromString(endDate);
    if (base) {
      let endMs = parseMeridiemTimeOnDate(base, endTime);
      if (Number.isFinite(endMs)) {
        if (startMs > 0 && endMs <= startMs) {
          endMs += 24 * 60 * 60 * 1000;
        }
        if (endMs > startMs) return endMs;
      }
    }
  }

  if (!startMs) return 0;
  const durationMs = Math.max(1, Number(slot?.durationMin || slot?.durationMinutes || 1)) * 60000;
  return startMs + durationMs;
}

function enrichMediaScheduleSlotTimes(slot: any) {
  if (!slot || typeof slot !== "object") return slot;

  const startMs = parseMediaScheduleSlotStartMs(slot);
  const endMs = parseMediaScheduleSlotEndMs(slot, startMs);
  if (!(startMs > 0 && endMs > startMs)) return slot;

  const formatClock = (ms: number) => {
    const d = new Date(ms);
    let hour = d.getHours();
    const minute = String(d.getMinutes()).padStart(2, "0");
    const meridiem = hour >= 12 ? "PM" : "AM";
    hour = hour % 12;
    if (hour === 0) hour = 12;
    return `${hour}:${minute} ${meridiem}`;
  };

  const meetingDate = formatLocalIsoDateFromMs(startMs);
  const meetingEndDate = formatLocalIsoDateFromMs(endMs);

  return {
    ...slot,
    startMs,
    endMs,
    startsAt: String(slot?.startsAt || "").trim() || new Date(startMs).toISOString(),
    endsAt: String(slot?.endsAt || "").trim() || new Date(endMs).toISOString(),
    meetingDate,
    meetingEndDate,
    startTime: String(slot?.startTime || slot?.time || "").trim() || formatClock(startMs),
    endTime: String(slot?.endTime || "").trim() || formatClock(endMs),
    durationMin: Math.max(1, Number(slot?.durationMin || slot?.durationMinutes || 1)),
    durationMinutes: Math.max(1, Number(slot?.durationMin || slot?.durationMinutes || 1)),
  };
}

function enrichMediaScheduleFeedItemTimes(item: any) {
  if (!isMediaScheduleFeedItem(item)) return item;
  const slots = Array.isArray(item?.scheduleSlots) ? item.scheduleSlots : [];
  if (!slots.length) return item;
  return {
    ...item,
    scheduleSlots: slots.map(enrichMediaScheduleSlotTimes),
  };
}

function logMediaScheduleSlotHomeFeedVisibility(
  item: any,
  stage: string,
  included: boolean,
  reason: string
) {
  const scheduleId = String(item?.id || item?.sourceScheduleId || "").trim();
  const slots = Array.isArray(item?.scheduleSlots) ? item.scheduleSlots : [];
  if (!slots.length) {
    console.log("KRISTO_MEDIA_SLOT_HOME_FEED_VISIBILITY", {
      slotId: null,
      scheduleId: scheduleId || null,
      stage,
      included,
      reason,
    });
    return;
  }

  for (const slot of slots) {
    console.log("KRISTO_MEDIA_SLOT_HOME_FEED_VISIBILITY", {
      slotId: String(slot?.id || "").trim() || null,
      scheduleId: scheduleId || null,
      stage,
      included,
      reason,
    });
  }
}

function mediaScheduleSlotHasValidTimeWindow(slot: any) {
  if (!slot) return false;
  const startMs = parseMediaScheduleSlotStartMs(slot);
  const endMs = parseMediaScheduleSlotEndMs(slot, startMs);
  return startMs > 0 && endMs > startMs;
}

function mediaScheduleFeedItemHasValidSlotTimes(item: any) {
  if (!isMediaScheduleFeedItem(item)) return true;
  const slots = Array.isArray(item?.scheduleSlots) ? item.scheduleSlots : [];
  if (!slots.length) return false;
  return slots.every((slot: any) => mediaScheduleSlotHasValidTimeWindow(slot));
}

const hiddenInvalidScheduleIdsServer = new Set<string>();

const HOME_FEED_NON_VIDEO_SOURCES = new Set([
  "testimony",
  "announcement",
  "counsel",
  "prayer",
  "prayer_request",
  "prayer-request",
]);

/** Global Home Feed: any post with playable video media (not kind=video only). */
function isHomeFeedVideoMediaOnlyItem(item: any): boolean {
  if (!item) return false;
  if (isMediaScheduleFeedItem(item)) return true;

  const source = String(item?.source || item?.kind || "").trim().toLowerCase();
  const type = String(item?.type || "").trim().toLowerCase();
  if (HOME_FEED_NON_VIDEO_SOURCES.has(source) || HOME_FEED_NON_VIDEO_SOURCES.has(type)) {
    return false;
  }

  return Boolean(resolveFeedItemVideoUrl(item));
}

function filterHomeFeedRenderableRows(rows: any[], nowMs = Date.now()) {
  return rows.filter((item) => {
    if (!isMediaScheduleFeedItem(item)) return true;
    const enriched = enrichMediaScheduleFeedItemTimes(item);
    const scheduleId = String(item?.id || item?.sourceScheduleId || "").trim();
    const churchId = String(item?.churchId || "").trim();

    if (!mediaScheduleFeedItemHasValidSlotTimes(enriched)) {
      const id = String(item?.id || "").trim();
      if (id && !hiddenInvalidScheduleIdsServer.has(id)) {
        hiddenInvalidScheduleIdsServer.add(id);
        console.log("KRISTO_HOME_FEED_SCHEDULE_HIDDEN_INVALID_TIME", {
          scheduleId: id,
          source: "api",
          slotCount: Array.isArray(item?.scheduleSlots) ? item.scheduleSlots.length : 0,
        });
      }
      logMediaScheduleSlotHomeFeedVisibility(
        enriched,
        "api_filterHomeFeedRenderableRows",
        false,
        "invalid_slot_time_window"
      );
      return false;
    }

    if (areAllScheduleSlotsExpired(enriched, nowMs)) {
      const slots = Array.isArray(enriched?.scheduleSlots) ? enriched.scheduleSlots : [];
      const lastEndMs = slots.reduce((max: number, slot: any) => {
        const endMs = parseMediaScheduleSlotEndMs(slot, parseMediaScheduleSlotStartMs(slot));
        return endMs > max ? endMs : max;
      }, 0);
      logHomeFeedScheduleExpired({
        scheduleId,
        churchId,
        reason: "all_slots_expired",
        endedAt: lastEndMs > 0 ? new Date(lastEndMs).toISOString() : null,
      });
      logHomeFeedScheduleRemoved({
        scheduleId,
        churchId,
        source: "api_filterHomeFeedRenderableRows",
      });
      logMediaScheduleSlotHomeFeedVisibility(
        enriched,
        "api_filterHomeFeedRenderableRows",
        false,
        "all_slots_expired"
      );
      return false;
    }

    logMediaScheduleSlotHomeFeedVisibility(
      enriched,
      "api_filterHomeFeedRenderableRows",
      true,
      "valid_slot_time_window"
    );
    return true;
  });
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
    item?.actorAvatarUri,
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
    await createNotification({
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
  const feedDeleted = await deleteFeedItemById(postId);
  await deleteEngagementForPost(postId);
  return feedDeleted;
}

function resolveFeedItemVideoUrl(item: any): string {
  const isVideoTyped =
    item?.type === "video" ||
    String(item?.mediaType || "").trim().toLowerCase() === "video" ||
    String(item?.kind || "").trim().toLowerCase() === "media";

  for (const key of [
    "videoUrl",
    "videoUri",
    "mediaVideoUrl",
    "playbackUrl",
    "mediaUrl",
    "url",
  ]) {
    const raw = String(item?.[key] || "").trim();
    if (!raw) continue;
    const clean = raw.split("?")[0];
    if (/\.(mp4|mov|m4v|webm|mkv)(\?|#|$)/i.test(clean) || isVideoTyped) return raw;
  }

  const mediaUri = String(item?.mediaUri || "").trim();
  if (/\.(mp4|mov|m4v|webm|mkv)(\?|#|$)/i.test(mediaUri.split("?")[0])) return mediaUri;

  const media = item?.media;
  if (media && typeof media === "object") {
    const mediaType = String(media.type || media.mediaType || "").trim().toLowerCase();
    if (mediaType === "video") {
      for (const key of ["url", "uri", "videoUrl", "playbackUrl", "mediaUrl"]) {
        const raw = String(media[key] || "").trim();
        if (raw) return raw;
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
        const raw = String(entry[key] || "").trim();
        if (raw) return raw;
      }
    }
  }

  return String(item?.videoUrl || "").trim();
}

function isFeedVideoListItem(item: any) {
  return item?.type === "video" || Boolean(resolveFeedItemVideoUrl(item));
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
  const persistedAuthor = await resolvePersistedFeedAuthorFields({
    userId: String(item?.createdBy || ""),
    item,
  });

  const postId = String(item?.id || "").trim();

  let posterUri =
    String(item?.posterUri || item?.videoPosterUri || "").trim() || undefined;
  let thumbnailUri =
    String(item?.thumbnailUri || item?.thumbnailUrl || item?.videoPosterUri || "").trim() ||
    undefined;
  let videoBrandedPoster = item?.brandedPoster === true;
  const resolvedVideoUrl = resolveFeedItemVideoUrl(item);
  const isVideoItem = isFeedVideoListItem(item);

  if (isVideoItem && resolvedVideoUrl) {
    const videoUrlStr = resolvedVideoUrl;
    const hasUsablePoster =
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
      } else {
        videoBrandedPoster = false;
      }

      if (postId) {
        void upsertFeedItem({
          ...item,
          posterUri,
          videoPosterUri: posterUri,
          thumbnailUri,
          ...(usingBranded ? brandedVideoPosterFields() : { brandedPoster: false }),
        }).catch(() => {});
      }
    } else if (item?.brandedPoster === true) {
      videoBrandedPoster = false;
      if (postId) {
        void upsertFeedItem({
          ...item,
          posterUri,
          videoPosterUri: posterUri,
          thumbnailUri,
          brandedPoster: false,
        }).catch(() => {});
      }
    }
  }

  let previewVideoUrl =
    String(item?.previewVideoUrl || item?.lowResVideoUrl || "").trim() || undefined;
  if (isVideoItem && resolvedVideoUrl && !previewVideoUrl) {
    try {
      previewVideoUrl = (await findExistingPreviewVideoUrl(resolvedVideoUrl)) || undefined;
    } catch {}
  }

  const videoPosterUri = posterUri || thumbnailUri;

  if (isVideoItem && resolvedVideoUrl) {
    const videoUrlStr = resolvedVideoUrl;
    const posterHost = (() => {
      try {
        return videoPosterUri ? new URL(videoPosterUri, "https://kristo.local").host : null;
      } catch {
        return null;
      }
    })();
    const videoHost = (() => {
      try {
        return new URL(videoUrlStr).host;
      } catch {
        return null;
      }
    })();
    const storedContentLength =
      Number(item?.sizeBytes || item?.fileSizeBytes || 0) || null;
    const storageKey = storageKeyFromPublicUrl(videoUrlStr);
    let objectHead: Awaited<ReturnType<typeof headStorageObject>> | null = null;
    if (storageKey) {
      try {
        objectHead = await headStorageObject(storageKey);
      } catch {}
    }

    const shouldProbeMp4 =
      (item as any)?.faststart !== true || process.env.KRISTO_PROBE_MP4_FASTSTART === "1";

    console.log("KRISTO_FEED_VIDEO_FILE_DIAG", {
      id: postId,
      videoUrlHost: videoHost,
      posterHost,
      contentLength: objectHead?.contentLength || storedContentLength,
      contentType: objectHead?.contentType || null,
      cacheControl: objectHead?.cacheControl || null,
      hasPosterUrl: Boolean(videoPosterUri),
      acceptRanges: objectHead?.acceptRanges || null,
      storedFaststart: (item as any)?.faststart === true,
      faststartPending: (item as any)?.faststartPending === true,
      faststartReason: (item as any)?.faststartReason || null,
    });

    if (shouldProbeMp4) {
      void probeMp4FaststartFromUrl(videoUrlStr)
        .then((mp4Probe) => {
          console.log("KRISTO_VIDEO_MP4_FASTSTART_DIAG", {
            id: postId,
            hasFastStart:
              mp4Probe?.hasFastStart === true || (item as any)?.faststart === true,
            moovPositionHint: mp4Probe?.moovPositionHint || "unknown",
            contentLength:
              mp4Probe?.contentLength ||
              objectHead?.contentLength ||
              storedContentLength,
            probed: true,
            storedFaststart: (item as any)?.faststart === true,
          });
        })
        .catch(() => {
          console.log("KRISTO_VIDEO_MP4_FASTSTART_DIAG", {
            id: postId,
            hasFastStart: (item as any)?.faststart === true,
            moovPositionHint: "unknown",
            contentLength: objectHead?.contentLength || storedContentLength,
            probed: false,
            storedFaststart: (item as any)?.faststart === true,
          });
        });
    }

    console.log("KRISTO_FEED_VIDEO_POSTER_FIELDS", {
      postId,
      hasPosterUri: Boolean(posterUri),
      hasThumbnailUri: Boolean(thumbnailUri),
      hasPosterUrl: Boolean(videoPosterUri),
      posterHost,
      videoUrlHost: videoHost,
      contentLength: objectHead?.contentLength || storedContentLength,
      brandedPoster: videoBrandedPoster,
    });
  }

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

  const postImageEnrichment = applyFeedPostImageEnrichment(item);

  return withVideoMetadataReturnFields({
    ...item,
    ...postImageEnrichment.patch,
    ...(resolvedVideoUrl ? { videoUrl: resolvedVideoUrl } : {}),
    ...(previewVideoUrl ? { previewVideoUrl, lowResVideoUrl: previewVideoUrl } : {}),
    ...(posterUri ? { posterUri } : {}),
    ...(thumbnailUri ? { thumbnailUri } : {}),
    ...(videoPosterUri ? { videoPosterUri } : {}),
    brandedPoster: videoBrandedPoster,
    ownershipType,
    ownerChurchId: String(item?.ownerChurchId || itemChurchId || ""),
    ownerMediaId: String(item?.ownerMediaId || item?.mediaName || itemMediaProfile?.mediaName || "").trim() || undefined,
    authorName: persistedAuthor.authorName,
    actorLabel: persistedAuthor.actorLabel,
    postedByName: persistedAuthor.postedByName,
    displayName: persistedAuthor.displayName,
    authorAvatarUri: firstNonEmptyAvatar(
      persistedAuthor.authorAvatarUri,
      authorEnrichment.finalAvatarUri,
      authorEnrichment.authorAvatarUri
    ),
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
    scheduleSlots: await enrichScheduleSlotsClaimAvatars(
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
    const persistedAuthor = await resolvePersistedFeedAuthorFields({
      userId: String(item?.createdBy || ""),
      item,
    }).catch(() =>
      buildPersistedAuthorFields(fallbackAuthor.authorName, String(item?.createdBy || ""), item)
    );
    const authorEnrichment = resolveFeedAuthorEnrichment({
      item,
      itemChurchProfile: null,
      itemMediaProfile: null,
      ownershipType,
      fallbackAuthor,
    });
    return {
      ...item,
      ...applyFeedPostImageEnrichment(item).patch,
      ownershipType,
      authorName: persistedAuthor.authorName,
      actorLabel: persistedAuthor.actorLabel,
      postedByName: persistedAuthor.postedByName,
      displayName: persistedAuthor.displayName,
      authorAvatarUri: firstNonEmptyAvatar(
        persistedAuthor.authorAvatarUri,
        authorEnrichment.finalAvatarUri,
        authorEnrichment.authorAvatarUri
      ),
      churchAvatarUri: authorEnrichment.churchAvatarUri,
      ...(authorEnrichment.churchLogoUrl ? { churchLogoUrl: authorEnrichment.churchLogoUrl } : {}),
      ...(authorEnrichment.mediaAvatarUri ? { mediaAvatarUri: authorEnrichment.mediaAvatarUri } : {}),
      ...(authorEnrichment.mediaLogoUrl ? { mediaLogoUrl: authorEnrichment.mediaLogoUrl } : {}),
      scheduleSlots: await enrichScheduleSlotsClaimAvatars(
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

function feedItemScopeLabel(item: any): "GLOBAL" | "CHURCH" {
  if (isMediaScheduleFeedItem(item)) return "CHURCH";

  const visibility = feedItemVisibility(item);
  if (visibility.includes("private")) return "CHURCH";
  if (visibility.includes("members")) return "CHURCH";
  if (visibility.includes("church") && !visibility.includes("public") && !visibility.includes("global")) {
    return "CHURCH";
  }
  if (visibility.includes("global") || visibility.includes("public")) return "GLOBAL";
  return "GLOBAL";
}

function feedItemVisibilityLabel(item: any): "public" | "church" {
  return feedItemScopeLabel(item) === "GLOBAL" ? "public" : "church";
}

function isPublicOrGlobalFeedItem(item: any) {
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

/** Home/global feed: public posts from all churches; schedules stay church-scoped. */
function isGlobalFeedDiscoverable(item: any, viewerChurchId: string) {
  const itemChurchId = String(item?.churchId || "").trim();
  const viewerCid = String(viewerChurchId || "").trim();

  if (isMediaScheduleFeedItem(item)) {
    // Cross-church: any member can discover active media schedules in Home Feed.
    return Boolean(viewerCid);
  }

  if (isPublicOrGlobalFeedItem(item)) return true;
  return Boolean(viewerCid && itemChurchId === viewerCid);
}

/** Church tab/room: only the viewer's church (+ discoverability rules). */
function isStrictChurchFeedDiscoverable(item: any, viewerChurchId: string) {
  const itemChurchId = String(item?.churchId || "").trim();
  const ownerCid = String(item?.ownerChurchId || "").trim();
  const viewerCid = String(viewerChurchId || "").trim();
  if (!viewerCid) return false;

  if (itemChurchId && itemChurchId !== viewerCid) {
    if (!ownerCid || ownerCid !== viewerCid) return false;
  }

  return isDiscoverableFeedItem(item, viewerChurchId);
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

function isDiscoverableFeedItem(item: any, viewerChurchId: string) {
  if (isDeletedFeedItem(item)) return false;
  if (isHiddenByReportsFeedItem(item)) return false;

  const itemChurchId = String(item?.churchId || "").trim();
  const viewerCid = String(viewerChurchId || "").trim();

  if (isMediaScheduleFeedItem(item)) {
    return Boolean(viewerCid);
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
    const feedScope = String(url.searchParams.get("scope") || "church").trim().toLowerCase();
    const isGlobalFeedScope = feedScope === "global" || feedScope === "home";
    const mediaOnly =
      isGlobalFeedScope &&
      (url.searchParams.get("mediaOnly") === "1" ||
        url.searchParams.get("mediaOnly") === "true" ||
        url.searchParams.get("feedKind") === "video");

    // Endless-feed paging. When `limit` is provided we return a page sliced at
    // `cursor`/`offset`; without it the full list is returned (legacy behavior).
    const limitParamRaw = Number(url.searchParams.get("limit") || 0);
    const cursorParamRaw = String(
      url.searchParams.get("cursor") ?? url.searchParams.get("offset") ?? ""
    ).trim();
    const pageLimit =
      Number.isFinite(limitParamRaw) && limitParamRaw > 0
        ? Math.min(Math.floor(limitParamRaw), 100)
        : 0;
    const pageOffset = Math.max(0, Math.floor(Number(cursorParamRaw) || 0));
    const searchQueryParse = parseHomeFeedSearchQueryParam(url.searchParams);

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
        .filter((x: any) => !isDeletedFeedItem(x))
        .filter((x: any) => String(x?.churchId || "") === viewerChurchId)
        .filter((x: any) => (storageMode === "media" ? isMediaOwnedFeedItem(x) : true))
        .filter((x) => (type ? x.type === type : true))
        .slice()
        .sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1))
        .map((item) => safeEnrichFeedListItem(item, viewerUserId));

      const resolvedStorageItems = await Promise.all(storageItems);

      return feedListOk(viewerChurchId, resolvedStorageItems);
    }

    if (url.searchParams.get("debug") === "feed_item") {
      const debugId = String(url.searchParams.get("id") || "").trim();
      if (!debugId) return err("id query param is required for debug=feed_item", 400);

      const item = await getFeedItemById(debugId);
      if (!item) return err("Feed item not found", 404);

      const imageReport = buildFeedItemImageDebugReport(item, null);

      console.log("KRISTO_FEED_ITEM_DEBUG", {
        postId: debugId,
        source: item?.source,
        type: item?.type,
        rawMediaUri: item?.mediaUri || null,
        rawImageUrl: (item as any)?.imageUrl || null,
        mediaType: (item as any)?.mediaType || null,
        explicitCandidates: imageReport.explicitCandidates,
        scannedImageUri: imageReport.scannedImageUri,
        resolvedMediaUri: imageReport.resolvedMediaUri,
        resolvedImageUrl: imageReport.resolvedImageUrl,
        resolvedMediaType: imageReport.resolvedMediaType,
        imageLikeFieldCount: imageReport.imageLikeFields.length,
      });

      return ok({
        postId: debugId,
        item,
        imageReport,
      });
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

      const enrichedSlots = await enrichScheduleSlotsClaimAvatars(
        Array.isArray(item?.scheduleSlots) ? item.scheduleSlots : []
      );

      const detail: FeedPostDetail = {
        item: {
          ...item,
          scheduleSlots: enrichedSlots,
          commentCount,
          replyCount,
          totalDiscussionCount: commentCount + replyCount,
        },
        comments,
      };

      return ok(detail);
    }

    let rawRows = isGlobalFeedScope
      ? await listFeedItems()
      : await listFeedItemsForChurch(churchId);
    if (!isGlobalFeedScope && rawRows.length === 0) {
      const fallbackRows = await listFeedItems();
      rawRows = fallbackRows.filter((x: any) => {
        const cid = String(x?.churchId || "").trim();
        const ownerCid = String(x?.ownerChurchId || "").trim();
        return cid === churchId || ownerCid === churchId;
      });
    }
    const allRows = rawRows
      .filter((x: any) => {
        if (isDeletedFeedItem(x)) return false;
        const isMediaUpload =
          String(x?.source || "") === "media-upload" ||
          String(x?.ownershipType || "") === "media";
        const hasRemoteVideo =
          String(x?.videoUrl || x?.videoUri || x?.mediaUrl || "").startsWith("http");
        if (isMediaUpload && hasRemoteVideo) return true;
        return feedVideoAssetExists(x);
      })
      .map(enrichMediaScheduleFeedItemTimes);
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

    const discoverable = isGlobalFeedScope ? isGlobalFeedDiscoverable : isStrictChurchFeedDiscoverable;
    const afterDiscover = allRows.filter((x: any) => discoverable(x, churchId));
    const homeReadyRows = filterHomeFeedRenderableRows(
      afterDiscover.filter((x: any) => isHomeFeedReadyItem(x))
    );

    const crossChurchIncluded = isGlobalFeedScope
      ? homeReadyRows.filter((x: any) => {
          const itemCid = String(x?.churchId || "").trim();
          return itemCid && churchId && itemCid !== churchId && isPublicOrGlobalFeedItem(x);
        }).length
      : 0;

    if (isGlobalFeedScope) {
      console.log("KRISTO_GLOBAL_FEED_FILTER", {
        scope: "GLOBAL",
        visibility: "public",
        viewerChurchId: churchId,
        rawRows: rawRows.length,
        afterDiscover: afterDiscover.length,
        homeReadyRows: homeReadyRows.length,
        crossChurchIncluded,
      });
      if (crossChurchIncluded > 0) {
        console.log("KRISTO_GLOBAL_FEED_CROSS_CHURCH_INCLUDED", {
          viewerChurchId: churchId,
          count: crossChurchIncluded,
          sampleIds: homeReadyRows
            .filter((x: any) => {
              const itemCid = String(x?.churchId || "").trim();
              return itemCid && churchId && itemCid !== churchId;
            })
            .slice(0, 6)
            .map((x: any) => ({
              id: String(x?.id || ""),
              churchId: String(x?.churchId || ""),
              scope: feedItemScopeLabel(x),
              visibility: feedItemVisibilityLabel(x),
            })),
        });
      }
    } else {
      console.log("KRISTO_CHURCH_FEED_FILTER_STRICT", {
        scope: "CHURCH",
        visibility: "church",
        viewerChurchId: churchId,
        rawRows: rawRows.length,
        afterDiscover: afterDiscover.length,
        homeReadyRows: homeReadyRows.length,
      });
    }

    console.log("KRISTO_FEED_DEBUG_AFTER_FILTERS", {
      churchId,
      feedScope: isGlobalFeedScope ? "GLOBAL" : "CHURCH",
      afterDiscover: afterDiscover.length,
      homeReadyRows: homeReadyRows.length,
      mediaAfterDiscover: afterDiscover.filter((x: any) => String(x?.source || "") === "media-upload").length,
      mediaHomeReady: homeReadyRows.filter((x: any) => String(x?.source || "") === "media-upload").length,
      crossChurchIncluded,
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
    const viewerSubscriptionActive = churchId
      ? await isChurchSubscriptionActive(churchId, { gate: "home_feed_media_slots" })
      : false;
    const viewerCanSeeMediaSlots = hasMembership && viewerSubscriptionActive;

    const forcedMediaHomeRows = rawRows.filter((x: any) => {
      const sameChurch =
        String(x?.churchId || "").trim() === churchId ||
        String(x?.ownerChurchId || "").trim() === churchId;
      const isMediaUpload = String(x?.source || "").toLowerCase() === "media-upload";
      const isReady = String(x?.mediaStatus || "ready").toLowerCase() === "ready";
      const hasVideo = Boolean(String(x?.videoUrl || x?.videoUri || x?.mediaUrl || "").trim());
      return sameChurch && isMediaUpload && isReady && hasVideo;
    });

    let mergedHomeRows = [...forcedMediaHomeRows, ...homeReadyRows].filter(
      (x: any, idx, arr) => arr.findIndex((y: any) => String(y?.id || "") === String(x?.id || "")) === idx
    );

    if (churchId) {
      mergedHomeRows = await reconcileMediaScheduleFeedRowsForChurch({
        churchId,
        rows: mergedHomeRows,
        persistStaleDeletes: true,
        reason: isGlobalFeedScope ? "feed-get-global-reconcile" : "feed-get-church-reconcile",
      });
    }

    const listRows = mergedHomeRows
      .filter((x: any) => {
        if (isClaimableScheduleFeedItem(x) && !viewerCanSeeMediaSlots) {
          return false;
        }
        if (isClaimableScheduleFeedItem(x) && viewerCanSeeMediaSlots) {
          const itemCid = String(x?.churchId || "").trim();
          if (itemCid && churchId && itemCid !== churchId) {
            console.log("KRISTO_HOME_FEED_CROSS_CHURCH_SLOT_VISIBLE", {
              viewerChurchId: churchId,
              scheduleChurchId: itemCid,
              scheduleId: String(x?.id || ""),
              reason: "cross_church_claim_slot_v2",
            });
          }
        }
        return true;
      })
      .filter((x) => (type ? x.type === type : true))
      .filter((x) => (mediaOnly ? isHomeFeedVideoMediaOnlyItem(x) : true))
      .slice()
      .sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));

    // Optional `q`: filter full eligible list before pagination (empty/rejected → unchanged).
    const searchableRows = searchQueryParse.active
      ? filterHomeFeedRowsBySearchQuery(listRows, searchQueryParse.normalizedQuery)
      : listRows;
    if (searchQueryParse.active || searchQueryParse.rejected) {
      console.log("KRISTO_FEED_SEARCH_PAGE", {
        scope: isGlobalFeedScope ? "GLOBAL" : "CHURCH",
        mediaOnly,
        active: searchQueryParse.active,
        rejected: searchQueryParse.rejected,
        reason: searchQueryParse.reason,
        normalizedQueryLength: searchQueryParse.normalizedQuery.length,
        eligibleCount: listRows.length,
        matchedCount: searchableRows.length,
        offset: pageOffset,
        limit: pageLimit,
      });
    }

    const totalListRows = searchableRows.length;
    const pageRows =
      pageLimit > 0 ? searchableRows.slice(pageOffset, pageOffset + pageLimit) : searchableRows;
    const nextOffset = pageOffset + (pageLimit > 0 ? pageLimit : pageRows.length);
    const pageHasMore = pageLimit > 0 ? nextOffset < totalListRows : false;
    const pageNextCursor = pageHasMore ? String(nextOffset) : null;

    const listPostIds = pageRows
      .map((x: any) => String(x?.id || "").trim())
      .filter(Boolean);
    const discussionByPostId = await countDiscussionForPostIds(listPostIds);
    const listEngagement: FeedListEngagementMeta = { discussionByPostId };

    const items = pageRows.map((item) =>
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
      viewerSubscriptionActive,
      viewerCanSeeMediaSlots,
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

    if (pageLimit > 0) {
      console.log("KRISTO_FEED_GET_PAGE", {
        churchId,
        scope: isGlobalFeedScope ? "GLOBAL" : "CHURCH",
        mediaOnly,
        searchActive: searchQueryParse.active,
        normalizedQueryLength: searchQueryParse.active
          ? searchQueryParse.normalizedQuery.length
          : 0,
        offset: pageOffset,
        limit: pageLimit,
        total: totalListRows,
        returned: resolvedItems.length,
        hasMore: pageHasMore,
        nextCursor: pageNextCursor,
      });
      return feedListPageOk(churchId, resolvedItems, {
        hasMore: pageHasMore,
        nextCursor: pageNextCursor,
        total: totalListRows,
        offset: pageOffset,
      });
    }

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

  const action = String(body?.action || "").trim();
  if (action === "clear_media_schedule_slots") {
    const ctxOrRes = await guard(req);
    if ("ok" in (ctxOrRes as any) === false && ctxOrRes instanceof NextResponse) {
      return ctxOrRes;
    }
    const a = ctxOrRes as any;
    console.log("KRISTO_CLEAR_MEDIA_SCHEDULE_SLOTS_SERVER", {
      action,
      feedId: body?.feedId || body?.postId || "",
      churchId: body?.churchId || a?.churchId || "",
      slotsLength: Array.isArray(body?.slots) ? body.slots.length : null,
      serverBuild: "main-clear-media-schedule-slots",
      stage: "early-handler-hit",
    });
    return await handleClearMediaScheduleSlots(body, a);
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
    console.log("KRISTO_SCHEDULE_TOPIC_TRACE", {
      stage: "backend_create_received",
      topic: String(body?.topic || "").trim(),
      scheduleTopic: String(body?.scheduleTopic || "").trim(),
      meetingTopic: String(body?.meetingTopic || "").trim(),
      meetingType: String(body?.meetingType || "").trim(),
      firstSlot: Array.isArray(body?.scheduleSlots) && body.scheduleSlots[0]
        ? {
            name: String(body.scheduleSlots[0]?.name || ""),
            slotTopic: String(body.scheduleSlots[0]?.slotTopic || ""),
            script: String(body.scheduleSlots[0]?.script || ""),
            parentTopic: String(body.scheduleSlots[0]?.parentTopic || ""),
            scheduleTopic: String(body.scheduleSlots[0]?.scheduleTopic || ""),
            meetingTopic: String(body.scheduleSlots[0]?.meetingTopic || ""),
            task: String(body.scheduleSlots[0]?.task || ""),
          }
        : null,
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

async function handleClearMediaScheduleSlots(body: any, ctx: any) {
  const action = "clear_media_schedule_slots";
  const churchId = String(ctx?.churchId || "").trim();
  const viewerUserId = String(ctx?.viewer?.userId || ctx?.viewer?.id || "u-unknown");
  const postId = cleanText(body?.postId || body?.feedId, 240);
  const targetChurchId = String(body?.churchId || churchId || "").trim();
  const slotsLength = Array.isArray(body?.slots) ? body.slots.length : 0;

  console.log("KRISTO_CLEAR_MEDIA_SCHEDULE_SLOTS_SERVER", {
    action,
    feedId: postId,
    churchId: targetChurchId,
    slotsLength,
    serverBuild: "main-clear-media-schedule-slots",
    stage: "handle-clear-media-schedule-slots",
  });

  if (!postId) return err("postId/feedId is required", 400);
  if (!targetChurchId) return err("churchId is required", 400);

  const viewerAppRole = String(ctx?.viewer?.role || ctx?.role || "");
  const subscriptionBlocked = await requireChurchSubscriptionActive(targetChurchId, {
    endpoint: "/api/church/feed",
    churchId: targetChurchId,
    userId: viewerUserId,
    role: viewerAppRole,
    action: "clear_media_schedule_slots",
  });
  if (subscriptionBlocked) return subscriptionBlocked;

  const item = await getFeedItemById(postId);
  if (!item) return err("Feed item not found", 404);

  const itemChurchId = String(item?.churchId || targetChurchId || "").trim();
  if (itemChurchId && itemChurchId !== targetChurchId) {
    return err("Feed item not in your church", 403);
  }

  const permissionErr = await assertScheduleEditPermission({
    churchId: targetChurchId,
    viewerUserId,
    viewerAppRole,
    item,
    body,
  });
  if (permissionErr) return err(permissionErr, 403);

  const nextSlots = Array.isArray(body?.slots)
    ? body.slots.map(enrichMediaScheduleSlotTimes)
    : [];

  const prevSlots = Array.isArray(item?.scheduleSlots) ? item.scheduleSlots : [];
  const nextSlotIdSet = new Set(
    nextSlots
      .map((slot: any) => String(slot?.id || slot?.slotId || "").trim())
      .filter(Boolean)
  );
  const clearedSlotClaims: Array<{ slotId: string; userId: string }> = [];
  for (const slot of prevSlots) {
    const slotId = String(slot?.id || slot?.slotId || "").trim();
    if (!slotId || nextSlotIdSet.has(slotId)) continue;
    const claimUserId = String(
      slot?.claimedByUserId || slot?.claimedBy?.userId || ""
    ).trim();
    if (claimUserId) {
      clearedSlotClaims.push({ slotId, userId: claimUserId });
    }
  }
  if (clearedSlotClaims.length) {
    console.log("KRISTO_BACKEND_SLOT_CLAIMS_CLEARED_ON_DELETE", {
      feedId: postId,
      churchId: targetChurchId,
      clearedSlotClaims,
    });
  }

  if (!nextSlots.length) {
    const { endStaleMediaScheduleFeedItem } = await import("@/app/api/_lib/staleMediaScheduleFeed");
    const ended = await endStaleMediaScheduleFeedItem({
      postId: String(item.id || postId),
      churchId: targetChurchId,
      reason: String(body?.reason || "clear_media_schedule_slots"),
      deletedBy: viewerUserId,
    });

    if (!ended.ok) {
      return err(String(ended.error || "Could not clear media schedule slots"), 404);
    }

    bumpMediaScheduleSync(targetChurchId, "clear_media_schedule_slots");
    return ok({
      ok: true,
      action: "clear_media_schedule_slots",
      serverBuild: "main-clear-media-schedule-slots",
      stage: "early-handler-hit",
      feedId: postId,
      postId,
      slots: [],
      deleted: ended.deleted,
      endedLiveKeys: ended.endedLiveKeys,
    });
  }

  const updatedItem = {
    ...item,
    scheduleSlots: nextSlots,
    status: String(item?.status || "active"),
    scheduleStatus: String(item?.scheduleStatus || "active"),
  };
  await upsertFeedItem(updatedItem);
  bumpMediaScheduleSyncForFeedItem(updatedItem, "clear_media_schedule_slots");

  const activeSlotCount = getActiveScheduleSlots(updatedItem).length;
  if (activeSlotCount === 0) {
    const scheduleLiveId = String(
      updatedItem.sourceScheduleId || updatedItem.liveId || updatedItem.id || postId
    ).trim();
    try {
      const { endChurchLiveSessionsForSchedule } = await import("@/app/api/_lib/churchLiveControl");
      await endChurchLiveSessionsForSchedule({
        churchId: targetChurchId,
        liveId: scheduleLiveId,
        reason: "clear_media_schedule_slots-no-active-slots",
      });
    } catch (liveEndError: any) {
      console.log("KRISTO_CLEAR_MEDIA_SCHEDULE_SLOTS_LIVE_END_FAILED", {
        churchId: targetChurchId,
        postId,
        message: String(liveEndError?.message || liveEndError),
      });
    }
  }

  return ok({
    ok: true,
    action: "clear_media_schedule_slots",
    serverBuild: "main-clear-media-schedule-slots",
    stage: "early-handler-hit",
    feedId: postId,
    postId,
    slots: nextSlots,
    deleted: false,
    remainingCount: nextSlots.length,
  });
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

  if (action === "clear_media_schedule_slots") {
    return await handleClearMediaScheduleSlots(body, ctx);
  }

  if (action === "end_stale_media_schedule") {
    const postId = cleanText(body?.postId || body?.feedId, 240);
    const targetChurchId = String(body?.churchId || churchId || "").trim();
    if (!postId) return err("postId/feedId is required", 400);
    if (!targetChurchId) return err("churchId is required", 400);

    const viewerAppRole = String(ctx?.viewer?.role || ctx?.role || "");
    const ministryId = resolveScheduleMinistryId(null, body);
    const isMediaHost = await isMediaHostForChurch(targetChurchId, viewerUserId);
    const canEnd = await canCreateOrEditScheduleSlots({
      churchId: targetChurchId,
      viewerUserId,
      viewerAppRole,
      ministryId,
      isMediaSchedule: true,
      isMediaHost,
    });
    if (!canEnd) {
      return err("Only Pastor, Leader, or Host can end stale media schedules", 403);
    }

    const { endStaleMediaScheduleFeedItem } = await import("@/app/api/_lib/staleMediaScheduleFeed");
    const result = await endStaleMediaScheduleFeedItem({
      postId,
      churchId: targetChurchId,
      reason: String(body?.reason || "end_stale_media_schedule"),
      deletedBy: viewerUserId,
    });

    if (!result.ok) {
      return err(String(result.error || "Could not end stale media schedule"), 404);
    }

    bumpMediaScheduleSync(targetChurchId, "end_stale_media_schedule");
    return ok(result);
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

    const beforeLikeMeta = await getPostLikeMeta(itemChurchId, canonicalPostId, viewerUserId);

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

    if (likeResult.likedByMe && !beforeLikeMeta.likedByMe) {
      try {
        if (isPrayerRequestFeedItem(item)) {
          const notified = await notifyPrayerRequestPrayedFor({
            churchId: itemChurchId,
            postId: canonicalPostId,
            actorUserId: viewerUserId,
            feedItem: item,
            actorName: viewerName || actorLabel,
          });
          if (notified) {
            console.log("KRISTO_PRAYER_NOTIFY", {
              postId: canonicalPostId,
              actorUserId: viewerUserId,
            });
          }
        } else {
          await notifyFeedPostLiked({
            churchId: itemChurchId,
            postId: canonicalPostId,
            actorUserId: viewerUserId,
            feedItem: item,
            actorName: viewerName || actorLabel,
          });
        }
      } catch (notifyError: any) {
        console.log("KRISTO_FEED_COMMENT_NOTIFICATION_ERROR", {
          postId: canonicalPostId,
          action: "toggle_like",
          message: String(notifyError?.message || notifyError),
        });
      }
    }

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

    try {
      if (action === "add_comment") {
        const notified = await notifyFeedCommentOnPost({
          churchId: itemChurchId,
          postId: canonicalPostId,
          commentId: comment.id,
          commenterUserId: viewerUserId,
          commentText: text,
          feedItem: item,
          actorName: author.authorName,
        });
        if (!notified) {
          console.log("KRISTO_COMMENT_NOTIFY_NOOP", {
            postId: canonicalPostId,
            commentId: comment.id,
            commenterUserId: viewerUserId,
            postAuthorUserId: resolveFeedPostAuthorUserId(item),
          });
        }
      } else if (comment.parentCommentId) {
        const parentComment = await findFeedCommentById(comment.parentCommentId);
        const parentAuthorUserId = String(parentComment?.createdBy || "").trim();
        if (parentAuthorUserId) {
          await notifyFeedReplyToComment({
            churchId: itemChurchId,
            postId: canonicalPostId,
            replyCommentId: comment.id,
            replierUserId: viewerUserId,
            replyText: text,
            parentCommentAuthorUserId: parentAuthorUserId,
            actorName: author.authorName,
          });
        }
      }
    } catch (notifyError: any) {
      console.log("KRISTO_FEED_COMMENT_NOTIFICATION_ERROR", {
        postId: canonicalPostId,
        commentId: comment.id,
        action,
        message: String(notifyError?.message || notifyError),
      });
    }

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

    const beforeLikeMeta =
      (await getCommentLikeMetaForIds([commentId], viewerUserId)).get(commentId) ||
      { likeCount: 0, likedByMe: false };

    const likeResult = await toggleCommentLike({
      churchId: comment.churchId,
      commentId,
      viewerUserId,
    });

    if (likeResult.likedByMe && !beforeLikeMeta.likedByMe) {
      try {
        const commentAuthorUserId = String(comment.createdBy || "").trim();
        const postId = String(comment.postId || "").trim();
        if (commentAuthorUserId && postId) {
          await notifyFeedCommentLiked({
            churchId: String(comment.churchId || churchId),
            postId,
            commentId,
            actorUserId: viewerUserId,
            commentAuthorUserId,
            actorName: viewerName || actorLabel,
          });
        }
      } catch (notifyError: any) {
        console.log("KRISTO_FEED_COMMENT_NOTIFICATION_ERROR", {
          commentId,
          action: "toggle_comment_like",
          message: String(notifyError?.message || notifyError),
        });
      }
    }

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

    const viewerAppRole = String(ctx?.viewer?.role || ctx?.role || "");
    const subscriptionBlocked = await requireChurchSubscriptionActive(churchId, {
      endpoint: "/api/church/feed",
      churchId,
      userId: viewerUserId,
      role: viewerAppRole,
      action: "update-schedule-slots",
    });
    if (subscriptionBlocked) return subscriptionBlocked;

    const item = await getFeedItemById(postId);
    if (!item) return err("Feed item not found", 404);

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
      const enrichedSlots = nextSlots.map(enrichMediaScheduleSlotTimes);

      if (!enrichedSlots.length) {
        const { endStaleMediaScheduleFeedItem } = await import("@/app/api/_lib/staleMediaScheduleFeed");
        const ended = await endStaleMediaScheduleFeedItem({
          postId: String(item.id || postId),
          churchId,
          reason: "update-schedule-slots-empty",
          deletedBy: viewerUserId,
        });
        bumpMediaScheduleSyncForFeedItem(
          { ...item, scheduleSlots: [], id: String(item.id || postId) },
          "update-schedule-slots-empty"
        );
        return ok({
          postId,
          slots: [],
          deleted: ended.deleted,
          endedLiveKeys: ended.endedLiveKeys,
        });
      }

      const updatedItem = { ...item, scheduleSlots: enrichedSlots };
      await upsertFeedItem(updatedItem);
      bumpMediaScheduleSyncForFeedItem(updatedItem, "update-schedule-slots");

      try {
        await notifyLiveSlotAssignmentDiff({
          churchId,
          postId: String(item.id || postId),
          feedItem: updatedItem,
          previousSlots: slots,
          nextSlots: enrichedSlots,
          assignerUserId: viewerUserId,
        });
      } catch (notifyError: any) {
        console.log("KRISTO_LIVE_SLOT_NOTIFY_FAILED", {
          postId,
          action: "update-schedule-slots",
          message: String(notifyError?.message || notifyError),
        });
      }

      const firstSlot = nextSlots[0];
      void notifyScheduleSlotEdit({
        churchId,
        editorUserId: viewerUserId,
        editorName: actorLabel,
        editorAppRole: viewerAppRole,
        ministryId,
        slotLabel: formatScheduleSlotLabel(firstSlot),
      });

      return ok({ postId, slots: enrichedSlots });
    }

    if (!slotId) return err("slotId is required", 400);

    const MIN_SLOT_DURATION_MIN = 5;

    function sortSlotsChronologically(list: any[]) {
      return [...list].sort((a, b) => {
        const aStart = parseMediaScheduleSlotStartMs(a);
        const bStart = parseMediaScheduleSlotStartMs(b);
        if (aStart !== bStart) return aStart - bStart;
        return String(a?.id || "").localeCompare(String(b?.id || ""));
      });
    }

    const ordered = sortSlotsChronologically(slots);
    const targetIndex = ordered.findIndex((slot: any) => String(slot?.id || "") === String(slotId));
    if (targetIndex < 0) return err("Slot not found", 404);

    const target = ordered[targetIndex];
    const startMs = parseMediaScheduleSlotStartMs(target);
    const currentEndMs = parseMediaScheduleSlotEndMs(target, startMs);
    if (!(startMs > 0 && currentEndMs > startMs)) {
      return err("Slot time window is missing", 409);
    }

    const currentDurationMin = Math.max(
      MIN_SLOT_DURATION_MIN,
      Math.round((currentEndMs - startMs) / 60000)
    );
    if (minutes < 0 && currentDurationMin + minutes < MIN_SLOT_DURATION_MIN) {
      return err(`Slots must stay at least ${MIN_SLOT_DURATION_MIN} minutes`, 409);
    }

    const nextEndMs = Math.max(
      startMs + MIN_SLOT_DURATION_MIN * 60000,
      currentEndMs + minutes * 60000
    );
    ordered[targetIndex] = enrichMediaScheduleSlotTimes({
      ...target,
      startMs,
      endMs: nextEndMs,
      durationMin: Math.max(MIN_SLOT_DURATION_MIN, Math.round((nextEndMs - startMs) / 60000)),
      manuallyModified: true,
    });

    for (let index = targetIndex + 1; index < ordered.length; index++) {
      const prev = ordered[index - 1];
      const prevEnd = parseMediaScheduleSlotEndMs(prev, parseMediaScheduleSlotStartMs(prev));
      const current = ordered[index];
      const curStart = parseMediaScheduleSlotStartMs(current);
      const curEnd = parseMediaScheduleSlotEndMs(current, curStart);
      const durationMin = Math.max(
        MIN_SLOT_DURATION_MIN,
        curEnd > curStart
          ? Math.round((curEnd - curStart) / 60000)
          : Number(current?.durationMin || MIN_SLOT_DURATION_MIN)
      );
      ordered[index] = enrichMediaScheduleSlotTimes({
        ...current,
        startMs: prevEnd,
        endMs: prevEnd + durationMin * 60000,
        durationMin,
      });
    }

    const byId = new Map(ordered.map((slot: any) => [String(slot?.id || ""), slot]));
    const updated = slots.map((slot: any) => byId.get(String(slot?.id || "")) || slot);
    const enrichedUpdated = updated.map(enrichMediaScheduleSlotTimes);

    const updatedItem = { ...item, scheduleSlots: enrichedUpdated };
    await upsertFeedItem(updatedItem);
    bumpMediaScheduleSyncForFeedItem(updatedItem, "update-schedule-slots");

    void notifyScheduleSlotEdit({
      churchId,
      editorUserId: viewerUserId,
      editorName: actorLabel,
      editorAppRole: viewerAppRole,
      ministryId,
      slotLabel: formatScheduleSlotLabel(
        enrichedUpdated.find((slot: any) => String(slot?.id || "") === String(slotId))
      ),
    });

    return ok({ postId, slotId, slots: enrichedUpdated, slot: enrichedUpdated.find((slot: any) => String(slot?.id || "") === String(slotId)) });
  }

  if (action === "claim_schedule_slot") {
    if (!(await viewerHasActiveChurchMembership(churchId, viewerUserId))) {
      return err("Join a church to claim schedule slots", 403);
    }

    const subscriptionBlocked = await requireChurchSubscriptionActive(churchId, {
      endpoint: "/api/church/feed",
      churchId,
      userId: viewerUserId,
      role: String(ctx?.viewer?.role || ""),
      action: "claim_schedule_slot",
    });
    if (subscriptionBlocked) return subscriptionBlocked;

    const postId = cleanText(body?.postId, 240);
    const slotId = cleanText(body?.slotId, 240);
    const claim = body?.claim || {};

    if (!postId) return err("postId is required", 400);
    if (!slotId) return err("slotId is required", 400);

    const item = await getFeedItemById(postId);
    if (!item) return err("Feed item not found", 404);

    const ownerChurchId = String(item?.churchId || "").trim();
    if (ownerChurchId && churchId && ownerChurchId !== churchId) {
      console.log("KRISTO_CROSS_CHURCH_SLOT_CLAIM", {
        viewerChurchId: churchId,
        ownerChurchId,
        postId,
        slotId,
        viewerUserId,
      });
    }

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
      console.log("KRISTO_CLAIM_OVERWRITE_BLOCKED", {
        slotId,
        existingClaimedByUserId: existingOwner,
        incomingUserId: viewerUserId,
        source: "api.church.feed.claim_schedule_slot",
      });
      return NextResponse.json(
        {
          ok: false,
          error: "slot_already_claimed",
          claimedByUserId: existingOwner,
        },
        { status: 409 }
      );
    }

    const name = cleanText(claim?.name || actorLabel || "Church Member", 240) || "Church Member";
    const role = cleanText(claim?.role || ctx?.viewer?.role || "Member", 120) || "Member";
    const avatarUri =
      cleanText(await resolveClaimerAvatarUri(viewerUserId, claim), 2000) || "";

    console.log("KRISTO_CLAIM_FINAL_AVATAR_URI", {
      postId,
      slotId,
      userId: viewerUserId,
      hasAvatar: Boolean(avatarUri),
      avatarUri: avatarUri.slice(0, 160),
      isDataUrl: avatarUri.toLowerCase().startsWith("data:image"),
    });

    if (avatarUri) {
      console.log("KRISTO_CLAIMED_SLOT_AVATAR_PERSIST", {
        postId,
        slotId,
        userId: viewerUserId,
        hasAvatar: true,
      });
    } else {
      console.log("KRISTO_CLAIMED_SLOT_AVATAR_MISSING", {
        postId,
        slotId,
        userId: viewerUserId,
        stage: "claim_schedule_slot",
      });
    }

    slots[slotIndex] = {
      ...existing,
      claimed: true,
      isClaimed: true,
      status: "claimed",
      claimedByUserId: viewerUserId,
      claimedByName: name,
      claimedByAvatarUri: avatarUri,
      claimedByAvatar: avatarUri,
      claimedByPhotoUrl: avatarUri,
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

  if (action === "assign_schedule_slot") {
    const postId = cleanText(body?.postId || body?.feedId, 240);
    const slotId = cleanText(body?.slotId, 240);
    let targetUserId = cleanText(body?.userId || body?.targetUserId, 240);
    const kristoId = cleanText(body?.kristoId || body?.userCode, 80).toUpperCase();

    if (!postId) return err("postId is required", 400);
    if (!slotId) return err("slotId is required", 400);

    const viewerAppRole = String(ctx?.viewer?.role || ctx?.role || "");
    const subscriptionBlocked = await requireChurchSubscriptionActive(churchId, {
      endpoint: "/api/church/feed",
      churchId,
      userId: viewerUserId,
      role: viewerAppRole,
      action: "assign_schedule_slot",
    });
    if (subscriptionBlocked) return subscriptionBlocked;

    const item = await getFeedItemById(postId);
    if (!item) return err("Feed item not found", 404);

    const permissionErr = await assertScheduleEditPermission({
      churchId,
      viewerUserId,
      viewerAppRole,
      item,
      body,
    });
    if (permissionErr) return err(permissionErr, 403);

    if (!targetUserId && kristoId) {
      const profile = await getProfileByUserCode(kristoId);
      if (!profile?.userId) return err("Kristo ID not found", 404);
      targetUserId = String(profile.userId).trim();
    }
    if (!targetUserId) return err("userId or kristoId is required", 400);

    const slots = Array.isArray((item as any).scheduleSlots) ? (item as any).scheduleSlots : [];
    const slotIndex = slots.findIndex((slot: any) => String(slot?.id || "") === String(slotId));
    if (slotIndex < 0) return err("Slot not found", 404);

    const previousSlots = slots.map((slot: any) => ({ ...slot }));
    const existing = slots[slotIndex] || {};
    const existingOwner = String(
      existing.claimedByUserId || existing.claimedBy?.userId || ""
    ).trim();

    if (existing.locked && existingOwner && existingOwner !== targetUserId) {
      return err("Slot is locked", 409);
    }

    if (existingOwner && existingOwner !== targetUserId) {
      console.log("KRISTO_CLAIM_OVERWRITE_BLOCKED", {
        slotId,
        existingClaimedByUserId: existingOwner,
        incomingUserId: targetUserId,
        source: "api.church.feed.assign_schedule_slot",
      });
      return NextResponse.json(
        {
          ok: false,
          error: "slot_already_claimed",
          claimedByUserId: existingOwner,
        },
        { status: 409 }
      );
    }

    const duplicateSlot = slots.find(
      (slot: any) =>
        String(slot?.id || "") !== String(slotId) &&
        String(slot?.claimedByUserId || slot?.claimedBy?.userId || "").trim() === targetUserId
    );
    if (duplicateSlot) {
      return err("Member is already assigned to another slot in this schedule", 409);
    }

    const memberships = await getMembershipsForUser(targetUserId);
    const activeMembership = memberships.find((m) => String(m?.status || "") === "Active");
    const targetChurchId = String(activeMembership?.churchId || "").trim();
    if (!targetChurchId) {
      return err("Member must belong to an active church", 403);
    }

    const targetChurchSubActive = await isChurchSubscriptionActive(targetChurchId);
    if (!targetChurchSubActive) {
      return err(
        "This member's church must have an active subscription before they can be assigned.",
        403
      );
    }

    const profile = (await getProfile(targetUserId)) || null;
    const name =
      cleanText(
        body?.name ||
          profile?.fullName ||
          profile?.displayName ||
          activeMembership?.name ||
          "Church Member",
        240
      ) || "Church Member";
    const role =
      cleanText(
        body?.role || profile?.role || activeMembership?.churchRole || "Member",
        120
      ) || "Member";
    const avatarUri =
      cleanText(await resolveClaimerAvatarUri(targetUserId, body?.claim || body), 2000) || "";

    slots[slotIndex] = {
      ...existing,
      claimed: true,
      isClaimed: true,
      status: "claimed",
      approved: false,
      locked: false,
      claimedByUserId: targetUserId,
      claimedByName: name,
      claimedByAvatarUri: avatarUri,
      claimedByAvatar: avatarUri,
      claimedByPhotoUrl: avatarUri,
      claimedByRole: role,
      claimedAt: new Date().toISOString(),
      assignedByUserId: viewerUserId,
      assignedAt: new Date().toISOString(),
      claimedBy: {
        slotId,
        userId: targetUserId,
        name,
        role,
        avatarUri,
      },
    };

    const updatedItem = { ...item, scheduleSlots: slots };
    await upsertFeedItem(updatedItem);
    bumpMediaScheduleSyncForFeedItem(updatedItem, "assign_schedule_slot");

    try {
      await notifyLiveSlotAssignmentDiff({
        churchId,
        postId: String(item.id || postId),
        feedItem: updatedItem,
        previousSlots,
        nextSlots: slots,
        assignerUserId: viewerUserId,
      });
    } catch (notifyError: any) {
      console.log("KRISTO_LIVE_SLOT_NOTIFY_FAILED", {
        postId,
        action: "assign_schedule_slot",
        message: String(notifyError?.message || notifyError),
      });
    }

    return ok({
      postId: String(item.id || postId),
      slotId,
      slot: slots[slotIndex],
      userId: targetUserId,
    });
  }

  if (action === "unclaim_schedule_slot") {
    const subscriptionBlocked = await requireChurchSubscriptionActive(churchId, {
      endpoint: "/api/church/feed",
      churchId,
      userId: viewerUserId,
      role: String(ctx?.viewer?.role || ""),
      action: "unclaim_schedule_slot",
    });
    if (subscriptionBlocked) return subscriptionBlocked;

    const postId = cleanText(body?.postId || body?.feedId, 240);
    const slotId = cleanText(body?.slotId, 240);
    const targetUserId = cleanText(body?.userId || viewerUserId, 240);

    if (!postId) return err("postId is required", 400);
    if (!slotId) return err("slotId is required", 400);

    const item = await getFeedItemById(postId);
    if (!item) return err("Feed item not found", 404);

    const viewerAppRole = String(ctx?.viewer?.role || ctx?.role || "");
    const managerPermissionErr = await assertScheduleEditPermission({
      churchId,
      viewerUserId,
      viewerAppRole,
      item,
      body,
    });
    const canManageSchedule = !managerPermissionErr;

    const slots = Array.isArray((item as any).scheduleSlots) ? (item as any).scheduleSlots : [];
    const slotIndex = slots.findIndex((slot: any) => String(slot?.id || "") === String(slotId));
    if (slotIndex < 0) return err("Slot not found", 404);

    const existing = slots[slotIndex] || {};
    const existingOwner = String(
      existing.claimedByUserId || existing.claimedBy?.userId || ""
    ).trim();

    if (existingOwner && targetUserId && existingOwner !== targetUserId && !canManageSchedule) {
      return err("Slot claimed by another member", 409);
    }

    const cancelledOwner = existingOwner;

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

    if (cancelledOwner) {
      try {
        await notifyLiveSlotCancelled({
          churchId,
          postId: String(item.id || postId),
          slotId,
          previousUserId: cancelledOwner,
          slot: existing,
          feedItem: item,
        });
      } catch (notifyError: any) {
        console.log("KRISTO_LIVE_SLOT_NOTIFY_FAILED", {
          postId,
          action: "unclaim_schedule_slot",
          message: String(notifyError?.message || notifyError),
        });
      }
    }

    return ok({
      postId,
      slotId,
      slot: slots[slotIndex],
    });
  }

  if (action === "persist_video_poster") {
    const postId = cleanText(body?.postId || body?.feedId || body?.id, 240);
    const posterUri = cleanText(body?.posterUri || body?.videoPosterUri || body?.thumbnailUri, 4000);
    const videoUrl = cleanText(body?.videoUrl, 2000) || undefined;
    if (!postId) return err("postId is required", 400);
    if (!posterUri) return err("posterUri is required", 400);

    const item = await getFeedItemById(postId);
    if (!item) return err("Feed item not found", 404);

    const itemChurchId = String(item?.churchId || churchId || "").trim();
    if (!itemChurchId || itemChurchId !== String(churchId || "").trim()) {
      return err("Feed item not in your church", 403);
    }

    const resolvedVideoUrl = resolveFeedItemVideoUrl(item);
    const normalizedVideoUrl = String(videoUrl || resolvedVideoUrl || "").trim();
    if (!isUsableVideoPosterUri(posterUri, normalizedVideoUrl)) {
      return err("posterUri must be a valid image URL for this video", 400);
    }

    const saved = await upsertFeedItem({
      ...(item as ChurchFeedItem),
      ...(normalizedVideoUrl ? { videoUrl: normalizedVideoUrl } : {}),
      posterUri,
      videoPosterUri: posterUri,
      thumbnailUri: posterUri,
      brandedPoster: false,
    });

    console.log("KRISTO_MEDIA_VIDEO_POSTER_PERSISTED", {
      postId,
      videoUrl: normalizedVideoUrl || null,
      posterUri,
    });

    return ok({
      postId,
      posterUri,
      item: saved,
    });
  }

  if (action === "repair_feed_image") {
    const postId = cleanText(body?.postId || body?.feedId || body?.id, 240);
    if (!postId) return err("postId is required", 400);

    const item = await getFeedItemById(postId);
    if (!item) return err("Feed item not found", 404);

    const itemChurchId = String(item?.churchId || churchId || "").trim();
    if (!itemChurchId || itemChurchId !== String(churchId || "").trim()) {
      return err("Feed item not in your church", 403);
    }

    const explicitMediaUri =
      cleanText(body?.mediaUri, 2000) ||
      cleanText(body?.imageUrl, 2000) ||
      cleanText(body?.uploadedMediaUri, 2000) ||
      "";
    const imageReport = buildFeedItemImageDebugReport(item, null);
    let mediaUri = explicitMediaUri || String(imageReport.resolvedMediaUri || "").trim();
    const repairSource = explicitMediaUri ? "explicit" : imageReport.repaired ? "scan" : "none";

    if (!mediaUri) {
      console.log("KRISTO_FEED_IMAGE_REPAIR_MISSING", {
        postId,
        source: item?.source,
        type: item?.type,
        finalMediaUri: null,
        explicitCandidates: imageReport.explicitCandidates,
        scannedImageUri: imageReport.scannedImageUri,
        imageLikeFields: imageReport.imageLikeFields,
      });
      return ok({
        repaired: false,
        postId,
        finalMediaUri: null,
        message: "No image URI found in stored item. Post must be recreated.",
        imageReport,
      });
    }

    if (!isRepairableFeedPostImageUri(mediaUri)) {
      return err("mediaUri must be a valid /uploads/media/... or http(s) image URL", 400);
    }

    const imageUrl = cleanText(body?.imageUrl, 2000) || mediaUri;
    const next = {
      ...(item as ChurchFeedItem),
      ...buildFeedPostImageFieldPatch(mediaUri),
      imageUrl,
    };
    const saved = await upsertFeedItem(next);

    console.log("KRISTO_FEED_IMAGE_REPAIR_APPLIED", {
      postId,
      repairSource,
      mediaUri,
      imageUrl,
      mediaType: "image",
    });

    return ok({
      repaired: true,
      postId,
      repairSource,
      item: saved,
      mediaUri,
      imageUrl,
      mediaType: "image",
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
    if (!(await resolveCanDeleteChurchActivityPost(item, { churchId, userId: viewerUserId, role: viewerRole }))) {
      return err("Forbidden", 403);
    }

    if (isClaimableScheduleFeedItem(item)) {
      bumpMediaScheduleSyncForFeedItem(item, "delete_post");
    }

    const feedDeleted = await removePostAndRelated(String(item.id || postId));

    const deletedId = String(item.id || postId);
    console.log("KRISTO_FEED_POST_DELETE_SYNC", {
      postId: deletedId,
      storageDeleted: true,
      feedDeleted: feedDeleted === true,
      cachePurged: false,
    });
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
  const rawImageUrl = cleanText(body?.imageUrl, 2000) || undefined;
  const extractedCreateImageUri = extractFeedPostCreateImageUri(body) || undefined;
  const createImageUris = extractFeedPostCreateImageUris(body);
  const rawPostMediaUri = mediaUri || rawImageUrl || extractedCreateImageUri || undefined;
  const source = cleanText(body?.source, 80) || undefined;
  const scheduleType = cleanText(body?.scheduleType, 120) || undefined;
  const scheduleTopic =
    cleanText(body?.topic, 240) ||
    cleanText(body?.scheduleTopic, 240) ||
    cleanText(body?.meetingTopic, 240) ||
    undefined;
  const meetingType = cleanText(body?.meetingType, 120) || undefined;
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

    if (isServerDev && normalizedStartMs > 0) {
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
  const enrichedScheduleSlots =
    Array.isArray(scheduleSlots) && scheduleSlots.length && meetingType
      ? scheduleSlots.map((slot: any) => ({
          ...slot,
          meetingType: String(slot?.meetingType || meetingType).trim() || meetingType,
          liveCardType: String(slot?.liveCardType || meetingType).trim() || meetingType,
          selectedCardType: String(slot?.selectedCardType || meetingType).trim() || meetingType,
          cardTypeLabel: String(slot?.cardTypeLabel || meetingType).trim() || meetingType,
        }))
      : scheduleSlots;
  const visibility = cleanText(body?.visibility, 80) || undefined;
  const audience = body?.audience || undefined;
  const sourceNorm = String(source || "").trim().toLowerCase();
  const isChurchRoomComposerPost = ["testimony", "post", "announcement", "counsel"].includes(sourceNorm);
  const mediaName = isChurchRoomComposerPost
    ? cleanText(body?.mediaName, 240) || undefined
    : cleanText(body?.mediaName || body?.actorLabel, 240) || undefined;
  const churchName = cleanText(body?.churchName || body?.churchLabel, 240) || undefined;
  const churchLabel = cleanText(body?.churchLabel || body?.churchName, 240) || undefined;
  const persistedAuthor = await resolvePersistedFeedAuthorFields({
    userId: viewerUserId,
    ctx,
    body,
  });
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

  const actorAvatarUri =
    cleanText(body?.actorAvatarUri || body?.avatarUri || body?.profileImage, 2000) ||
    persistedAuthor.authorAvatarUri ||
    undefined;
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
    mediaUri: rawPostMediaUri || mediaUri,
    posterUri,
    thumbnailUri,
    actorAvatarUri,
    churchAvatarUri,
    avatarUri: cleanText(body?.avatarUri, 2000) || undefined,
    profileImage: cleanText(body?.profileImage, 2000) || undefined,
    logo: cleanText(body?.logo, 2000) || undefined,
  });
  if (rawPostMediaUri && !sanitizedMedia.mediaUri && isPersistedFeedPostImageUri(rawPostMediaUri)) {
    sanitizedMedia.mediaUri = rawPostMediaUri;
  }
  const resolvedCreateImageUri =
    String(createImageUris[0] || sanitizedMedia.mediaUri || rawPostMediaUri || extractedCreateImageUri || "").trim() || "";

  let resolvedPosterUri =
    sanitizedMedia.posterUri || sanitizedMedia.thumbnailUri || videoPosterUri || undefined;
  let resolvedThumbnailUri =
    sanitizedMedia.thumbnailUri || sanitizedMedia.posterUri || videoPosterUri || undefined;

  if (isBrandedVideoPosterUri(resolvedPosterUri)) resolvedPosterUri = undefined;
  if (isBrandedVideoPosterUri(resolvedThumbnailUri)) resolvedThumbnailUri = undefined;

  const clientUploadPoster = resolveClientUploadPosterUri(body, videoUrl);
  if (clientUploadPoster) {
    resolvedPosterUri = clientUploadPoster;
    resolvedThumbnailUri = clientUploadPoster;
  }

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
      : isChurchRoomComposerPost
        ? "member"
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
    const { isIncomingChurchLiveControlScheduleFeedCreate } = await import(
      "@/lib/churchLiveControlSchedule"
    );
    if (isIncomingChurchLiveControlScheduleFeedCreate(body)) {
      return err(
        "Church live schedules must be published to Church Live Control room, not Live Slots feed",
        400
      );
    }

    const viewerAppRole = String(ctx?.viewer?.role || ctx?.role || "");
    const subscriptionBlocked = await requireChurchSubscriptionActive(churchId, {
      endpoint: "/api/church/feed",
      churchId,
      userId: viewerUserId,
      role: viewerAppRole,
      action: "create_media_schedule",
    });
    if (subscriptionBlocked) return subscriptionBlocked;

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

    const existingFeedItems = await listFeedItems();
    const { cleanupStaleMediaScheduleRowsForChurch } = await import(
      "@/app/api/_lib/staleMediaScheduleFeed"
    );
    await cleanupStaleMediaScheduleRowsForChurch({
      churchId,
      items: existingFeedItems,
      reason: "create-media-schedule-scan",
      deletedBy: viewerUserId,
    });

    const existingActive = findActiveMediaScheduleForChurch(await listFeedItems(), churchId, {
      strictChurch: true,
    });
    if (existingActive) {
      const activeSchedule = summarizeActiveMediaSchedule(existingActive);
      console.log("KRISTO_MEDIA_LOCK_BACKEND_ACTIVE", activeSchedule);
      console.log("KRISTO_MEDIA_SLOT_CONFLICT_SOURCE", {
        reason: "api-create-media-schedule",
        source: "backend-feed",
        feedId: String(existingActive?.id || ""),
        sourceScheduleId: String(existingActive?.sourceScheduleId || ""),
        churchId: String(existingActive?.churchId || churchId || ""),
        deleted: Boolean(existingActive?.deleted),
        scheduleStatus: String(existingActive?.status || ""),
        slotCount: Array.isArray(existingActive?.scheduleSlots)
          ? existingActive.scheduleSlots.length
          : 0,
      });
      const activeSlots = Array.isArray(existingActive?.scheduleSlots)
        ? existingActive.scheduleSlots
        : [];
      for (const slot of activeSlots) {
        console.log("KRISTO_MEDIA_SLOT_CONFLICT_ITEM", {
          reason: "api-create-media-schedule",
          source: "backend-feed",
          feedId: String(existingActive?.id || ""),
          sourceScheduleId: String(existingActive?.sourceScheduleId || ""),
          churchId: String(existingActive?.churchId || churchId || ""),
          deleted: Boolean(slot?.deleted ?? existingActive?.deleted),
          scheduleStatus: String(slot?.status || existingActive?.status || ""),
          meetingDate: String(slot?.meetingDate || "").split("T")[0] || "",
          slotStartMs: Number(slot?.startMs || 0) || null,
          slotEndMs: Number(slot?.endMs || 0) || null,
          slotStartTime: String(slot?.startTime || "").trim() || null,
          slotEndTime: String(slot?.endTime || "").trim() || null,
          slotId: String(slot?.id || ""),
          slotName: String(slot?.name || ""),
        });
      }
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
    mediaUri: resolvedCreateImageUri || sanitizedMedia.mediaUri,
    source,
    scheduleType,
    ...(scheduleTopic ? { topic: scheduleTopic, scheduleTopic, meetingTopic: scheduleTopic } : {}),
    ...(meetingType
      ? {
          meetingType,
          liveCardType: meetingType,
          selectedCardType: meetingType,
          cardTypeLabel: meetingType,
        }
      : {}),
    scheduleSlots: enrichedScheduleSlots,
    visibility,
    audience,
    mediaName,
    churchName,
    churchLabel,
    actorLabel: persistedAuthor.actorLabel,
    actorAvatarUri,
    authorName: persistedAuthor.authorName,
    postedByName: persistedAuthor.postedByName,
    displayName: persistedAuthor.displayName,
    ...(persistedAuthor.authorAvatarUri || actorAvatarUri
      ? {
          authorAvatarUri: actorAvatarUri || persistedAuthor.authorAvatarUri,
          profileAvatarUri: actorAvatarUri || persistedAuthor.authorAvatarUri,
        }
      : {}),
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
    (item as any).thumbnailUri = resolvedThumbnailUri || resolvedPosterUri;
    (item as any).brandedPoster = false;
  } else if (resolvedThumbnailUri) {
    (item as any).thumbnailUri = resolvedThumbnailUri;
    (item as any).posterUri = resolvedThumbnailUri;
    (item as any).videoPosterUri = resolvedThumbnailUri;
    (item as any).brandedPoster = false;
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
  const videoDisplayType = cleanText(body?.videoDisplayType, 40).toLowerCase();
  if (videoDisplayType === "youtube" || videoDisplayType === "tiktok") {
    (item as any).videoDisplayType = videoDisplayType;
  }
  if (createImageUris.length > 0 && type !== "video" && !String(videoUrl || "").trim()) {
    applyFeedPostImageFieldsToItem(item, createImageUris);
    console.log("KRISTO_FEED_POST_IMAGES_SAVED", {
      postId: item.id,
      imagesCount: createImageUris.length,
      attachmentsCount: createImageUris.length,
      imageUrl: createImageUris[0],
    });
    console.log("KRISTO_FEED_IMAGE_CREATE_DIAG", {
      id: item.id,
      kind: String(source || type || "").trim().toLowerCase(),
      hasImageUrl: true,
      imageUrl: createImageUris[0],
      attachmentsCount: createImageUris.length,
      imagesCount: createImageUris.length,
    });
  } else if (resolvedCreateImageUri && type !== "video" && !String(videoUrl || "").trim()) {
    applyFeedPostImageFieldsToItem(item, resolvedCreateImageUri);
    console.log("KRISTO_FEED_IMAGE_CREATE_DIAG", {
      id: item.id,
      kind: String(source || type || "").trim().toLowerCase(),
      hasImageUrl: true,
      imageUrl: resolvedCreateImageUri,
      attachmentsCount: Array.isArray((item as any).attachments)
        ? (item as any).attachments.length
        : 0,
      imagesCount: Array.isArray((item as any).images) ? (item as any).images.length : 0,
    });
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

  if (!isIncomingMediaScheduleCreate(body)) {
    try {
      const notified = await notifyChurchFeedPostPublished({
        churchId,
        postId: String(item.id),
        authorUserId: viewerUserId,
        item,
        body,
        actorName: actorLabel,
      });
      if (notified > 0) {
        console.log("KRISTO_FEED_POST_NOTIFY", {
          postId: item.id,
          churchId,
          notified,
        });
      }
    } catch (notifyError: any) {
      console.log("KRISTO_FEED_POST_NOTIFY_FAILED", {
        postId: item.id,
        churchId,
        message: String(notifyError?.message || notifyError),
      });
    }
  }

  if (isIncomingMediaScheduleCreate(body)) {
    const savedFirstSlot = Array.isArray(enrichedScheduleSlots) && enrichedScheduleSlots[0]
      ? enrichedScheduleSlots[0]
      : null;
    console.log("KRISTO_SCHEDULE_TOPIC_TRACE", {
      stage: "backend_create_saved",
      feedId: item.id,
      topic: String((item as any).topic || "").trim(),
      scheduleTopic: String((item as any).scheduleTopic || "").trim(),
      meetingTopic: String((item as any).meetingTopic || "").trim(),
      meetingType: String((item as any).meetingType || "").trim(),
      firstSlot: savedFirstSlot
        ? {
            name: String(savedFirstSlot?.name || ""),
            slotTopic: String(savedFirstSlot?.slotTopic || ""),
            script: String(savedFirstSlot?.script || ""),
            parentTopic: String(savedFirstSlot?.parentTopic || ""),
            scheduleTopic: String(savedFirstSlot?.scheduleTopic || ""),
            meetingTopic: String(savedFirstSlot?.meetingTopic || ""),
            task: String(savedFirstSlot?.task || ""),
          }
        : null,
    });
  }

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
    const scheduleId = String(item.sourceScheduleId || item.id || "").trim();
    logHomeFeedScheduleCreated({
      scheduleId,
      churchId,
      slotCount: Array.isArray(item.scheduleSlots) ? item.scheduleSlots.length : 0,
      source: String(item.source || body?.source || "media-schedule"),
    });
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

    try {
      await notifyLiveEventScheduled({
        churchId,
        postId: String(item.id),
        feedItem: item,
        editorUserId: viewerUserId,
      });
    } catch (notifyError: any) {
      console.log("KRISTO_LIVE_SCHEDULE_NOTIFY_FAILED", {
        postId: item.id,
        churchId,
        message: String(notifyError?.message || notifyError),
      });
    }
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
