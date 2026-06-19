import { apiGet } from "@/lib/kristoApi";
import {
  feedList,
  feedPurgeMediaScheduleCards,
  feedPurgeMediaScheduleCardsForChurch,
} from "@/lib/homeFeedStore";
import { parseChurchFeedListResponse } from "@/lib/mediaScheduleFeedParse";
import {
  isMediaScheduleFeedItem,
  isMediaScheduleFeedItemClosed,
} from "@/lib/mediaScheduleFeedIdentify";
import { prepareMediaScheduleFeedItemForClient } from "@/lib/mediaScheduleFeedPrepare";
import {
  feedItemBelongsToChurch,
  feedItemBelongsToChurchStrict,
  findActiveMediaScheduleForChurch,
  findMediaScheduleFeedForChurch,
  findPersistedMediaScheduleFeedForChurch,
  isActiveMediaSchedule,
  resolveChurchMediaScheduleFromFeedRows,
} from "@/lib/mediaScheduleChurchFinders";
import { findProtectedClaimableSchedule, findProtectedNearLiveSchedule } from "@/lib/liveScheduleProtection";
import {
  areAllScheduleSlotsExpired,
  getActiveScheduleSlots,
} from "@/lib/mediaScheduleSlotExpired";
import {
  isMediaSlotEndedOrStale,
  resolveMediaSlotTimeWindow,
} from "@/lib/mediaScheduleSlotTimeCore";

export { isMediaScheduleFeedItem, isMediaScheduleFeedItemClosed } from "@/lib/mediaScheduleFeedIdentify";
export { isActiveScheduleSlot } from "@/lib/mediaScheduleSlotActive";
export { prepareMediaScheduleFeedItemForClient } from "@/lib/mediaScheduleFeedPrepare";
export {
  feedItemBelongsToChurch,
  feedItemBelongsToChurchStrict,
  findActiveMediaScheduleForChurch,
  findMediaScheduleFeedForChurch,
  findPersistedMediaScheduleFeedForChurch,
  isActiveMediaSchedule,
  resolveChurchMediaScheduleFromFeedRows,
} from "@/lib/mediaScheduleChurchFinders";
import {
  backendConfirmsZeroSlotsForFeedId,
  purgeStaleLocalScheduleRowsWhenBackendZero,
} from "@/lib/staleBackendZeroSlotGuard";

export const ACTIVE_MEDIA_SCHEDULE_ERROR =
  "A media schedule is already active. Please end or delete it before creating another one.";

type AnyFeedItem = Record<string, any>;

export { areAllScheduleSlotsExpired, getActiveScheduleSlots } from "@/lib/mediaScheduleSlotExpired";
export {
  findProtectedClaimableSchedule,
  findProtectedNearLiveSchedule,
} from "@/lib/liveScheduleProtection";

export function isIncomingMediaScheduleCreate(body: AnyFeedItem | null | undefined): boolean {
  const source = String(body?.source || "").trim().toLowerCase();
  const scheduleType = String(body?.scheduleType || "").trim().toLowerCase();

  return source === "media-schedule" || scheduleType === "media-live-slots";
}

export function summarizeActiveMediaSchedule(item: AnyFeedItem | null | undefined) {
  if (!item) return null;

  const slots = Array.isArray(item.scheduleSlots) ? item.scheduleSlots : [];
  const activeSlots = getActiveScheduleSlots(item);

  return {
    id: String(item.id || ""),
    title: String(item.title || item.text || ""),
    createdBy: String(item.createdBy || ""),
    scheduleSlots: slots,
    slotCount: slots.length,
    activeSlotCount: activeSlots.length,
    status: String(item.status || ""),
    deletedAt: item.deletedAt || null,
  };
}

function parseFeedApiRows(res: any): AnyFeedItem[] {
  return parseChurchFeedListResponse(res).rows;
}

function isLocalMediaScheduleCard(item: AnyFeedItem): boolean {
  const id = String(item?.id || "").toLowerCase();
  return (
    isMediaScheduleFeedItem(item) ||
    id.startsWith("media-live-") ||
    id.startsWith("media-schedule-")
  );
}

