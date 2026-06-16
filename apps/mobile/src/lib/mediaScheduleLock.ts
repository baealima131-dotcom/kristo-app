import { apiGet } from "@/src/lib/kristoApi";
import {
  feedList,
  feedPurgeMediaScheduleCards,
  feedPurgeMediaScheduleCardsForChurch,
} from "@/src/lib/homeFeedStore";
import { parseChurchFeedListResponse } from "@/src/lib/mediaScheduleSilentReload";
import { findProtectedClaimableSchedule, findProtectedNearLiveSchedule } from "@/src/lib/liveScheduleRing";
import { buildLiveSlotsCatalogFromFeedRows } from "@/src/lib/liveSlotsCatalog";
import {
  isMediaSlotEndedOrStale,
  materializeMediaSlotTimeFields,
  resolveMediaSlotTimeWindow,
} from "@/src/lib/mediaScheduleSlotTimes";
import { parseSlotEndMs, parseSlotStartMs } from "@/src/lib/scheduleSlotUtils";
import {
  backendConfirmsZeroSlotsForFeedId,
  purgeStaleLocalScheduleRowsWhenBackendZero,
} from "@/src/lib/staleBackendZeroSlotGuard";

export const ACTIVE_MEDIA_SCHEDULE_ERROR =
  "A media schedule is already active. Please end or delete it before creating another one.";

type AnyFeedItem = Record<string, any>;

export function prepareMediaScheduleFeedItemForClient(item: AnyFeedItem | null | undefined) {
  if (!item || typeof item !== "object") return item;
  const slots = Array.isArray(item.scheduleSlots) ? item.scheduleSlots : [];
  if (!slots.length) return item;

  return {
    ...item,
    scheduleSlots: slots.map((slot: any, index: number) =>
      materializeMediaSlotTimeFields({
        ...slot,
        order: Number(slot?.order || slot?.slot || index + 1),
        slot: Number(slot?.slot || slot?.slotNumber || index + 1),
        slotNumber: Number(slot?.slotNumber || slot?.slot || index + 1),
      })
    ),
  };
}

function isSlotStatusClosed(slot: AnyFeedItem): boolean {
  const status = String(slot?.status || "").toLowerCase();
  const scheduleStatus = String(slot?.scheduleStatus || "").toLowerCase();
  return (
    slot?.deleted === true ||
    slot?.deletedAt ||
    status === "deleted" ||
    status === "cancelled" ||
    status === "canceled" ||
    status === "completed" ||
    status === "complete" ||
    status === "removed" ||
    status === "ended" ||
    status === "closed" ||
    status === "cleared" ||
    scheduleStatus === "deleted" ||
    scheduleStatus === "ended" ||
    scheduleStatus === "closed" ||
    scheduleStatus === "cleared"
  );
}

function isSlotClaimedOrLive(slot: AnyFeedItem): boolean {
  const status = String(slot?.status || "").toLowerCase();
  if (status === "claimed" || status === "live") return true;
  if (slot?.claimed === true || slot?.isClaimed === true || slot?.isLiveNow === true) return true;

  const uid = String(slot?.claimedByUserId || slot?.claimedBy?.userId || "").trim();
  if (uid) return true;

  const claimedBy = slot?.claimedBy;
  if (typeof claimedBy === "object" && claimedBy && String(claimedBy.userId || "").trim()) return true;
  if (typeof claimedBy === "string" && claimedBy.trim() && claimedBy.toLowerCase() !== "open") return true;

  return false;
}

export function isMediaScheduleFeedItem(item: AnyFeedItem | null | undefined): boolean {
  if (!item || typeof item !== "object") return false;

  const source = String(item.source || "").toLowerCase();
  const scheduleType = String(item.scheduleType || "").toLowerCase();

  return source.includes("media-schedule") || scheduleType === "media-live-slots";
}

export function isMediaScheduleFeedItemClosed(item: AnyFeedItem): boolean {
  if (item?.deletedAt) return true;
  if (item?.pendingBackendFailed === true) return true;

  const status = String(item?.status || "").toLowerCase();
  const scheduleStatus = String(item?.scheduleStatus || "").toLowerCase();
  const deleted = item?.deleted === true || status === "deleted" || scheduleStatus === "deleted";
  const cancelled = status === "cancelled" || status === "canceled";
  const completed =
    status === "completed" ||
    status === "closed" ||
    status === "ended" ||
    status === "complete" ||
    status === "cleared" ||
    scheduleStatus === "ended" ||
    scheduleStatus === "closed" ||
    scheduleStatus === "cleared";

  return deleted || cancelled || completed;
}

export function isActiveScheduleSlot(
  slot: AnyFeedItem | null | undefined,
  nowMs = Date.now()
): boolean {
  if (!slot || typeof slot !== "object") return false;
  if (isSlotStatusClosed(slot) || isMediaSlotEndedOrStale(slot, nowMs)) return false;

  const { startMs, endMs } = resolveMediaSlotTimeWindow(slot, nowMs);
  if (startMs > nowMs) return true;
  if (startMs > 0 && endMs > startMs && nowMs <= endMs) return true;

  if (isSlotClaimedOrLive(slot)) {
    if (endMs <= 0) return true;
    return nowMs <= endMs;
  }

  return false;
}

export function getActiveScheduleSlots(
  item: AnyFeedItem | null | undefined,
  nowMs = Date.now()
): AnyFeedItem[] {
  const slots = Array.isArray(item?.scheduleSlots) ? item.scheduleSlots : [];
  return slots.filter((slot) => isActiveScheduleSlot(slot, nowMs));
}

