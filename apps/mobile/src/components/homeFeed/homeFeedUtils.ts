import {
  isFeedVideoItem,
  isOptimisticVideoUploadPost,
  isStandaloneAvatarFeedPost,
  isMediaScheduleFeedItem,
  resolveFeedItemAvatar,
} from "@/src/lib/homeFeedStore";
import { isHomeFeedReadyMediaItem } from "@/src/lib/mediaStatus";
import { avatarCacheBust, normalizeAvatarUpdatedAt } from "@/src/lib/avatarFreshness";
import { baseFeedId, parseSlotClockMs, parseSlotStartMs } from "@/src/lib/scheduleSlotUtils";

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

/** Active church media schedule row (media-live-slots) for Home Feed / Guest Claim / Live ring.
 *  V1: visible to church members for claim; ranking pipeline unchanged. */
export function isMediaLiveSlotsHomeFeedRow(item: any): boolean {
  if (!item || isStandaloneAvatarFeedPost(item)) return false;
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

      const endMsFromClock = parseSlotClockMs(
        String(slot?.meetingDate || slot?.meetingDay || ""),
        String(slot?.endTime || "")
      );
      const fallbackDuration = Math.max(1, Number(slot?.durationMin || 10)) * 60000;
      const endMs = endMsFromClock > startMs ? endMsFromClock : startMs + fallbackDuration;
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

  return filtered;
}

/** Likes/comments API id — parent schedule for expanded slot cards. */
export function homeFeedScheduleEngagementId(item: any) {
  const parent = String(item?.parentScheduleId || item?.sourceScheduleId || "").trim();
  if (parent) return baseFeedId(parent);
  return baseFeedId(String(item?.id || item?.feedOriginId || ""));
}

/** FlatList row key — unique per expanded slot card. */
export function feedRenderKey(item: any) {
  const id = String(item?.id || item?.feedOriginId || "").trim();
  if (item?.homeFeedSlotExpanded || /:slot:\d+/i.test(id)) return id;
  return baseFeedId(id);
}

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

/** One Home Feed card per media-live-slots slot (all slots, including taken). */
export function expandHomeFeedScheduleIntoSlotRows(scheduleRow: any): any[] {
  if (!shouldExpandHomeFeedScheduleRow(scheduleRow)) return [scheduleRow];

  const scheduleId = baseFeedId(
    String(scheduleRow?.id || scheduleRow?.sourceScheduleId || "")
  );
  const slots = Array.isArray(scheduleRow?.scheduleSlots) ? scheduleRow.scheduleSlots : [];
  if (!scheduleId || !slots.length) return [scheduleRow];

  const expanded = slots.map((slot: any, index: number) => {
    const slotNumber = resolveHomeFeedSlotNumber(slot, index + 1);
    return {
      ...scheduleRow,
      id: `${scheduleId}:slot:${slotNumber}`,
      feedOriginId: `${scheduleId}:slot:${slotNumber}`,
      parentScheduleId: scheduleId,
      sourceScheduleId: scheduleId,
      scheduleSlots: [slot],
      slotNumber,
      homeFeedSlotExpanded: true,
      parentScheduleSlotCount: slots.length,
      source: String(scheduleRow?.source || "media-schedule"),
      scheduleType: String(scheduleRow?.scheduleType || "media-live-slots"),
    };
  });

  console.log("KRISTO_HOME_FEED_SCHEDULE_EXPANDED", {
    scheduleId,
    slotCount: slots.length,
    expandedCount: expanded.length,
  });

  return expanded;
}

export function readFeedItemLikedByMe(item: any) {
  return item?.likedByMe === true || item?.liked === true;
}

export function hydrateFeedRowLikes(
  rows: any[],
  serverLikeByPostId: Record<string, { likedByMe: boolean; likeCount: number }>
) {
  return rows.map((item) => {
    const postId = homeFeedScheduleEngagementId(item);
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

function homeFeedScheduleSlotCount(item: any) {
  return Array.isArray(item?.scheduleSlots) ? item.scheduleSlots.length : 0;
}

function pickRicherHomeFeedRow(prev: any, next: any) {
  const prevSlots = homeFeedScheduleSlotCount(prev);
  const nextSlots = homeFeedScheduleSlotCount(next);
  if (nextSlots !== prevSlots) return nextSlots > prevSlots ? next : prev;

  const prevTs = Date.parse(String(prev?.updatedAt || prev?.createdAt || "")) || 0;
  const nextTs = Date.parse(String(next?.updatedAt || next?.createdAt || "")) || 0;
  return nextTs >= prevTs ? next : prev;
}

/** Merged Home Feed list: schedule rows first, not re-sorted with videos. */
export function buildHomeFeedDisplayRows(backendRows: any[], localRows: any[]) {
  const byId = new Map<string, any>();

  for (const row of [...backendRows, ...localRows]) {
    if (!row) continue;
    const id = String(row?.id || "").trim();
    if (!id) continue;
    const prev = byId.get(id);
    byId.set(id, prev ? pickRicherHomeFeedRow(prev, row) : row);
  }

  const filtered = filterPhase1FeedRows(Array.from(byId.values()));
  const scheduleRows = filtered.filter(
    (row) => isExplicitHomeFeedMediaScheduleRow(row) || isMediaLiveSlotsHomeFeedRow(row)
  );
  const postRows = filtered.filter(
    (row) => !isExplicitHomeFeedMediaScheduleRow(row) && !isMediaLiveSlotsHomeFeedRow(row)
  );
  const expandedScheduleRows = scheduleRows.flatMap(expandHomeFeedScheduleIntoSlotRows);
  const display = [...expandedScheduleRows, ...postRows];

  console.log("KRISTO_HOME_FEED_VISIBLE_DATA", {
    backendCount: backendRows.length,
    localCount: localRows.length,
    mergedCount: byId.size,
    filteredCount: filtered.length,
    scheduleSourceCount: scheduleRows.length,
    scheduleCount: expandedScheduleRows.length,
    displayCount: display.length,
    scheduleIds: scheduleRows.map((row) => String(row?.id || "")),
    scheduleSlotCounts: scheduleRows.map((row) => homeFeedScheduleSlotCount(row)),
    expandedScheduleIds: expandedScheduleRows.map((row) => String(row?.id || "")),
  });

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
