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
import { isKristoVerboseFeedDebug, isKristoVerboseFeedIdentityDebug, isKristoVerboseSlotTimeDebug } from "@/src/lib/kristoDebugFlags";
import {
  isHiddenInvalidHomeFeedSchedule,
  markHiddenInvalidHomeFeedSchedule,
} from "@/src/lib/homeFeedInvalidSchedules";
import {
  logHomeFeedFirstRows,
  logHomeFeedPersonalOrder,
  logHomeFeedPersonalSeed,
  resetHomeFeedPersonalOrderIfNeeded,
  resolveHomeFeedPersonalOrderContext,
  sortRowsByPersonalSeed,
  type HomeFeedPersonalOrderContext,
} from "@/src/lib/homeFeedPersonalOrder";
import { resolveMediaSlotTimeWindow } from "@/src/lib/mediaScheduleSlotTimes";
import { getSessionSync } from "@/src/lib/kristoSession";

const API_BASE = (process.env.EXPO_PUBLIC_API_BASE || "http://localhost:3000").replace(/\/$/, "");

export function homeFeedMediaUrl(raw: unknown) {
  const v = String(raw || "").trim();
  if (!v) return "";
  if (isBrandedPosterUri(v)) return "";
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
          slotId: String(slot?.id || scheduleRow?.id || ""),
        });
      if (visual?.expired) return [];
    }
    return [scheduleRow];
  }

  const scheduleId = baseFeedId(
    String(scheduleRow?.id || scheduleRow?.sourceScheduleId || "")
  );
  const slots = Array.isArray(scheduleRow?.scheduleSlots) ? scheduleRow.scheduleSlots : [];
  if (!scheduleId || !slots.length) return [scheduleRow];

  let expiryDebugLogged = 0;
  const activeSlots = slots
    .map((slot: any, index: number) => ({ slot, index }))
    .filter(({ slot, index }: { slot: any; index: number }) => {
      const slotNumber = resolveHomeFeedSlotNumber(slot, index + 1);
      const slotFeedIndex = resolveHomeFeedSlotFeedIndex(slot, index);
      const visual = resolveScheduleSlotVisualState(slot, slotFeedIndex, nowMs, {
        slotId: String(slot?.id || `${scheduleId}:slot:${slotNumber}`),
      });
      if (!visual) return false;
      if (expiryDebugLogged < 3) {
        logHomeFeedSlotExpiryDebug(scheduleId, slot, slotNumber, visual);
        expiryDebugLogged += 1;
      }
      return !visual.expired;
    });
  const removedCount = slots.length - activeSlots.length;
  if (removedCount > 0 && isKristoVerboseSlotTimeDebug()) {
    console.log("KRISTO_HOME_EXPIRED_SLOTS_FILTERED", {
      scheduleId,
      removedCount,
      keptCount: activeSlots.length,
    });
  }
  if (!activeSlots.length) return [];

  activeSlots.sort((a, b) => {
    const aNum = resolveHomeFeedSlotNumber(a.slot, a.index + 1);
    const bNum = resolveHomeFeedSlotNumber(b.slot, b.index + 1);
    if (aNum !== bNum) return aNum - bNum;
    const aStart = resolveMediaSlotTimeWindow(a.slot).startMs;
    const bStart = resolveMediaSlotTimeWindow(b.slot).startMs;
    return aStart - bStart;
  });

  const expanded = activeSlots.map(({ slot, index }: { slot: any; index: number }) => {
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

  if (isKristoVerboseFeedDebug()) {
    console.log("KRISTO_HOME_FEED_SCHEDULE_EXPANDED", {
      scheduleId,
      slotCount: activeSlots.length,
      expandedCount: expanded.length,
      expiredFiltered: removedCount,
    });
  }

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
  const prevIsSchedule = isHomeFeedMediaScheduleSourceRow(prev);
  const nextIsSchedule = isHomeFeedMediaScheduleSourceRow(next);
  if (prevIsSchedule || nextIsSchedule) {
    const prevValid = scheduleRowHasValidSlotTimes(prev);
    const nextValid = scheduleRowHasValidSlotTimes(next);
    if (prevValid !== nextValid) return nextValid ? next : prev;
  }

  const prevSlots = homeFeedScheduleSlotCount(prev);
  const nextSlots = homeFeedScheduleSlotCount(next);
  if (nextSlots !== prevSlots) return nextSlots > prevSlots ? next : prev;

  const prevTs = Date.parse(String(prev?.updatedAt || prev?.createdAt || "")) || 0;
  const nextTs = Date.parse(String(next?.updatedAt || next?.createdAt || "")) || 0;
  return nextTs >= prevTs ? next : prev;
}

function homeFeedPostSortMs(row: any) {
  return Date.parse(String(row?.createdAt || row?.updatedAt || "")) || 0;
}

type HomeFeedRowBucket = "global_media" | "church_media" | "church_post" | "schedule" | "live";

const HOME_FEED_POST_INTERLEAVE_PATTERN: Array<
  Exclude<HomeFeedRowBucket, "schedule" | "live">
> = ["global_media", "church_media", "church_post"];

function homeFeedRowChurchId(row: any) {
  return String(row?.churchId || row?.ownerChurchId || "").trim();
}

function isHomeFeedLivestreamRow(row: any) {
  if (!row) return false;
  const id = String(row?.id || "").toLowerCase();
  if (id.startsWith("church-live-now-") || id.startsWith("media-live-now-")) return true;
  return (
    Boolean(row?.isLiveNow || row?.kind === "live") && !isMediaLiveSlotsHomeFeedRow(row)
  );
}

function classifyHomeFeedPostRowBucket(row: any, viewerChurchId: string): HomeFeedRowBucket {
  if (isHomeFeedLivestreamRow(row)) return "live";
  if (isVideoPost(row)) {
    const cid = homeFeedRowChurchId(row);
    if (cid && viewerChurchId && cid !== viewerChurchId) return "global_media";
    return "church_media";
  }
  return "church_post";
}

function sortBucketByPersonalSeed(
  rows: any[],
  ctx: HomeFeedPersonalOrderContext
) {
  return sortRowsByPersonalSeed(rows, ctx, (row) => feedRenderKey(row), homeFeedPostSortMs);
}

function pickInterleaveRow(
  bucket: Exclude<HomeFeedRowBucket, "schedule" | "live">,
  buckets: Record<Exclude<HomeFeedRowBucket, "schedule" | "live">, any[]>,
  lastChurchId: string
) {
  const list = buckets[bucket];
  if (!list.length) return null;

  if (!lastChurchId) {
    return list.shift() || null;
  }

  const altIdx = list.findIndex((row) => homeFeedRowChurchId(row) !== lastChurchId);
  const idx = altIdx >= 0 ? altIdx : 0;
  return list.splice(idx, 1)[0] || null;
}

/** User-seeded mix for normal posts (live handled in priority block). */
function interleaveHomeFeedPostRows(
  postRows: any[],
  viewerChurchId: string,
  personalCtx: HomeFeedPersonalOrderContext
) {
  const buckets: Record<Exclude<HomeFeedRowBucket, "schedule" | "live">, any[]> = {
    global_media: [],
    church_media: [],
    church_post: [],
  };

  for (const row of postRows) {
    const bucket = classifyHomeFeedPostRowBucket(row, viewerChurchId);
    if (bucket === "live") continue;
    buckets[bucket as Exclude<HomeFeedRowBucket, "schedule" | "live">].push(row);
  }

  for (const bucket of Object.keys(buckets) as Array<Exclude<HomeFeedRowBucket, "schedule" | "live">>) {
    buckets[bucket] = sortBucketByPersonalSeed(buckets[bucket], personalCtx);
  }

  const interleaved: any[] = [];
  let lastChurchId = "";
  let idleRounds = 0;
  const maxIdle = HOME_FEED_POST_INTERLEAVE_PATTERN.length * 3;

  while (idleRounds < maxIdle) {
    let pickedAny = false;
    for (const bucket of HOME_FEED_POST_INTERLEAVE_PATTERN) {
      const row = pickInterleaveRow(bucket, buckets, lastChurchId);
      if (!row) continue;
      interleaved.push(row);
      const cid = homeFeedRowChurchId(row);
      if (cid) lastChurchId = cid;
      pickedAny = true;
      idleRounds = 0;
    }
    if (!pickedAny) idleRounds += 1;
  }

  for (const bucket of Object.keys(buckets) as Array<Exclude<HomeFeedRowBucket, "schedule" | "live">>) {
    interleaved.push(...buckets[bucket]);
  }

  if (isKristoVerboseFeedDebug()) {
    console.log("KRISTO_HOME_FEED_INTERLEAVE", {
      viewerChurchId,
      seedKey: personalCtx.seedKey,
      inputCount: postRows.length,
      outputCount: interleaved.length,
      bucketCounts: Object.fromEntries(
        (Object.keys(buckets) as Array<Exclude<HomeFeedRowBucket, "schedule" | "live">>).map(
          (k) => [k, buckets[k].length]
        )
      ),
      firstIds: interleaved.slice(0, 8).map((row) => feedRenderKey(row) || String(row?.id || "")),
      firstChurches: interleaved.slice(0, 8).map((row) => homeFeedRowChurchId(row) || null),
    });
  }

  return interleaved;
}

function sortHomeFeedLivePriorityRows(rows: any[]) {
  return [...rows].sort(
    (a, b) => homeFeedPostSortMs(b) - homeFeedPostSortMs(a)
  );
}

function buildHomeFeedPriorityLayout(
  liveRows: any[],
  scheduleRows: any[],
  personalizedPosts: any[],
  nowMs: number
) {
  return filterVisibleHomeFeedScheduleRows(
    [...liveRows, ...scheduleRows, ...personalizedPosts],
    nowMs
  );
}

let lastStableHomeFeedDisplayRows: any[] = [];

function isHomeFeedExpandedOrScheduleSlotRow(row: any) {
  return (
    isHomeFeedExpandedScheduleSlotRow(row) ||
    isHomeFeedScheduleCardRow(row) ||
    isHomeFeedMediaScheduleSourceRow(row)
  );
}

function mergePostsWithStableScheduleRows(
  liveRows: any[],
  personalizedPosts: any[],
  stableRows: any[],
  nowMs: number
) {
  const stableSchedules = sortHomeFeedScheduleSlotRows(
    stableRows.filter(isHomeFeedExpandedOrScheduleSlotRow)
  );
  if (!stableSchedules.length) {
    return buildHomeFeedPriorityLayout(liveRows, [], personalizedPosts, nowMs);
  }
  return buildHomeFeedPriorityLayout(liveRows, stableSchedules, personalizedPosts, nowMs);
}

function filterRenderableHomeFeedScheduleRows(rows: any[], source: "backend" | "local") {
  return rows.filter((row) => {
    if (!isHomeFeedMediaScheduleSourceRow(row)) return true;

    const scheduleId = String(row?.id || "").trim();
    if (scheduleId && isHiddenInvalidHomeFeedSchedule(scheduleId)) return false;
    if (scheduleRowHasValidSlotTimes(row)) return true;

    markHiddenInvalidHomeFeedSchedule(row, source);
    return false;
  });
}

/** Drop schedule slot rows whose shared visual helper resolves ended at build time. */
export function isHomeFeedScheduleSlotRowVisible(row: any, nowMs = Date.now()): boolean {
  if (!isHomeFeedScheduleCardRow(row)) return true;

  if (isHomeFeedExpandedScheduleSlotRow(row)) {
    const slot = Array.isArray(row?.scheduleSlots) ? row.scheduleSlots[0] : null;
    if (!slot) return false;
    if (!homeFeedSlotHasValidTimeWindow(slot)) return false;
    const slotNumber = Math.max(1, Number(row?.slotNumber || 1));
    const slotFeedIndex = slotNumber - 1;
    const visual = resolveScheduleSlotVisualState(slot, slotFeedIndex, nowMs, {
      slotId: String(slot?.id || row?.id || ""),
    });
    return Boolean(visual && !visual.expired);
  }

  if (shouldExpandHomeFeedScheduleRow(row)) {
    return expandHomeFeedScheduleIntoSlotRows(row, nowMs).length > 0;
  }

  const slots = Array.isArray(row?.scheduleSlots) ? row.scheduleSlots : [];
  if (!slots.length) return false;

  return slots.some((slot: any, index: number) => {
    const slotNumber = resolveHomeFeedSlotNumber(slot, index + 1);
    const slotFeedIndex = resolveHomeFeedSlotFeedIndex(slot, index);
    const visual = resolveScheduleSlotVisualState(slot, slotFeedIndex, nowMs, {
      slotId: String(slot?.id || `${row?.id || ""}:slot:${slotNumber}`),
    });
    return Boolean(visual && !visual.expired);
  });
}

export function filterVisibleHomeFeedScheduleRows(rows: any[], nowMs = Date.now()) {
  const filtered = rows.filter((row) => isHomeFeedScheduleSlotRowVisible(row, nowMs));
  const removedCount = rows.length - filtered.length;
  if (removedCount > 0 && isKristoVerboseSlotTimeDebug()) {
    console.log("KRISTO_HOME_EXPIRED_SLOTS_FILTERED", {
      removedCount,
      keptCount: filtered.length,
      stage: "display_builder",
    });
  }
  return filtered;
}

let lastHomeFeedBuildDigest = "";
let lastHomeFeedBuildResult: any[] = [];

function homeFeedBuildDigest(
  backendRows: any[],
  localRows: any[],
  nowMs: number,
  personalSeedKey: string
) {
  const summarize = (rows: any[]) =>
    rows
      .map((row) => {
        const id = String(row?.id || "").trim();
        const slots = Array.isArray(row?.scheduleSlots) ? row.scheduleSlots.length : 0;
        const valid = isHomeFeedMediaScheduleSourceRow(row)
          ? scheduleRowHasValidSlotTimes(row)
            ? 1
            : 0
          : 2;
        return `${id}:${slots}:${valid}`;
      })
      .join("|");
  const scheduleTick = Math.floor(nowMs / 30_000);
  return `${personalSeedKey}::${summarize(backendRows)}::${summarize(localRows)}::${scheduleTick}`;
}

/** Merged Home Feed list: video/posts first, then active schedule slot cards. */
export function buildHomeFeedDisplayRows(
  backendRows: any[],
  localRows: any[],
  nowMs = Date.now()
) {
  const sanitizedBackendRows = filterRenderableHomeFeedScheduleRows(backendRows, "backend");
  const sanitizedLocalRows = filterRenderableHomeFeedScheduleRows(localRows, "local");
  const personalCtx = resolveHomeFeedPersonalOrderContext(nowMs);
  resetHomeFeedPersonalOrderIfNeeded(personalCtx.seedKey);
  logHomeFeedPersonalSeed(personalCtx);

  const digest = homeFeedBuildDigest(
    sanitizedBackendRows,
    sanitizedLocalRows,
    nowMs,
    personalCtx.seedKey
  );
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
  const scheduleRows = filtered.filter(
    (row) => isExplicitHomeFeedMediaScheduleRow(row) || isMediaLiveSlotsHomeFeedRow(row)
  );
  const postRows = filtered.filter(
    (row) => !isExplicitHomeFeedMediaScheduleRow(row) && !isMediaLiveSlotsHomeFeedRow(row)
  );
  const expandedScheduleRows = scheduleRows.flatMap((row) =>
    expandHomeFeedScheduleIntoSlotRows(row, nowMs)
  );
  const sortedPostRows = [...postRows].sort(
    (a, b) => homeFeedPostSortMs(b) - homeFeedPostSortMs(a)
  );
  const viewerChurchId = String((getSessionSync() as any)?.churchId || "").trim();
  const orderedScheduleRows = sortHomeFeedScheduleSlotRows(expandedScheduleRows);
  const liveRows = sortHomeFeedLivePriorityRows(
    sortedPostRows.filter((row) => isHomeFeedLivestreamRow(row))
  );
  const nonLivePosts = sortedPostRows.filter((row) => !isHomeFeedLivestreamRow(row));
  const personalizedPosts = interleaveHomeFeedPostRows(
    nonLivePosts,
    viewerChurchId,
    personalCtx
  );
  let display = buildHomeFeedPriorityLayout(
    liveRows,
    orderedScheduleRows,
    personalizedPosts,
    nowMs
  );

  const scheduleSlotCount = display.filter(
    (row) => isHomeFeedScheduleCardRow(row) || isHomeFeedExpandedScheduleSlotRow(row)
  ).length;
  const hadDeferredLocalSchedule = localRows.some((row) => {
    if (!isHomeFeedMediaScheduleSourceRow(row)) return false;
    const id = String(row?.id || "").trim();
    if (id && isHiddenInvalidHomeFeedSchedule(id)) return false;
    return !scheduleRowHasValidSlotTimes(row);
  });

  if (scheduleSlotCount === 0 && hadDeferredLocalSchedule && lastStableHomeFeedDisplayRows.length) {
    display = mergePostsWithStableScheduleRows(
      liveRows,
      personalizedPosts,
      lastStableHomeFeedDisplayRows,
      nowMs
    );
    if (isKristoVerboseFeedDebug()) {
      console.log("KRISTO_HOME_FEED_SCHEDULE_STABLE_FALLBACK", {
        keptScheduleCount: display.filter(isHomeFeedExpandedOrScheduleSlotRow).length,
        postCount: personalizedPosts.length,
      });
    }
  }

  logHomeFeedPersonalOrder(display, personalCtx, feedRenderKey);
  logHomeFeedFirstRows(display, feedRenderKey);

  if (display.length) {
    lastStableHomeFeedDisplayRows = display;
  }

  lastHomeFeedBuildDigest = digest;
  lastHomeFeedBuildResult = display;

  if (isKristoVerboseFeedDebug()) {
    const videoCount = display.filter((row) => isVideoPost(row)).length;
    console.log("KRISTO_HOME_FEED_ORDER_DEBUG", {
      videoCount,
      scheduleSlotCount,
      firstIds: display.slice(0, 8).map((row) => String(row?.id || "")),
      scheduleOrder: orderedScheduleRows
        .slice(0, 12)
        .map((row) => Number(row?.slotNumber || 0) || null),
    });

    console.log("KRISTO_HOME_FEED_VISIBLE_DATA", {
      backendCount: backendRows.length,
      localCount: localRows.length,
      sanitizedLocalCount: sanitizedLocalRows.length,
      mergedCount: byId.size,
      filteredCount: filtered.length,
      scheduleSourceCount: scheduleRows.length,
      scheduleCount: orderedScheduleRows.length,
      displayCount: display.length,
      videoCount,
      scheduleSlotCount,
      scheduleIds: scheduleRows.map((row) => String(row?.id || "")),
      scheduleSlotCounts: scheduleRows.map((row) => homeFeedScheduleSlotCount(row)),
      expandedScheduleIds: orderedScheduleRows.map((row) => String(row?.id || "")),
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
      item?.posterUrl ||
      item?.coverImage ||
      item?.coverImageUrl ||
      item?.poster
  );
}

export function hasBrandedVideoPoster(item: any) {
  return itemUsesBrandedVideoPoster(item);
}

export function isValidVideoPosterUri(posterUri: string, videoUri: string) {
  const poster = String(posterUri || "").trim();
  const video = String(videoUri || "").trim();
  if (!poster) return false;
  if (isBrandedPosterUri(poster)) return false;
  if (video && poster === video) return false;
  if (/\.(mp4|mov|m4v|webm|mkv)(\?|#|$)/i.test(poster)) return false;
  return true;
}

export function hasHomeFeedVideoPoster(item: any, videoUri?: string) {
  const video = String(videoUri || resolveVideoUri(item) || "").trim();
  const poster = resolvePosterUri(item);
  return isValidVideoPosterUri(poster, video) || hasBrandedVideoPoster(item);
}

export function isVideoPost(item: any) {
  const uri = resolveVideoUri(item);
  return Boolean(uri) && (item?.mediaType === "video" || isFeedVideoItem(item));
}

export function isImagePost(item: any) {
  const uri = resolveImageUri(item);
  return Boolean(uri) && item?.mediaType === "image" && !isVideoPost(item);
}