function purgeStaleLocalMediaSchedules(churchId: string, localActive: AnyFeedItem | null) {
  feedPurgeMediaScheduleCardsForChurch(churchId);
  feedPurgeMediaScheduleCards();

  console.log("KRISTO_MEDIA_LOCK_BACKEND_CLEAR_LOCAL_STALE_PURGED", {
    churchId,
    localActiveId: localActive ? String(localActive.id || "") : null,
  });

  if (localActive) {
    console.log("KRISTO_MEDIA_LOCK_FALSE_POSITIVE_SOURCE", {
      source: "local-feedList",
      item: summarizeActiveMediaSchedule(localActive),
      backendActive: null,
    });
  }
}

function countRenderedLiveSlotsForSchedule(item: AnyFeedItem, _churchId: string, nowMs: number) {
  const activeSlots = getActiveScheduleSlots(item, nowMs);
  if (!activeSlots.length) return 0;
  return activeSlots.filter((slot) => {
    if (isMediaSlotEndedOrStale(slot, nowMs)) return false;
    const { startMs, endMs } = resolveMediaSlotTimeWindow(slot, nowMs);
    return startMs > 0 && endMs > startMs;
  }).length;
}

export function scanMediaScheduleRowForLock(
  item: AnyFeedItem | null | undefined,
  churchId: string,
  nowMs = Date.now()
) {
  const feedId = String(item?.id || item?.sourceScheduleId || "").trim();
  const slots = Array.isArray(item?.scheduleSlots) ? item.scheduleSlots : [];
  const prepared = prepareMediaScheduleFeedItemForClient(item);
  const rawActiveSlots = item ? getActiveScheduleSlots(item, nowMs) : [];
  const activeSlots = prepared ? getActiveScheduleSlots(prepared, nowMs) : [];
  const renderedInLiveSlots = prepared
    ? countRenderedLiveSlotsForSchedule(prepared, churchId, nowMs)
    : 0;
  const claimable =
    prepared && isMediaScheduleFeedItem(prepared)
      ? findProtectedClaimableSchedule([prepared], churchId, nowMs)
      : null;
  const protectedRow =
    Boolean(claimable) && activeSlots.length > 0 && renderedInLiveSlots > 0;

  return {
    feedId,
    slotCount: slots.length,
    activeSlotCount: activeSlots.length,
    rawActiveSlotCount: rawActiveSlots.length,
    materializedActiveSlotCount: activeSlots.length,
    renderedInLiveSlots,
    protected: protectedRow,
    reason: protectedRow
      ? "open-claimable-slot"
      : activeSlots.length > 0
        ? renderedInLiveSlots > 0
          ? "active-slots"
          : "stale-non-rendered-slots"
        : slots.length > 0
          ? "inactive-or-unparsed-slots"
          : "empty-slots",
  };
}