export function areAllScheduleSlotsExpired(item: AnyFeedItem, nowMs = Date.now()): boolean {
  const slots = Array.isArray(item?.scheduleSlots) ? item.scheduleSlots : [];
  if (!slots.length) return true;
  return getActiveScheduleSlots(item, nowMs).length === 0;
}

export function isActiveMediaSchedule(item: AnyFeedItem | null | undefined, nowMs = Date.now()): boolean {
  if (!isMediaScheduleFeedItem(item)) return false;
  if (isMediaScheduleFeedItemClosed(item as AnyFeedItem)) return false;

  const slots = Array.isArray(item?.scheduleSlots) ? item.scheduleSlots : [];
  if (!slots.length) return false;

  return getActiveScheduleSlots(item, nowMs).length > 0;
}

export function feedItemBelongsToChurch(item: AnyFeedItem, churchId: string): boolean {
  const cid = String(churchId || "").trim();
  if (!cid) return true;

  const itemCid = String(item?.churchId || "").trim();
  if (itemCid) return itemCid === cid;

  return true;
}

export function feedItemBelongsToChurchStrict(item: AnyFeedItem, churchId: string): boolean {
  const cid = String(churchId || "").trim();
  const itemCid = String(item?.churchId || "").trim();
  if (!cid || !itemCid) return false;
  return itemCid === cid;
}

export function findActiveMediaScheduleForChurch(
  items: AnyFeedItem[],
  churchId: string,
  options?: { excludeId?: string; nowMs?: number; strictChurch?: boolean }
): AnyFeedItem | null {
  const cid = String(churchId || "").trim();
  if (!cid) return null;

  const excludeId = String(options?.excludeId || "").trim();
  const nowMs = options?.nowMs ?? Date.now();
  const belongsToChurch = options?.strictChurch
    ? (item: AnyFeedItem) => feedItemBelongsToChurchStrict(item, cid)
    : (item: AnyFeedItem) => feedItemBelongsToChurch(item, cid);

  for (const item of items) {
    if (excludeId && String(item?.id || "") === excludeId) continue;
    if (!belongsToChurch(item)) continue;
    if (isActiveMediaSchedule(item, nowMs)) return item;
  }

  return null;
}

/** Any persisted media schedule row for a church with at least one active slot. */
export function findMediaScheduleFeedForChurch(
  items: AnyFeedItem[],
  churchId: string,
  options?: { strictChurch?: boolean; nowMs?: number }
): AnyFeedItem | null {
  const cid = String(churchId || "").trim();
  if (!cid) return null;
  const nowMs = options?.nowMs ?? Date.now();

  const belongsToChurch = options?.strictChurch
    ? (item: AnyFeedItem) => feedItemBelongsToChurchStrict(item, cid)
    : (item: AnyFeedItem) => feedItemBelongsToChurch(item, cid);

  for (const item of items) {
    if (!isMediaScheduleFeedItem(item)) continue;
    if (isMediaScheduleFeedItemClosed(item as AnyFeedItem)) continue;
    if (!belongsToChurch(item)) continue;
    const prepared = prepareMediaScheduleFeedItemForClient(item);
    if (prepared && getActiveScheduleSlots(prepared, nowMs).length > 0) return prepared;
  }

  return findPersistedMediaScheduleFeedForChurch(items, churchId, options);
}

/** Non-closed backend schedule row with slots — matches backend create lock even when time parsing is partial. */
export function findPersistedMediaScheduleFeedForChurch(
  items: AnyFeedItem[],
  churchId: string,
  options?: { strictChurch?: boolean; nowMs?: number }
): AnyFeedItem | null {
  const cid = String(churchId || "").trim();
  if (!cid) return null;
  void options?.nowMs;

  const belongsToChurch = options?.strictChurch
    ? (item: AnyFeedItem) => feedItemBelongsToChurchStrict(item, cid)
    : (item: AnyFeedItem) => feedItemBelongsToChurch(item, cid);

  for (const item of items) {
    if (!isMediaScheduleFeedItem(item)) continue;
    if (isMediaScheduleFeedItemClosed(item as AnyFeedItem)) continue;
    if (!belongsToChurch(item)) continue;
    const slots = Array.isArray(item?.scheduleSlots) ? item.scheduleSlots : [];
    if (slots.length > 0) {
      const prepared = prepareMediaScheduleFeedItemForClient(item);
      return prepared || item;
    }
  }

  return null;
}

export function resolveChurchMediaScheduleFromFeedRows(
  items: AnyFeedItem[],
  churchId: string,
  options?: { strictChurch?: boolean; nowMs?: number; excludeId?: string }
): AnyFeedItem | null {
  const nowMs = options?.nowMs ?? Date.now();
  const strictFindOpts = {
    excludeId: options?.excludeId,
    nowMs,
    strictChurch: options?.strictChurch !== false,
  };

  const active = findActiveMediaScheduleForChurch(items, churchId, strictFindOpts);
  if (active) {
    const prepared = prepareMediaScheduleFeedItemForClient(active);
    return prepared || active;
  }

  const feed = findMediaScheduleFeedForChurch(items, churchId, {
    strictChurch: options?.strictChurch !== false,
    nowMs,
  });
  if (feed) return feed;

  return findPersistedMediaScheduleFeedForChurch(items, churchId, {
    strictChurch: options?.strictChurch !== false,
    nowMs,
  });
}

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

function countRenderedLiveSlotsForSchedule(item: AnyFeedItem, churchId: string, nowMs: number) {
  const cid = String(churchId || "").trim();
  if (!cid) return 0;
  const catalog = buildLiveSlotsCatalogFromFeedRows([item], cid, "", nowMs);
  return catalog.myChurch.length + catalog.otherChurches.length;
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
