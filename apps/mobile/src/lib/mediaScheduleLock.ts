import { apiGet } from "@/src/lib/kristoApi";
import {
  CHURCH_LIVE_CONTROL_SCHEDULE_ROOM_ID,
  findActiveChurchLiveControlScheduleFromRoom,
  isChurchLiveControlScheduleFeedRow,
} from "@/src/lib/churchLiveControlSchedule";
import {
  feedList,
  feedPurgeMediaScheduleCards,
  feedPurgeMediaScheduleCardsForChurch,
} from "@/src/lib/homeFeedStore";
import { parseChurchFeedListResponse } from "@/src/lib/mediaScheduleFeedParse";
import { prepareMediaScheduleFeedItemForClient } from "@/src/lib/mediaScheduleFeedPrepare";
import {
  feedItemBelongsToChurchStrict,
  isMediaScheduleFeedItem,
} from "@/src/lib/mediaScheduleFeedPredicates";
import {
  findActiveMediaScheduleForChurch,
  resolveChurchMediaScheduleFromFeedRows,
  summarizeActiveMediaSchedule,
} from "@/src/lib/mediaScheduleChurchQueries";
import { getActiveScheduleSlots } from "@/src/lib/mediaScheduleSlotActive";
import { findProtectedClaimableSchedule, findProtectedNearLiveSchedule } from "@/src/lib/liveScheduleRingSlotWindow";
import { buildLiveSlotsCatalogFromFeedRows } from "@/src/lib/liveSlotsCatalog";
import { parseSlotEndMs, parseSlotStartMs } from "@/src/lib/scheduleSlotUtils";
import {
  backendConfirmsZeroSlotsForFeedId,
  purgeStaleLocalScheduleRowsWhenBackendZero,
} from "@/src/lib/staleBackendZeroSlotGuard";

export {
  feedItemBelongsToChurch,
  feedItemBelongsToChurchStrict,
  isMediaScheduleFeedItem,
  isMediaScheduleFeedItemClosed,
} from "@/src/lib/mediaScheduleFeedPredicates";
export {
  findActiveMediaScheduleForChurch,
  findMediaScheduleFeedForChurch,
  findPersistedMediaScheduleFeedForChurch,
  resolveChurchMediaScheduleFromFeedRows,
  summarizeActiveMediaSchedule,
} from "@/src/lib/mediaScheduleChurchQueries";
export {
  areAllScheduleSlotsExpired,
  getActiveScheduleSlots,
  isActiveMediaSchedule,
  isActiveScheduleSlot,
} from "@/src/lib/mediaScheduleSlotActive";
export { prepareMediaScheduleFeedItemForClient } from "@/src/lib/mediaScheduleFeedPrepare";

export const ACTIVE_MEDIA_SCHEDULE_ERROR =
  "A media schedule is already active. Please end or delete it before creating another one.";

type AnyFeedItem = Record<string, any>;

export function isIncomingMediaScheduleCreate(body: AnyFeedItem | null | undefined): boolean {
  const source = String(body?.source || "").trim().toLowerCase();
  const scheduleType = String(body?.scheduleType || "").trim().toLowerCase();

  return source === "media-schedule" || scheduleType === "media-live-slots";
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
  if (item && isChurchLiveControlScheduleFeedRow(item)) {
    return {
      feedId: String(item?.id || item?.sourceScheduleId || "").trim(),
      slotCount: Array.isArray(item?.scheduleSlots) ? item.scheduleSlots.length : 0,
      activeSlotCount: 0,
      rawActiveSlotCount: 0,
      materializedActiveSlotCount: 0,
      renderedInLiveSlots: 0,
      protected: false,
      reason: "church-live-control-room-only",
    };
  }

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

  const roomSchedule = await findActiveChurchLiveControlScheduleFromRoom(
    options?.headers,
    nowMs
  );
  if (roomSchedule) {
    console.log("KRISTO_MEDIA_LOCK_ROOM_ACTIVE", {
      churchId: cid,
      roomId: CHURCH_LIVE_CONTROL_SCHEDULE_ROOM_ID,
      slotCount: roomSchedule.slotCount,
      openSlotCount: roomSchedule.openSlotCount,
    });
    return {
      id: CHURCH_LIVE_CONTROL_SCHEDULE_ROOM_ID,
      sourceScheduleId: CHURCH_LIVE_CONTROL_SCHEDULE_ROOM_ID,
      source: "church-live-control",
      roomId: CHURCH_LIVE_CONTROL_SCHEDULE_ROOM_ID,
      roomKind: "church-live-control",
      churchId: cid,
      scheduleSlots: roomSchedule.cards.map((row: any) => row?.card).filter(Boolean),
    } as AnyFeedItem;
  }

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

  backendRows = backendRows.filter((row) => !isChurchLiveControlScheduleFeedRow(row));

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
    if (isChurchLiveControlScheduleFeedRow(row)) continue;
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

// Re-export slot time helpers used by legacy lock importers.
export {
  isMediaSlotEndedOrStale,
  materializeMediaSlotTimeFields,
  resolveMediaSlotTimeWindow,
} from "@/src/lib/mediaScheduleSlotTimes";

// Preserve parseSlot* imports for any deep lock consumers.
export { parseSlotEndMs, parseSlotStartMs };