export async function findActiveMediaScheduleForChurchFromSources(
  churchId: string,
  options?: {
    headers?: Record<string, string>;
    excludeId?: string;
    nowMs?: number;
  }
) {
  const cid = String(churchId || "").trim();
  if (!cid) return null;

  const nowMs = options?.nowMs ?? Date.now();
  const excludeId = options?.excludeId;
  const strictFindOpts = { excludeId, nowMs, strictChurch: true as const };
  const looseFindOpts = { excludeId, nowMs, strictChurch: false as const };

  let backendRows: AnyFeedItem[] = [];
  let backendFetchOk = false;

  try {
    const res: any = await apiGet(`/api/church/feed?scope=church&_=${Date.now()}`, {
      headers: options?.headers,
      cache: "no-store" as RequestCache,
    });
    backendRows = parseFeedApiRows(res);
    backendFetchOk = true;
  } catch (e) {
    console.log("KRISTO_MEDIA_LOCK_BACKEND_FETCH_ERROR", e);
  }

  if (backendFetchOk) {
    purgeStaleLocalScheduleRowsWhenBackendZero({
      backendRows,
      backendFeedLoaded: true,
      churchId: cid,
      reason: "media-lock-scan",
    });
  }

  for (const row of backendRows) {
    if (!isMediaScheduleFeedItem(row)) continue;
    if (!feedItemBelongsToChurchStrict(row, cid)) continue;
    console.log("KRISTO_ACTIVE_SCHEDULE_SCAN", scanMediaScheduleRowForLock(row, cid, nowMs));
  }

  const backendActive =
    resolveChurchMediaScheduleFromFeedRows(backendRows, cid, {
      strictChurch: true,
      nowMs,
      excludeId,
    }) ||
    findActiveMediaScheduleForChurch(backendRows, cid, strictFindOpts);
  if (backendActive) {
    console.log("KRISTO_MEDIA_LOCK_BACKEND_ACTIVE", summarizeActiveMediaSchedule(backendActive));

    const localActive = findActiveMediaScheduleForChurch(feedList() as any[], cid, looseFindOpts);
    if (localActive && String(localActive.id || "") !== String(backendActive.id || "")) {
      console.log("KRISTO_MEDIA_LOCK_FALSE_POSITIVE_SOURCE", {
        source: "local-feedList-extra",
        item: summarizeActiveMediaSchedule(localActive),
        backendActive: summarizeActiveMediaSchedule(backendActive),
      });
    }

    return backendActive;
  }

  if (backendFetchOk) {
    const localActive = findActiveMediaScheduleForChurch(feedList() as any[], cid, looseFindOpts);
    const hasLocalMediaCards = (feedList() as any[]).some((item) => isLocalMediaScheduleCard(item));
    if (localActive || hasLocalMediaCards) {
      purgeStaleLocalMediaSchedules(cid, localActive);
    }
    return null;
  }

  const localActive = findActiveMediaScheduleForChurch(feedList() as any[], cid, looseFindOpts);
  const hasLocalMediaCards = (feedList() as any[]).some((item) => isLocalMediaScheduleCard(item));
  const protectedClaimable = findProtectedClaimableSchedule(feedList() as any[], cid, nowMs);
  const protectedNearLive = findProtectedNearLiveSchedule(feedList() as any[], cid, nowMs);

  if (protectedClaimable) {
    const scan = scanMediaScheduleRowForLock(protectedClaimable.item, cid, nowMs);
    console.log("KRISTO_ACTIVE_SCHEDULE_SCAN", scan);
    const backendZero = backendConfirmsZeroSlotsForFeedId(
      String(protectedClaimable.item?.id || scan.feedId || ""),
      backendRows,
      backendFetchOk
    );
    if (backendZero) {
      console.log("KRISTO_STALE_ROUTE_SLOTS_IGNORED", {
        canonicalFeedId: scan.feedId,
        localScheduleId: String(protectedClaimable.item?.id || ""),
        backendSlotCount: 0,
        routeSlotCount: scan.slotCount,
        reason: "media-lock-protected-claimable-backend-zero",
      });
    } else if (scan.protected && scan.renderedInLiveSlots > 0) {
      console.log("KRISTO_ACTIVE_SCHEDULE_PROTECTED", {
        ...scan,
        churchId: cid,
        reason: "media-lock-open-claimable-slot",
        slotId: String(protectedClaimable.slot?.id || ""),
      });
      return protectedClaimable.item;
    }
  }

  if (protectedNearLive) {
    const scan = scanMediaScheduleRowForLock(protectedNearLive.item, cid, nowMs);
    console.log("KRISTO_ACTIVE_SCHEDULE_SCAN", scan);
    const backendZero = backendConfirmsZeroSlotsForFeedId(
      String(protectedNearLive.item?.id || scan.feedId || ""),
      backendRows,
      backendFetchOk
    );
    if (backendZero) {
      console.log("KRISTO_STALE_ROUTE_SLOTS_IGNORED", {
        canonicalFeedId: scan.feedId,
        localScheduleId: String(protectedNearLive.item?.id || ""),
        backendSlotCount: 0,
        routeSlotCount: scan.slotCount,
        reason: "media-lock-protected-near-live-backend-zero",
      });
    } else if (scan.activeSlotCount > 0 && scan.renderedInLiveSlots > 0) {
      console.log("KRISTO_ACTIVE_SCHEDULE_PROTECTED", {
        ...scan,
        churchId: cid,
        reason: "media-lock-backend-miss",
        slotId: String(protectedNearLive.slot?.id || ""),
      });
      return protectedNearLive.item;
    }
  }

  if (localActive || hasLocalMediaCards) {
    purgeStaleLocalMediaSchedules(cid, localActive);
  }

  return null;
}

export async function hasActiveMediaScheduleForChurch(
  churchId: string,
  options?: {
    headers?: Record<string, string>;
    excludeId?: string;
    nowMs?: number;
  }
) {
  const active = await findActiveMediaScheduleForChurchFromSources(churchId, options);
  return !!active;
}
