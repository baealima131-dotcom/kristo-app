import { apiPost } from "@/src/lib/kristoApi";
import {
  clearScheduleClaimRuntimeState,
  feedList,
  feedPurgeMediaScheduleCards,
  feedPurgeMediaScheduleCardsForChurch,
  feedRemoveScheduleMirrors,
  feedRemoveWhere,
  feedScheduleSlotsForLive,
  slotIdsMatch,
} from "@/src/lib/homeFeedStore";
import {
  applyBackendMediaScheduleToLocalFeed,
  clearMediaScheduleCachesForChurch,
  clearStaleMediaScheduleSpeakerSlotsForChurch,
  fetchMediaScheduleFeedSync,
  purgeAllLocalMediaScheduleSources,
  readFeedItemScheduleSlots,
  resetMediaScheduleSilentReloadCache,
  syncMediaScheduleSlotsToBackend,
} from "@/src/lib/mediaScheduleSilentReload";
import {
  findActiveMediaScheduleForChurch,
  findMediaScheduleFeedForChurch,
  findPersistedMediaScheduleFeedForChurch,
  resolveChurchMediaScheduleFromFeedRows,
} from "@/src/lib/mediaScheduleChurchQueries";
import { isChurchLiveControlScheduleFeedRow } from "@/src/lib/churchLiveControlSchedule";
import {
  isGuestCenterChurchLiveControlRoomSource,
  mutateChurchLiveControlGuestCenterRoomSchedule,
} from "@/src/lib/churchLiveControlGuestCenterMutations";
import {
  isMediaScheduleFeedItem,
  isMediaScheduleFeedItemClosed,
} from "@/src/lib/mediaScheduleFeedPredicates";
import { getActiveScheduleSlots } from "@/src/lib/mediaScheduleSlotActive";
import { overlayLocalScheduleClaimsOnFeedRows } from "@/src/lib/liveSlotsCatalog";
import {
  clearActiveLiveAfterGuestSlotDelete,
  shouldClearActiveLiveAfterGuestDelete,
} from "@/src/lib/guestClaimClearActiveLive";
import { publishLiveEnded } from "@/src/lib/liveBridge";
import {
  computeChurchScheduleTabLive,
  emitLiveRingRefresh,
  logRingToGuestCenterBridge,
  mergeFeedRowsForScheduleScan,
  recomputeScheduleRingsFromRows,
  resolveRingChurchScheduleSnapshot,
  resolveRingMergedScheduleRows,
} from "@/src/lib/liveScheduleRing";
import {
  baseFeedId,
  collectScheduleAliasIds,
  isBackendFeedScheduleId,
  isLocalMediaScheduleId,
  mergeLiveRoomScheduleSlots,
  resolveCanonicalScheduleFeedId,
} from "@/src/lib/scheduleSlotUtils";
import {
  resolveMediaSlotTimeWindow,
  summarizeGuestClaimSlotForLog,
} from "@/src/lib/mediaScheduleSlotTimes";
import { resolveCanonicalMediaScheduleForGuests } from "@/src/lib/mediaScheduleGuestResolve";
import {
  fetchHomeFeedFromApi,
  getCachedHomeFeedBackendRows,
  mergeCachedHomeFeedBackendRows,
  purgeHomeFeedPostFromBackendCache,
} from "@/src/components/homeFeed/homeFeedApi";
import { clearHomeFeedApiCache } from "@/src/lib/homeFeedScheduleDirty";
import {
  emitScheduleFeedDeleted,
  filterOutDeletedScheduleRows,
  markScheduleFeedDeleted,
  scheduleFeedRowIsDeleted,
} from "@/src/lib/deletedScheduleRegistry";
import {
  buildLiveSlotsCatalogFromFeedRows,
  resolveLiveSlotsBackendFeedRows,
} from "@/src/lib/liveSlotsCatalog";
import { emitSlotClaimChanged } from "@/src/lib/slotClaimEvents";
import { emitClaimUpdated } from "@/src/lib/kristoProfileEvents";
import {
  cleanupStaleMediaScheduleFeedRow,
  cleanupStaleMediaSchedulePair,
  clearMediaScheduleSlotsOnBackend,
  shouldEndStaleMediaScheduleFeedRow,
} from "@/src/lib/staleMediaScheduleCleanup";

export function clearGuestSlotClaimFields(slot: any) {
  const next = { ...slot };
  delete next.claimed;
  delete next.isClaimed;
  delete next.claimedByUserId;
  delete next.claimedByName;
  delete next.claimedByAvatar;
  delete next.claimedByAvatarUri;
  delete next.claimedByPhotoUrl;
  delete next.claimedAt;
  delete next.approvedAt;
  delete next.claimStatus;
  delete next.claimedBy;
  next.status = "open";
  next.approved = false;
  next.locked = false;
  return next;
}

export function resolveGuestActionSlotId(slots: any[], slotId: string) {
  const target = String(slotId || "").trim();
  if (!target) return "";

  const direct = slots.find((slot) => slotIdsMatch(slot, target));
  if (direct) {
    return String(direct?.id || direct?.slotId || target).trim();
  }

  const syncedIndexMatch = target.match(/^synced-slot-(\d+)$/i);
  if (syncedIndexMatch) {
    const index = Number(syncedIndexMatch[1]);
    const byIndex = slots[index];
    if (byIndex) {
      return String(byIndex?.id || byIndex?.slotId || byIndex?.slot || byIndex?.order || target).trim();
    }
  }

  return target;
}

export function isGuestScheduleSlotExpired(slot: any, nowMs = Date.now()) {
  const { endMs } = resolveMediaSlotTimeWindow(slot, nowMs);
  return Number.isFinite(endMs) && endMs > 0 && endMs <= nowMs;
}

export type GuestCenterCanonicalResult = {
  schedule: any | null;
  source:
    | "church-live-control-room"
    | "ring-live"
    | "ring-merged"
    | "backend-merged"
    | "backend"
    | "home"
    | "merged-scan"
    | "best-row"
    | "none";
  mergedRowCount: number;
  backendSlotCount: number;
  mergedSlotCount: number;
  scheduleChurchId: string;
  viewerChurchId: string;
  targetChurchId: string;
  feedId: string;
  ringMergedRowCount: number;
};

export function isGuestCenterScheduleRow(item: any): boolean {
  if (!item || typeof item !== "object") return false;
  if (isMediaScheduleFeedItem(item)) return true;

  const slots = Array.isArray(item?.scheduleSlots) ? item.scheduleSlots : [];
  if (!slots.length) return false;

  const id = String(item?.id || item?.sourceScheduleId || "").trim();
  if (id.startsWith("feed_") || id.startsWith("media-schedule-") || id.startsWith("media-live-")) {
    return true;
  }

  const source = String(item?.source || "").toLowerCase();
  const scheduleType = String(item?.scheduleType || "").toLowerCase();
  const roomKind = String(item?.roomKind || "").toLowerCase();
  if (source === "church-live-control" || roomKind.includes("church-live-control")) return true;
  return source.includes("media-schedule") || scheduleType.includes("media-live-slots");
}

function guestCenterRowMatchesChurch(row: any, churchId: string, strict = false): boolean {
  const cid = String(churchId || "").trim();
  if (!cid) return true;
  const rowCid = String(row?.churchId || row?.sourceChurchId || "").trim();
  if (!rowCid) return !strict;
  return rowCid === cid;
}

function findBestGuestCenterScheduleRow(rows: any[], churchIds: string[]): any | null {
  const ids = churchIds.map((id) => String(id || "").trim()).filter(Boolean);
  let best: any = null;
  let bestCount = 0;

  for (const row of rows) {
    if (!isGuestCenterScheduleRow(row)) continue;
    if (isMediaScheduleFeedItemClosed(row)) continue;

    const matchesChurch =
      ids.length === 0 ||
      ids.some((cid) => guestCenterRowMatchesChurch(row, cid, false));
    if (!matchesChurch) continue;

    const displayCount = filterGuestCenterDisplaySlots(
      Array.isArray(row?.scheduleSlots) ? row.scheduleSlots : []
    ).length;
    if (displayCount > bestCount) {
      best = row;
      bestCount = displayCount;
    }
  }

  return bestCount > 0 ? best : null;
}

function mergeGuestCenterScheduleSlotSources(input: {
  schedule: any;
  feedId: string;
  backendFeedItems: any[];
  overlayMatch: any | null;
  ringMergedRows?: any[];
}) {
  const seed = String(input.feedId || "").trim();
  const backendLookup = [
    ...(Array.isArray(input.backendFeedItems) ? input.backendFeedItems : []),
    ...(Array.isArray(input.ringMergedRows) ? input.ringMergedRows : []),
  ];
  const backendItem = seed ? findScheduleRow(backendLookup, seed) : null;
  const backendSlots = Array.isArray(backendItem?.scheduleSlots)
    ? backendItem.scheduleSlots
    : Array.isArray(input.schedule?.scheduleSlots)
      ? input.schedule.scheduleSlots
      : [];
  const feedSlots = seed ? feedScheduleSlotsForLive(seed) : [];
  const localSlots = Array.isArray(input.overlayMatch?.scheduleSlots)
    ? input.overlayMatch.scheduleSlots
    : [];

  const mergedSlots = mergeLiveRoomScheduleSlots(backendSlots, feedSlots, localSlots);
  if (!mergedSlots.length) return input.schedule;
  return { ...input.schedule, scheduleSlots: mergedSlots };
}

/** Guest Claim Center must read the same ring-merged schedule rows as KRISTO_LIVE_RING_FAST_SYNC. */
export function resolveGuestCenterCanonicalSchedule(input: {
  homeFeedItems: any[];
  backendFeedItems: any[];
  churchId: string;
  targetChurchId?: string;
  viewerUserId?: string;
  nowMs?: number;
  churchLiveControlRoomSchedule?: any | null;
}): GuestCenterCanonicalResult {
  const viewerChurchId = String(input.churchId || "").trim();
  const targetChurchId = String(input.targetChurchId || input.churchId || "").trim();
  const churchIds = Array.from(new Set([targetChurchId, viewerChurchId].filter(Boolean)));
  const nowMs = Number(input.nowMs || Date.now());

  const roomSchedule = input.churchLiveControlRoomSchedule;
  if (roomSchedule && isGuestCenterScheduleRow(roomSchedule)) {
    const displaySlots = filterGuestCenterDisplaySlots(
      Array.isArray(roomSchedule?.scheduleSlots) ? roomSchedule.scheduleSlots : []
    );
    if (displaySlots.length) {
      const schedule = { ...roomSchedule, scheduleSlots: displaySlots };
      const feedId = String(schedule?.sourceScheduleId || schedule?.id || "").trim();
      console.log("KRISTO_GUEST_CLAIM_CENTER_ROOM_SCHEDULE", {
        source: "church-live-control-room",
        feedId,
        guestClaimCenterSlotCount: displaySlots.length,
        slotIds: displaySlots.map((slot: any) => String(slot?.id || "")),
      });
      return {
        schedule,
        source: "church-live-control-room",
        mergedRowCount: 0,
        backendSlotCount: 0,
        mergedSlotCount: displaySlots.length,
        scheduleChurchId: String(schedule?.churchId || schedule?.sourceChurchId || viewerChurchId),
        viewerChurchId,
        targetChurchId,
        feedId,
        ringMergedRowCount: 0,
      };
    }
  }

  const backendFeedItems = filterOutDeletedScheduleRows(
    Array.isArray(input.backendFeedItems) ? input.backendFeedItems : []
  );
  const homeFeedItems = filterOutDeletedScheduleRows(
    Array.isArray(input.homeFeedItems) ? input.homeFeedItems : []
  );
  const viewerUserId = String(input.viewerUserId || "").trim();
  const cachedGlobalRows = filterOutDeletedScheduleRows(getCachedHomeFeedBackendRows());
  const hasBackendSignal = backendFeedItems.length > 0 || cachedGlobalRows.length > 0;

  const ringMergedRows = filterOutDeletedScheduleRows(
    resolveRingMergedScheduleRows({
      churchBackendRows: backendFeedItems,
      viewerUserId,
      viewerChurchId: targetChurchId || viewerChurchId,
      backendFeedLoaded: hasBackendSignal,
    })
  );

  const localOverlaySource = filterOutDeletedScheduleRows([
    ...homeFeedItems,
    ...(feedList() as any[]),
  ]);
  const overlayRows = overlayLocalScheduleClaimsOnFeedRows(
    ringMergedRows,
    localOverlaySource,
    viewerUserId
  );

  let ringSnapshot = { schedule: null as any | null, feedId: "", slotCount: 0 };
  for (const cid of churchIds) {
    const snap = resolveRingChurchScheduleSnapshot({
      mergedRows: ringMergedRows,
      viewerChurchId: cid,
      nowMs,
    });
    if (snap.schedule && snap.slotCount >= ringSnapshot.slotCount) {
      ringSnapshot = snap;
    }
  }

  const resolveForChurch = (cid: string, strict: boolean) =>
    resolveChurchMediaScheduleFromFeedRows(overlayRows, cid, {
      strictChurch: strict,
      nowMs,
    }) ||
    findMediaScheduleFeedForChurch(overlayRows, cid, {
      strictChurch: strict,
      nowMs,
    }) ||
    findPersistedMediaScheduleFeedForChurch(overlayRows, cid, {
      strictChurch: strict,
      nowMs,
    });

  let schedule: any | null = ringSnapshot.schedule;
  let source: GuestCenterCanonicalResult["source"] = schedule ? "ring-live" : "none";

  if (!schedule) {
    for (const cid of churchIds) {
      schedule = resolveForChurch(cid, true);
      if (schedule) {
        source = hasBackendSignal ? "ring-merged" : "home";
        break;
      }
    }
  }

  if (!schedule) {
    for (const cid of churchIds) {
      schedule = resolveForChurch(cid, false);
      if (schedule) {
        source = "merged-scan";
        break;
      }
    }
  }

  if (!schedule) {
    schedule =
      resolveCanonicalMediaScheduleForGuests(homeFeedItems, backendFeedItems, targetChurchId, nowMs) ||
      resolveCanonicalMediaScheduleForGuests(homeFeedItems, backendFeedItems, viewerChurchId, nowMs);
    if (schedule) source = hasBackendSignal ? "backend" : "home";
  }

  if (!schedule) {
    schedule = findBestGuestCenterScheduleRow(overlayRows, churchIds);
    if (schedule) source = "best-row";
  }

  if (schedule && isMediaScheduleFeedItemClosed(schedule)) {
    schedule = null;
    source = "none";
  }

  let overlayMatch: any | null = null;
  if (schedule) {
    const seed = String(schedule?.sourceScheduleId || schedule?.id || "").trim();
    const canonicalId =
      resolveCanonicalScheduleFeedId(seed, [...overlayRows, ...ringMergedRows, ...localOverlaySource]) ||
      baseFeedId(seed) ||
      seed;

    overlayMatch =
      overlayRows.find((row) => {
        const rowSeed = String(row?.sourceScheduleId || row?.id || "").trim();
        const rowCanon =
          resolveCanonicalScheduleFeedId(rowSeed, overlayRows) || baseFeedId(rowSeed);
        return rowCanon === canonicalId || rowSeed === seed || baseFeedId(rowSeed) === canonicalId;
      }) || null;

    schedule = mergeGuestCenterScheduleSlotSources({
      schedule,
      feedId: seed,
      backendFeedItems,
      overlayMatch,
      ringMergedRows,
    });

    if (source === "ring-live" || source === "ring-merged" || source === "backend" || source === "home" || source === "merged-scan") {
      const backendItem = seed ? findScheduleRow([...backendFeedItems, ...ringMergedRows], seed) : null;
      const backendSlotCount = Array.isArray(backendItem?.scheduleSlots)
        ? backendItem.scheduleSlots.length
        : 0;
      const mergedSlotCount = Array.isArray(schedule?.scheduleSlots)
        ? schedule.scheduleSlots.length
        : 0;
      if (backendSlotCount === 0 && mergedSlotCount > 0) {
        source = "backend-merged";
      }
    }
  }

  const scheduleChurchId = String(schedule?.churchId || schedule?.sourceChurchId || "").trim();
  const feedId = String(schedule?.sourceScheduleId || schedule?.id || "").trim();
  const backendItem = feedId ? findScheduleRow([...backendFeedItems, ...ringMergedRows], feedId) : null;
  const backendSlotCount = Array.isArray(backendItem?.scheduleSlots)
    ? backendItem.scheduleSlots.length
    : 0;
  const mergedSlotCount = Array.isArray(schedule?.scheduleSlots) ? schedule.scheduleSlots.length : 0;

  logRingToGuestCenterBridge({
    ringMergedRowCount: ringMergedRows.length,
    guestMergedRowCount: overlayRows.length,
    ringFeedId: ringSnapshot.feedId,
    guestFeedId: feedId,
    ringSlotCount: ringSnapshot.slotCount,
    guestSlotCount: mergedSlotCount,
  });

  console.log("KRISTO_GUEST_CENTER_CANONICAL_SCHEDULE", {
    feedId: feedId || null,
    source,
    mergedRowCount: ringMergedRows.length,
    backendSlotCount,
    mergedSlotCount,
    backendFeedLoaded: hasBackendSignal,
    hasSchedule: Boolean(schedule),
    ringFeedId: ringSnapshot.feedId || null,
    ringSlotCount: ringSnapshot.slotCount,
  });

  console.log("KRISTO_GUEST_CENTER_CHURCH_SCOPE", {
    viewerChurchId,
    targetChurchId,
    scheduleChurchId,
    churchScopeMatch:
      !scheduleChurchId ||
      scheduleChurchId === targetChurchId ||
      scheduleChurchId === viewerChurchId,
    feedId: feedId || null,
  });

  console.log("KRISTO_GUEST_CENTER_SOURCE", {
    feedId: feedId || null,
    source,
    backendFeedCount: backendFeedItems.length,
    cachedGlobalFeedCount: cachedGlobalRows.length,
    homeFeedCount: homeFeedItems.length,
    mergedRowCount: ringMergedRows.length,
    backendSlotCount,
    mergedSlotCount,
  });

  return {
    schedule,
    source,
    mergedRowCount: ringMergedRows.length,
    backendSlotCount,
    mergedSlotCount,
    scheduleChurchId,
    viewerChurchId,
    targetChurchId,
    feedId,
    ringMergedRowCount: ringMergedRows.length,
  };
}

/** Keep all backend slots visible until explicitly deleted — do not hide by local expiry. */
export function filterGuestCenterDisplaySlots(slots: any[]) {
  return (Array.isArray(slots) ? slots : []).filter((slot) => {
    if (!slot || typeof slot !== "object") return false;
    if (slot.deleted === true || slot.deletedAt) return false;
    const status = String(slot?.status || "").toLowerCase();
    return status !== "deleted" && status !== "removed";
  });
}

export function logGuestCenterSlotFilterResult(input: {
  feedId: string;
  source: string;
  rawSlotCount: number;
  displaySlotCount: number;
  claimedCount: number;
  openCount: number;
  nowMs?: number;
}) {
  console.log("KRISTO_GUEST_CENTER_SLOT_FILTER_RESULT", {
    feedId: input.feedId || null,
    source: input.source,
    rawSlotCount: input.rawSlotCount,
    displaySlotCount: input.displaySlotCount,
    claimedCount: input.claimedCount,
    openCount: input.openCount,
    nowMs: Number(input.nowMs || Date.now()),
    filter: "deleted-only",
  });
}

export function shouldBlockGuestCenterStaleClear(input: {
  churchId: string;
  scheduleId?: string;
  backendSlotCount: number;
  mergedSlotCount?: number;
  rows?: any[];
  nowMs?: number;
  reason?: string;
}): boolean {
  const churchId = String(input.churchId || "").trim();
  const nowMs = Number(input.nowMs || Date.now());
  const mergedSlotCount = Number(input.mergedSlotCount ?? input.backendSlotCount ?? 0);
  const rows = Array.isArray(input.rows) ? input.rows : [];

  if (mergedSlotCount > 0) {
    console.log("KRISTO_GUEST_CENTER_STALE_CLEAR_BLOCKED", {
      reason: input.reason || "merged-slots-present",
      churchId,
      scheduleId: String(input.scheduleId || ""),
      backendSlotCount: input.backendSlotCount,
      mergedSlotCount,
    });
    return true;
  }

  const churchLive = churchId
    ? computeChurchScheduleTabLive({ rows, viewerChurchId: churchId, nowMs })
    : null;
  if (churchLive) {
    console.log("KRISTO_GUEST_CENTER_STALE_CLEAR_BLOCKED", {
      reason: input.reason || "church-ring-live",
      churchId,
      scheduleId: String(input.scheduleId || ""),
      feedId: String(churchLive?.feedId || ""),
      isLiveNow: churchLive.isLiveNow,
    });
    return true;
  }

  return false;
}

export function countExpiredGuestScheduleSlots(slots: any[], nowMs = Date.now()) {
  return slots.filter((slot) => isGuestScheduleSlotExpired(slot, nowMs)).length;
}

export function removeExpiredGuestScheduleSlots(slots: any[], nowMs = Date.now()) {
  const expired = slots.filter((slot) => isGuestScheduleSlotExpired(slot, nowMs));
  const remaining = slots.filter((slot) => !isGuestScheduleSlotExpired(slot, nowMs));
  return { remaining, expired, removedCount: expired.length };
}

function summarizeSlotIdsForSourceLog(slots: any[]) {
  return slots.map((slot, index) =>
    String(slot?.id || slot?.slotId || slot?.slot || slot?.order || `index-${index}`)
  );
}

/** Diagnostics only — compare Guest Claim Center vs DEL OLD slot sources. */
export function logGuestSlotSourceDiagnostics(input: {
  feedId: string;
  source: string;
  slotCount: number;
  guestCenterSlots?: any[];
  delOldSlots?: any[];
  nowMs?: number;
}) {
  const nowMs = Number(input.nowMs || Date.now());
  const guestCenterSlots = Array.isArray(input.guestCenterSlots) ? input.guestCenterSlots : [];
  const delOldSlots = Array.isArray(input.delOldSlots) ? input.delOldSlots : [];
  const guestCenterIds = summarizeSlotIdsForSourceLog(guestCenterSlots);
  const delOldIds = summarizeSlotIdsForSourceLog(delOldSlots);

  console.log("KRISTO_GUEST_SLOT_SOURCE", {
    feedId: input.feedId,
    slotCount: input.slotCount,
    source: input.source,
    nowMs,
    guestCenterSlotCount: guestCenterSlots.length,
    guestCenterSlotIds: guestCenterIds,
  });

  console.log("KRISTO_DEL_OLD_SOURCE", {
    feedId: input.feedId,
    slotCount: input.slotCount,
    source: input.source,
    nowMs,
    delOldSlotCount: delOldSlots.length,
    delOldSlotIds: delOldIds,
    sameSlotIdsAsGuestCenter:
      guestCenterIds.length === delOldIds.length &&
      guestCenterIds.every((id, index) => id === delOldIds[index]),
    sameSlotArrayReference: guestCenterSlots === delOldSlots,
  });
}

/** Diagnostics only — scan slots for DEL OLD expiry vs open counts. */
export function logDelOldScanDiagnostics(
  slots: any[],
  nowMs: number,
  options?: { openSlotCount?: number; context?: string }
) {
  const context = String(options?.context || "del-old").trim();
  const expiredSlots = countExpiredGuestScheduleSlots(slots, nowMs);
  const openSlots =
    typeof options?.openSlotCount === "number"
      ? options.openSlotCount
      : slots.filter((slot) => {
          const status = String(slot?.status || "").toLowerCase().trim();
          const claimedByUserId = String(slot?.claimedByUserId || "").trim();
          return status !== "claimed" && status !== "taken" && !claimedByUserId;
        }).length;

  console.log("KRISTO_DEL_OLD_SCAN", {
    totalSlots: slots.length,
    openSlots,
    expiredSlots,
    nowMs,
    context,
  });

  slots.forEach((slot, index) => {
    const { startMs, endMs } = resolveMediaSlotTimeWindow(slot, nowMs);
    const expired = Number.isFinite(endMs) && endMs > 0 && endMs <= nowMs;

    console.log("KRISTO_DEL_OLD_SLOT", {
      slotId: String(slot?.id || slot?.slotId || slot?.slot || slot?.order || `index-${index}`),
      startMs: startMs || null,
      endMs: endMs || null,
      nowMs,
      expired,
      context,
      index,
      meetingDate: String(slot?.meetingDate || "").trim() || null,
      meetingDay: String(slot?.meetingDay || "").trim() || null,
      startTime: String(slot?.startTime || "").trim() || null,
      endTime: String(slot?.endTime || "").trim() || null,
      startsAt: String(slot?.startsAt || "").trim() || null,
      endsAt: String(slot?.endsAt || "").trim() || null,
      rawStartMs: Number(slot?.startMs || 0) || null,
      rawEndMs: Number(slot?.endMs || 0) || null,
      status: String(slot?.status || "").trim() || null,
      claimedByUserId: String(slot?.claimedByUserId || "").trim() || null,
    });
  });
}

function findScheduleRow(rows: any[], seed: string) {
  const canonicalId = resolveCanonicalScheduleFeedId(seed, rows) || seed;
  return (
    rows.find(
      (item) =>
        String(item?.id || "") === canonicalId ||
        String(item?.id || "") === seed ||
        String(item?.sourceScheduleId || "") === seed
    ) || null
  );
}

/** Prefer backend schedule slots; route/local only before backend loads. */
export function readGuestActionScheduleSlots(input: {
  sourceFeedId: string;
  backendFeedItems: any[];
  homeFeedItems: any[];
}) {
  const seed = String(input.sourceFeedId || "").trim();
  const mergedRows = [...feedList(), ...input.homeFeedItems, ...input.backendFeedItems];
  const feedId = resolveCanonicalScheduleFeedId(seed, mergedRows) || seed;

  if (input.backendFeedItems.length) {
    const backendItem = findScheduleRow(input.backendFeedItems, feedId);
    if (backendItem && Array.isArray(backendItem.scheduleSlots)) {
      if (backendItem.scheduleSlots.length > 0) {
        return {
          feedId,
          slots: backendItem.scheduleSlots,
          sourceUsed: "backend" as const,
        };
      }

      const localSlots = readFeedItemScheduleSlots(feedId, [
        ...(feedList() as any[]),
        ...input.homeFeedItems,
      ]);
      if (localSlots.length > 0) {
        console.log("KRISTO_GUEST_CENTER_SOURCE", {
          feedId,
          source: "backend-local-fallback",
          backendSlotCount: 0,
          mergedSlotCount: localSlots.length,
        });
        return {
          feedId,
          slots: localSlots,
          sourceUsed: "backend-local-fallback" as const,
        };
      }

      return {
        feedId,
        slots: [],
        sourceUsed: "backend" as const,
      };
    }
  }

  const localRows = [...feedList(), ...input.homeFeedItems];
  return {
    feedId,
    slots: readFeedItemScheduleSlots(feedId, localRows),
    sourceUsed: input.backendFeedItems.length ? "backend" : "local",
  };
}

export function buildGuestSlotsSourceSnapshot(input: {
  sourceFeedId?: string;
  backendFeedItems?: any[];
  homeFeedItems?: any[];
  runtimeSlots?: any[];
  nowMs?: number;
}) {
  const nowMs = Number(input.nowMs || Date.now());
  const seed = String(input.sourceFeedId || "").trim();
  const backendItem = seed ? findScheduleRow(input.backendFeedItems || [], seed) : null;
  const routeItem =
    !input.backendFeedItems?.length && seed
      ? findScheduleRow(input.homeFeedItems || [], seed)
      : null;
  const backendSlots = Array.isArray(backendItem?.scheduleSlots) ? backendItem.scheduleSlots : [];
  const routeSlots = Array.isArray(routeItem?.scheduleSlots) ? routeItem.scheduleSlots : [];
  const runtimeSlots = Array.isArray(input.runtimeSlots) ? input.runtimeSlots : [];
  const authoritativeSlots = backendSlots.length
    ? backendSlots
    : routeSlots.length
      ? routeSlots
      : runtimeSlots;

  return {
    sourceFeedId: seed || null,
    routeSlotCount: routeSlots.length,
    backendSlotCount: backendSlots.length,
    runtimeSlotCount: runtimeSlots.length,
    deletedCount: runtimeSlots.filter((slot) => slot?.deleted === true).length,
    oldCount: countExpiredGuestScheduleSlots(authoritativeSlots, nowMs),
    localSlotCount: authoritativeSlots.length,
  };
}

function slotStillClaimed(slot: any) {
  const userId = String(
    slot?.claimedByUserId ||
      (typeof slot?.claimedBy === "object" && slot?.claimedBy ? slot.claimedBy.userId : "") ||
      ""
  ).trim();
  return Boolean(userId);
}

export function logGuestAfterReloadVerify(input: {
  selectedSlotId: string;
  feedId: string;
  backendFeedItems: any[];
  runtimeSlots: any[];
  nowMs?: number;
  sourceUsed: "backend" | "routes" | "local";
}) {
  const nowMs = Number(input.nowMs || Date.now());
  const seed = String(input.feedId || "").trim();
  const backendItem = findScheduleRow(input.backendFeedItems, seed);
  const backendSlots = Array.isArray(backendItem?.scheduleSlots) ? backendItem.scheduleSlots : [];
  const resolvedSlotId = resolveGuestActionSlotId(backendSlots.length ? backendSlots : input.runtimeSlots, input.selectedSlotId);
  const backendSlot =
    backendSlots.find((slot: any) => slotIdsMatch(slot, resolvedSlotId) || slotIdsMatch(slot, input.selectedSlotId)) ||
    null;
  const runtimeSlot =
    input.runtimeSlots.find((slot: any) => String(slot?.id || "") === String(input.selectedSlotId)) || null;
  const verifySlot = backendSlot || runtimeSlot;
  const authoritativeSlots = backendSlots.length ? backendSlots : input.runtimeSlots;
  const payload = {
    selectedSlotId: input.selectedSlotId,
    resolvedSlotId,
    feedId: seed,
    backendSlotCount: backendSlots.length,
    runtimeSlotCount: input.runtimeSlots.length,
    stillClaimed: verifySlot ? slotStillClaimed(verifySlot) : false,
    oldCount: countExpiredGuestScheduleSlots(authoritativeSlots, nowMs),
    sourceUsed: input.sourceUsed,
  };

  console.log("KRISTO_GUEST_AFTER_RELOAD_VERIFY", payload);
  return payload;
}

export async function forceReloadGuestScheduleFromBackend(input: {
  churchId: string;
  headers: Record<string, string>;
  userId?: string;
  setBackendFeedItems: (items: any[]) => void;
  setHomeFeedItems: (items: any[]) => void;
  setGuestClaimSlots?: (slots: any[]) => void;
}) {
  const churchId = String(input.churchId || "").trim();
  const sync = await fetchMediaScheduleFeedSync(churchId, input.headers);
  const rows = (Array.isArray(sync.rows) ? sync.rows : []).filter(
    (row) => !isChurchLiveControlScheduleFeedRow(row)
  );

  applyBackendMediaScheduleToLocalFeed(rows, churchId);
  input.setBackendFeedItems(rows);
  input.setHomeFeedItems([...feedList()]);

  const backendSchedule =
    findMediaScheduleFeedForChurch(rows, churchId, { strictChurch: true }) ||
    findActiveMediaScheduleForChurch(rows, churchId, { strictChurch: true });

  const canonical = resolveGuestCenterCanonicalSchedule({
    homeFeedItems: [...feedList()],
    backendFeedItems: rows,
    churchId,
  });
  if (canonical.mergedSlotCount > 0 && Array.isArray(canonical.schedule?.scheduleSlots)) {
    input.setGuestClaimSlots?.(canonical.schedule.scheduleSlots);
  } else {
    input.setGuestClaimSlots?.([]);
  }

  return {
    rows,
    backendSchedule: canonical.schedule || backendSchedule,
    feedId: String(
      canonical.feedId ||
        backendSchedule?.id ||
        backendSchedule?.sourceScheduleId ||
        ""
    ).trim(),
    backendSlots: Array.isArray(canonical.schedule?.scheduleSlots)
      ? canonical.schedule.scheduleSlots
      : Array.isArray(backendSchedule?.scheduleSlots)
        ? backendSchedule.scheduleSlots
        : [],
    sourceUsed: rows.length ? ("backend" as const) : ("local" as const),
  };
}

function countLiveSlotsForRows(rows: any[], churchId: string, userId: string, nowMs = Date.now()) {
  const catalog = buildLiveSlotsCatalogFromFeedRows(rows, churchId, userId, nowMs);
  return catalog.myChurch.length + catalog.otherChurches.length;
}

function endLiveBridgeForSchedule(scheduleId: string, rows: any[]) {
  const merged = [...rows, ...(feedList() as any[])];
  const canonicalId = resolveCanonicalScheduleFeedId(scheduleId, merged) || scheduleId;
  const aliases = collectScheduleAliasIds(canonicalId, merged);
  const liveIds = new Set(
    aliases.map((id) => baseFeedId(id)).filter(Boolean)
  );
  liveIds.add(baseFeedId(canonicalId));
  for (const liveId of liveIds) {
    publishLiveEnded(liveId);
  }
}

function filterBackendRowsWithoutDeletedSchedule(rows: any[], feedId: string) {
  const merged = [...(Array.isArray(rows) ? rows : []), ...(feedList() as any[])];
  const aliases = new Set(
    collectScheduleAliasIds(feedId, merged).flatMap((id) => [id, baseFeedId(id)].filter(Boolean))
  );
  return (Array.isArray(rows) ? rows : []).filter((row) => {
    if (!isMediaScheduleFeedItem(row)) return true;
    if (scheduleFeedRowIsDeleted(row)) return false;
    const rowId = String(row?.id || "").trim();
    const sourceId = String(row?.sourceScheduleId || "").trim();
    return !aliases.has(rowId) && !aliases.has(sourceId) && !aliases.has(baseFeedId(rowId));
  });
}

export async function purgeDeletedScheduleFromAllSources(input: {
  feedId: string;
  churchId: string;
  userId?: string;
  reason: string;
  backendRows?: any[];
  setBackendFeedItems?: (items: any[]) => void;
  setHomeFeedItems?: (items: any[]) => void;
  setGuestClaimSlots?: (slots: any[]) => void;
}) {
  const feedId = String(input.feedId || "").trim();
  const churchId = String(input.churchId || "").trim();
  const userId = String(input.userId || "").trim();
  const merged = [...(input.backendRows || []), ...(feedList() as any[])];
  const aliases = collectScheduleAliasIds(feedId, merged);

  console.log("KRISTO_SCHEDULE_DELETE_GLOBAL_PURGE_START", {
    feedId,
    churchId,
    reason: input.reason,
    aliases,
  });

  markScheduleFeedDeleted(feedId, merged);

  feedRemoveScheduleMirrors(feedId);
  feedRemoveWhere((row) => {
    if (scheduleFeedRowIsDeleted(row)) return true;
    if (!isMediaScheduleFeedItem(row)) return false;
    const rowId = String(row?.id || "").trim();
    const sourceId = String((row as any)?.sourceScheduleId || "").trim();
    const aliasSet = new Set(aliases.flatMap((id) => [id, baseFeedId(id)].filter(Boolean)));
    return (
      aliasSet.has(rowId) ||
      aliasSet.has(sourceId) ||
      aliasSet.has(baseFeedId(rowId)) ||
      aliasSet.has(baseFeedId(sourceId))
    );
  });

  clearScheduleClaimRuntimeState(feedId, input.backendRows);
  endLiveBridgeForSchedule(feedId, merged);
  feedPurgeMediaScheduleCards();
  if (churchId) feedPurgeMediaScheduleCardsForChurch(churchId);

  for (const alias of aliases) {
    await purgeHomeFeedPostFromBackendCache(alias);
    publishLiveEnded(alias);
  }

  resetMediaScheduleSilentReloadCache();
  if (churchId) clearMediaScheduleCachesForChurch(churchId, input.reason);
  clearHomeFeedApiCache(userId);

  purgeAllLocalMediaScheduleSources({
    churchId,
    reason: input.reason,
    removePending: true,
    ui: {
      setGuestClaimSlots: input.setGuestClaimSlots,
      setBackendFeedItems: input.setBackendFeedItems,
      setHomeFeedItems: input.setHomeFeedItems,
    },
  });

  const filteredBackendRows = filterBackendRowsWithoutDeletedSchedule(
    filterOutDeletedScheduleRows(input.backendRows || []),
    feedId
  );

  input.setGuestClaimSlots?.([]);
  input.setBackendFeedItems?.(filteredBackendRows);
  input.setHomeFeedItems?.([...feedList()]);

  try {
    await mergeCachedHomeFeedBackendRows(filteredBackendRows);
  } catch {
    // ignore cache reconcile errors
  }

  emitSlotClaimChanged({
    churchId,
    postId: feedId,
    slotId: "",
    action: "unclaim",
    userId,
    source: "schedule-delete-global-purge",
  });
  emitClaimUpdated({
    postId: feedId,
    feedId,
    baseFeedId: baseFeedId(feedId),
    slotId: "",
    userId,
    action: "unclaim",
  });
  emitLiveRingRefresh("schedule-delete-global-purge");
  emitScheduleFeedDeleted({
    feedId,
    churchId,
    aliases,
    reason: input.reason,
  });

  const ringRows = resolveRingMergedScheduleRows({
    churchBackendRows: filteredBackendRows,
    viewerUserId: userId,
    viewerChurchId: churchId,
    backendFeedLoaded: filteredBackendRows.length > 0,
  });
  const guestCanonical = resolveGuestCenterCanonicalSchedule({
    homeFeedItems: [...feedList()],
    backendFeedItems: filteredBackendRows,
    churchId,
    targetChurchId: churchId,
    viewerUserId: userId,
  });
  const liveSlotsResolved = resolveLiveSlotsBackendFeedRows({
    churchBackendRows: filteredBackendRows,
    globalBackendRows: filterOutDeletedScheduleRows(getCachedHomeFeedBackendRows()),
    viewerChurchId: churchId,
    viewerUserId: userId,
    localRows: filterOutDeletedScheduleRows([...(feedList() as any[])]),
    churchFeedLoaded: filteredBackendRows.length > 0,
  });
  const liveSlots = buildLiveSlotsCatalogFromFeedRows(
    liveSlotsResolved.rows,
    churchId,
    userId,
    Date.now()
  );

  console.log("KRISTO_SCHEDULE_DELETE_REMOVED_FROM_RING", {
    feedId,
    churchId,
    ringMergedRowCount: ringRows.length,
    aliases,
  });
  console.log("KRISTO_SCHEDULE_DELETE_REMOVED_FROM_GUEST_CENTER", {
    feedId,
    churchId,
    mergedSlotCount: guestCanonical.mergedSlotCount,
    hasSchedule: Boolean(guestCanonical.schedule),
  });
  console.log("KRISTO_SCHEDULE_DELETE_REMOVED_FROM_LIVE_SLOTS", {
    feedId,
    churchId,
    myChurchCount: liveSlots.myChurch.length,
    otherChurchesCount: liveSlots.otherChurches.length,
  });
  console.log("KRISTO_SCHEDULE_DELETE_GLOBAL_PURGE_RESULT", {
    feedId,
    churchId,
    ok: true,
    aliasCount: aliases.length,
    backendRowsRemaining: filteredBackendRows.length,
    ringMergedRowCount: ringRows.length,
    guestMergedSlotCount: guestCanonical.mergedSlotCount,
    liveSlotsMyChurchCount: liveSlots.myChurch.length,
  });

  return {
    ok: true,
    feedId,
    aliases,
    filteredBackendRows,
    ringMergedRowCount: ringRows.length,
    guestMergedSlotCount: guestCanonical.mergedSlotCount,
    liveSlotsMyChurchCount: liveSlots.myChurch.length,
  };
}

function scheduleHasActiveOrUpcomingSlots(slots: any[], nowMs = Date.now()) {
  return slots.some((slot) => {
    const { endMs } = resolveMediaSlotTimeWindow(slot, nowMs);
    return Number.isFinite(endMs) && endMs > nowMs;
  });
}

export async function invalidateGuestClaimGlobalLiveState(input: {
  churchId: string;
  userId: string;
  scheduleId: string;
  headers: Record<string, string>;
  reloadRows: any[];
  backendSlotCount: number;
  reason: string;
  slotId?: string;
  nowMs?: number;
  setBackendFeedItems?: (items: any[]) => void;
  setHomeFeedItems?: (items: any[]) => void;
  setGuestClaimSlots?: (slots: any[]) => void;
}) {
  const churchId = String(input.churchId || "").trim();
  const userId = String(input.userId || "").trim();
  const scheduleId = String(input.scheduleId || "").trim();
  const nowMs = Number(input.nowMs || Date.now());
  let reloadRows = Array.isArray(input.reloadRows) ? input.reloadRows : [];

  const ringBefore = recomputeScheduleRingsFromRows({
    rows: mergeFeedRowsForScheduleScan(getCachedHomeFeedBackendRows(), {
      backendFeedLoaded: getCachedHomeFeedBackendRows().length > 0,
      churchId,
    }),
    viewerUserId: userId,
    viewerChurchId: churchId,
    nowMs,
    source: "guest-invalidate-before",
    backendFeedLoaded: getCachedHomeFeedBackendRows().length > 0,
  });

  console.log("KRISTO_GUEST_GLOBAL_INVALIDATE_START", {
    scheduleId,
    churchId,
    reason: input.reason,
    backendSlotCount: input.backendSlotCount,
    runtimeSlotCount: input.backendSlotCount,
    reloadRowCount: reloadRows.length,
  });

  resetMediaScheduleSilentReloadCache();
  if (churchId) {
    clearMediaScheduleCachesForChurch(churchId, input.reason);
  }

  clearScheduleClaimRuntimeState(scheduleId, reloadRows);

  let backendSchedule =
    findMediaScheduleFeedForChurch(reloadRows, churchId, { strictChurch: true }) ||
    findActiveMediaScheduleForChurch(reloadRows, churchId, { strictChurch: true });
  let backendSlots = Array.isArray(backendSchedule?.scheduleSlots) ? backendSchedule.scheduleSlots : [];
  let backendSlotCount = backendSlots.length;
  let backendActiveSlotCount = backendSchedule
    ? getActiveScheduleSlots(backendSchedule, nowMs).length
    : 0;

  const mergedCanonical = resolveGuestCenterCanonicalSchedule({
    homeFeedItems: [...(feedList() as any[])],
    backendFeedItems: reloadRows,
    churchId,
    viewerUserId: userId,
    nowMs,
  });
  const mergedSlotCount = mergedCanonical.mergedSlotCount;

  const blockStaleClear = shouldBlockGuestCenterStaleClear({
    churchId,
    scheduleId,
    backendSlotCount,
    mergedSlotCount,
    rows: ringBefore.rows,
    nowMs,
    reason: input.reason,
  });

  if (
    scheduleId &&
    shouldEndStaleMediaScheduleFeedRow({
      remainingSlotCount: backendSlotCount,
      activeSlotCount: backendActiveSlotCount,
    }) &&
    !blockStaleClear
  ) {
    const mergedForAliases = [...reloadRows, ...(feedList() as any[])];
    const aliases = collectScheduleAliasIds(scheduleId, mergedForAliases);
    const localScheduleId =
      aliases.find((id) => isLocalMediaScheduleId(id)) ||
      aliases.find((id) => id.startsWith("media-schedule-")) ||
      "";

    if (isBackendFeedScheduleId(scheduleId) || String(scheduleId).startsWith("feed_")) {
      await cleanupStaleMediaSchedulePair({
        feedId: scheduleId,
        localScheduleId: localScheduleId || undefined,
        churchId,
        headers: input.headers,
        reason: `${input.reason}-stale-feed-cleanup`,
      });
    } else {
      await cleanupStaleMediaScheduleFeedRow({
        feedId: scheduleId,
        churchId,
        headers: input.headers,
        reason: `${input.reason}-stale-feed-cleanup`,
      });
    }

    const resync = await fetchMediaScheduleFeedSync(churchId, input.headers);
    reloadRows = Array.isArray(resync.rows) ? resync.rows : reloadRows;
    applyBackendMediaScheduleToLocalFeed(reloadRows, churchId);
    input.setBackendFeedItems?.(reloadRows);
    input.setHomeFeedItems?.([...feedList()]);
    input.setGuestClaimSlots?.([]);

    backendSchedule =
      findMediaScheduleFeedForChurch(reloadRows, churchId, { strictChurch: true }) ||
      findActiveMediaScheduleForChurch(reloadRows, churchId, { strictChurch: true });
    backendSlots = Array.isArray(backendSchedule?.scheduleSlots) ? backendSchedule.scheduleSlots : [];
    backendSlotCount = backendSlots.length;
    backendActiveSlotCount = backendSchedule
      ? getActiveScheduleSlots(backendSchedule, nowMs).length
      : 0;
  }

  if ((!backendSchedule || backendSlotCount === 0) && !blockStaleClear) {
    purgeAllLocalMediaScheduleSources({
      churchId,
      reason: input.reason,
      ui: {
        setGuestClaimSlots: input.setGuestClaimSlots,
        setBackendFeedItems: input.setBackendFeedItems,
        setHomeFeedItems: input.setHomeFeedItems,
      },
    });
    endLiveBridgeForSchedule(scheduleId, reloadRows);
  } else if (backendSchedule || mergedSlotCount > 0) {
    const canonicalSchedule = mergedCanonical.schedule || backendSchedule;
    applyBackendMediaScheduleToLocalFeed(reloadRows, churchId);
    input.setBackendFeedItems?.(reloadRows);
    input.setHomeFeedItems?.([...feedList()]);
    input.setGuestClaimSlots?.(
      Array.isArray(canonicalSchedule?.scheduleSlots) ? canonicalSchedule.scheduleSlots : []
    );

    clearStaleMediaScheduleSpeakerSlotsForChurch({
      churchId,
      reason: input.reason,
    });

    const churchLive = computeChurchScheduleTabLive({
      rows: reloadRows,
      viewerChurchId: churchId,
      nowMs,
    });
    if (!churchLive || !scheduleHasActiveOrUpcomingSlots(backendSlots, nowMs)) {
      endLiveBridgeForSchedule(scheduleId, reloadRows);
    }
  }

  try {
    await mergeCachedHomeFeedBackendRows(reloadRows);
  } catch {
    // ignore cache reconcile errors
  }

  try {
    await fetchHomeFeedFromApi("guest-claim-delete", { force: true, reconcile: true });
  } catch {
    // ignore home feed refresh errors
  }

  emitSlotClaimChanged({
    churchId,
    postId: scheduleId,
    slotId: String(input.slotId || ""),
    action: "unclaim",
    userId,
    source: "guest-claim-global-invalidate",
  });
  emitClaimUpdated({
    postId: scheduleId,
    feedId: scheduleId,
    baseFeedId: baseFeedId(scheduleId),
    slotId: String(input.slotId || ""),
    userId,
    action: "unclaim",
  });
  emitLiveRingRefresh("guest-claim-delete");

  let activeLiveClear: Awaited<ReturnType<typeof clearActiveLiveAfterGuestSlotDelete>> | null = null;
  if (
    shouldClearActiveLiveAfterGuestDelete({
      backendSlotCount,
      reloadRows,
      churchId,
      nowMs,
    })
  ) {
    activeLiveClear = await clearActiveLiveAfterGuestSlotDelete({
      churchId,
      scheduleId,
      headers: input.headers,
      backendSlotCount,
      reloadRows,
      reason: input.reason,
    });
    emitLiveRingRefresh("guest-delete-cleared-live");
  }

  const homeFeedRows = mergeFeedRowsForScheduleScan(getCachedHomeFeedBackendRows(), {
    backendFeedLoaded: getCachedHomeFeedBackendRows().length > 0,
    churchId,
  });
  const ringAfter = recomputeScheduleRingsFromRows({
    rows: homeFeedRows,
    viewerUserId: userId,
    viewerChurchId: churchId,
    nowMs,
    source: "guest-invalidate-after",
    backendFeedLoaded: getCachedHomeFeedBackendRows().length > 0,
  });
  const liveSlotsCount = countLiveSlotsForRows(homeFeedRows, churchId, userId, nowMs);
  const homeFeedLiveCount = homeFeedRows.filter((row) => {
    const slots = Array.isArray(row?.scheduleSlots) ? row.scheduleSlots : [];
    return slots.some((slot: any) => {
      const { endMs } = resolveMediaSlotTimeWindow(slot, nowMs);
      return endMs > nowMs;
    });
  }).length;

  console.log("KRISTO_LIVE_RING_REFRESH_AFTER_GUEST_DELETE", {
    scheduleId,
    backendSlotCount,
    runtimeSlotCount: backendSlotCount,
    liveRingActiveBefore: Boolean(ringBefore.church),
    liveRingActiveAfter: Boolean(ringAfter.church),
    homeFeedLiveCount,
    liveSlotsCount,
  });

  console.log("KRISTO_GUEST_GLOBAL_INVALIDATE_DONE", {
    scheduleId,
    backendSlotCount,
    runtimeSlotCount: backendSlotCount,
    liveRingActiveBefore: Boolean(ringBefore.church),
    liveRingActiveAfter: Boolean(ringAfter.church),
    homeFeedLiveCount,
    liveSlotsCount,
    reason: input.reason,
  });

  return {
    backendSlotCount,
    backendActiveSlotCount,
    liveRingActiveBefore: Boolean(ringBefore.church),
    liveRingActiveAfter: Boolean(ringAfter.church),
    homeFeedLiveCount,
    liveSlotsCount,
    activeLiveClear,
  };
}

export async function persistGuestSlotClaimClear(input: {
  sourceFeedId: string;
  slotId: string;
  action: "reject" | "remove";
  backendFeedItems: any[];
  homeFeedItems: any[];
  headers: Record<string, string>;
  churchId: string;
  nowMs?: number;
  userId?: string;
  setBackendFeedItems: (items: any[]) => void;
  setHomeFeedItems: (items: any[]) => void;
  setGuestClaimSlots?: (slots: any[]) => void;
  guestCenterSource?: GuestCenterCanonicalResult["source"];
} & GuestCenterRoomMutationUi) {
  const action = input.action;
  const startLog = action === "reject" ? "KRISTO_GUEST_REJECT_START" : "KRISTO_GUEST_DELETE_START";
  const payloadLog = action === "reject" ? "KRISTO_GUEST_REJECT_PAYLOAD" : "KRISTO_GUEST_DELETE_PAYLOAD";
  const resultLog = action === "reject" ? "KRISTO_GUEST_REJECT_RESULT" : "KRISTO_GUEST_DELETE_RESULT";

  const roomCanonical = input.churchLiveControlRoomSchedule
    ? resolveGuestCenterCanonicalSchedule({
        homeFeedItems: input.homeFeedItems,
        backendFeedItems: input.backendFeedItems,
        churchId: input.churchId,
        targetChurchId: input.churchId,
        viewerUserId: input.userId,
        nowMs: input.nowMs,
        churchLiveControlRoomSchedule: input.churchLiveControlRoomSchedule,
      })
    : null;
  const roomSource =
    isGuestCenterChurchLiveControlRoomSource(String(input.guestCenterSource || "")) ||
    isGuestCenterChurchLiveControlRoomSource(String(roomCanonical?.source || ""));

  if (roomSource && input.churchLiveControlRoomSchedule) {
    const beforeSlots = filterGuestCenterDisplaySlots(
      Array.isArray(input.churchLiveControlRoomSchedule?.scheduleSlots)
        ? input.churchLiveControlRoomSchedule.scheduleSlots
        : []
    );
    const feedId = String(
      input.churchLiveControlRoomSchedule?.sourceScheduleId ||
        input.churchLiveControlRoomSchedule?.id ||
        input.sourceFeedId ||
        ""
    ).trim();
    const resolvedSlotId = resolveGuestActionSlotId(beforeSlots, input.slotId);
    const targetSlot = beforeSlots.find(
      (slot: any, index: number) =>
        slotIdsMatch(slot, resolvedSlotId) ||
        slotIdsMatch(slot, input.slotId) ||
        String(slot?.id || "") === String(input.slotId) ||
        (String(input.slotId).match(/^synced-slot-(\d+)$/i) &&
          Number(String(input.slotId).match(/^synced-slot-(\d+)$/i)?.[1]) === index)
    );

    console.log(startLog, {
      action,
      sourceFeedId: input.sourceFeedId,
      feedId,
      slotId: input.slotId,
      resolvedSlotId,
      slotCount: beforeSlots.length,
      sourceUsed: "church-live-control-room",
    });

    if (!targetSlot) {
      return {
        feedId,
        resolvedSlotId,
        ok: false,
        error: "slot-not-found",
      };
    }

    if (action === "remove") {
      const mutation = await mutateChurchLiveControlGuestCenterRoomSchedule({
        action: "remove",
        headers: input.headers,
        churchId: input.churchId,
        userId: input.userId,
        slotsToDelete: [targetSlot],
        reloadOpts: input.reloadChurchLiveControlOpts,
      });

      console.log(resultLog, {
        action,
        feedId,
        slotId: input.slotId,
        resolvedSlotId,
        ok: mutation.ok,
        error: mutation.error,
        affectedMessageIds: mutation.affectedMessageIds,
      });

      if (!mutation.ok) {
        return {
          feedId,
          resolvedSlotId,
          ok: false,
          error: mutation.error || "room-remove-failed",
          removedCount: 0,
        };
      }

      input.setChurchLiveControlRoomSchedule?.(mutation.schedule);
      input.setGuestClaimSlots?.(
        Array.isArray(mutation.schedule?.scheduleSlots) ? mutation.schedule.scheduleSlots : []
      );

      return {
        feedId,
        resolvedSlotId,
        ok: true,
        error: null,
        removedCount: 1,
        schedule: mutation.schedule,
      };
    }

    const clearedSlot = clearGuestSlotClaimFields(targetSlot);
    console.log(payloadLog, {
      action,
      feedId,
      slotId: input.slotId,
      resolvedSlotId,
      sourceUsed: "church-live-control-room",
      before: beforeSlots.map((slot: any, index: number) => summarizeGuestClaimSlotForLog(slot, index)),
      after: beforeSlots.map((slot: any, index: number) =>
        slotIdsMatch(slot, resolvedSlotId) || slotIdsMatch(slot, input.slotId)
          ? summarizeGuestClaimSlotForLog(clearedSlot, index)
          : summarizeGuestClaimSlotForLog(slot, index)
      ),
    });

    const mutation = await mutateChurchLiveControlGuestCenterRoomSchedule({
      action: "reject",
      headers: input.headers,
      churchId: input.churchId,
      userId: input.userId,
      slotsToPatch: [clearedSlot],
      reloadOpts: input.reloadChurchLiveControlOpts,
    });

    console.log(resultLog, {
      action,
      feedId,
      slotId: input.slotId,
      resolvedSlotId,
      ok: mutation.ok,
      error: mutation.error,
      affectedMessageIds: mutation.affectedMessageIds,
    });

    if (!mutation.ok) {
      return {
        feedId,
        resolvedSlotId,
        ok: false,
        error: mutation.error || "room-reject-failed",
      };
    }

    input.setChurchLiveControlRoomSchedule?.(mutation.schedule);
    input.setGuestClaimSlots?.(
      Array.isArray(mutation.schedule?.scheduleSlots) ? mutation.schedule.scheduleSlots : []
    );

    return {
      feedId,
      resolvedSlotId,
      ok: true,
      error: null,
      schedule: mutation.schedule,
    };
  }

  const { feedId, slots: beforeSlots, sourceUsed } = readGuestActionScheduleSlots({
    sourceFeedId: input.sourceFeedId,
    backendFeedItems: input.backendFeedItems,
    homeFeedItems: input.homeFeedItems,
  });
  const resolvedSlotId = resolveGuestActionSlotId(beforeSlots, input.slotId);

  console.log(startLog, {
    action,
    sourceFeedId: input.sourceFeedId,
    feedId,
    slotId: input.slotId,
    resolvedSlotId,
    slotCount: beforeSlots.length,
    sourceUsed,
  });

  if (action === "remove") {
    return persistRemoveGuestScheduleSlotRecord({
      ...input,
      feedId,
      beforeSlots,
      resolvedSlotId,
      sourceUsed: sourceUsed as "backend" | "local",
    });
  }

  const clearedSlots = beforeSlots.map((slot: any, index: number) => {
    if (
      slotIdsMatch(slot, resolvedSlotId) ||
      slotIdsMatch(slot, input.slotId) ||
      String(slot?.id || "") === String(input.slotId)
    ) {
      return clearGuestSlotClaimFields(slot);
    }

    const syncedIndexMatch = String(input.slotId).match(/^synced-slot-(\d+)$/i);
    if (syncedIndexMatch && Number(syncedIndexMatch[1]) === index) {
      return clearGuestSlotClaimFields(slot);
    }

    return slot;
  });

  console.log(payloadLog, {
    action,
    feedId,
    slotId: input.slotId,
    resolvedSlotId,
    sourceUsed,
    before: beforeSlots.map((slot: any, index: number) => summarizeGuestClaimSlotForLog(slot, index)),
    after: clearedSlots.map((slot: any, index: number) => summarizeGuestClaimSlotForLog(slot, index)),
  });

  let unclaimOk = false;
  let syncOk = false;
  let error: string | null = null;

  try {
    const unclaimRes: any = await apiPost(
      "/api/church/feed",
      {
        action: "unclaim_schedule_slot",
        postId: feedId,
        feedId,
        slotId: resolvedSlotId,
      },
      { headers: input.headers as any }
    );
    unclaimOk = unclaimRes?.ok !== false && !unclaimRes?.error;
    if (!unclaimOk && unclaimRes?.error) {
      error = String(unclaimRes.error);
    }
  } catch (e: any) {
    error = String(e?.message || e);
  }

  if (!unclaimOk) {
    try {
      const syncRes: any = await syncMediaScheduleSlotsToBackend(feedId, clearedSlots, input.headers);
      syncOk = syncRes?.ok !== false && !syncRes?.error;
      if (!syncOk && syncRes?.error) {
        error = String(syncRes.error);
      }
    } catch (e: any) {
      error = String(e?.message || e);
    }
  }

  const ok = unclaimOk || syncOk;

  console.log(resultLog, {
    action,
    feedId,
    slotId: input.slotId,
    resolvedSlotId,
    unclaimOk,
    syncOk,
    ok,
    error,
  });

  if (!ok) {
    return {
      feedId,
      resolvedSlotId,
      clearedSlots,
      unclaimOk,
      syncOk,
      ok: false,
      error,
      verify: null,
    };
  }

  const reload = await forceReloadGuestScheduleFromBackend({
    churchId: input.churchId,
    headers: input.headers,
    setBackendFeedItems: input.setBackendFeedItems,
    setHomeFeedItems: input.setHomeFeedItems,
    setGuestClaimSlots: input.setGuestClaimSlots,
  });

  const verify = logGuestAfterReloadVerify({
    selectedSlotId: input.slotId,
    feedId: reload.feedId || feedId,
    backendFeedItems: reload.rows,
    runtimeSlots: reload.backendSlots,
    nowMs: input.nowMs,
    sourceUsed: reload.sourceUsed,
  });

  const invalidate = await invalidateGuestClaimGlobalLiveState({
    churchId: input.churchId,
    userId: String(input.userId || input.headers?.["x-kristo-user-id"] || ""),
    scheduleId: reload.feedId || feedId,
    headers: input.headers,
    reloadRows: reload.rows,
    backendSlotCount: reload.backendSlots.length,
    reason: action === "reject" ? "reject-guest" : "remove-guest",
    slotId: input.slotId,
    nowMs: input.nowMs,
    setBackendFeedItems: input.setBackendFeedItems,
    setHomeFeedItems: input.setHomeFeedItems,
    setGuestClaimSlots: input.setGuestClaimSlots,
  });

  return {
    feedId,
    resolvedSlotId,
    clearedSlots,
    unclaimOk,
    syncOk,
    ok: true,
    error: null,
    verify,
    reload,
    invalidate,
  };
}

async function persistRemoveGuestScheduleSlotRecord(input: {
  sourceFeedId: string;
  slotId: string;
  feedId: string;
  beforeSlots: any[];
  resolvedSlotId: string;
  sourceUsed: "backend" | "local";
  backendFeedItems: any[];
  homeFeedItems: any[];
  headers: Record<string, string>;
  churchId: string;
  nowMs?: number;
  userId?: string;
  setBackendFeedItems: (items: any[]) => void;
  setHomeFeedItems: (items: any[]) => void;
  setGuestClaimSlots?: (slots: any[]) => void;
}) {
  const { remaining, removed, removedCount } = removeGuestScheduleSlotById(
    input.beforeSlots,
    input.slotId
  );

  console.log("KRISTO_GUEST_SLOT_DELETE_START", {
    feedId: input.feedId,
    slotId: input.slotId,
    resolvedSlotId: input.resolvedSlotId,
    sourceUsed: input.sourceUsed,
    beforeCount: input.beforeSlots.length,
    removedCount,
    remainingCount: remaining.length,
  });

  if (removedCount <= 0) {
    return {
      feedId: input.feedId,
      resolvedSlotId: input.resolvedSlotId,
      ok: false,
      error: "slot-not-found",
      removedCount: 0,
    };
  }

  const removedSlot = removed[0];
  let unclaimOk = false;
  let syncOk = false;
  let error: string | null = null;

  if (guestScheduleSlotHasClaimant(removedSlot)) {
    try {
      const unclaimRes: any = await apiPost(
        "/api/church/feed",
        {
          action: "unclaim_schedule_slot",
          postId: input.feedId,
          feedId: input.feedId,
          slotId: input.resolvedSlotId,
        },
        { headers: input.headers as any }
      );
      unclaimOk = unclaimRes?.ok !== false && !unclaimRes?.error;
    } catch (e: any) {
      error = String(e?.message || e);
    }
  }

  try {
    const clearRes = await clearMediaScheduleSlotsOnBackend({
      feedId: input.feedId,
      churchId: input.churchId,
      headers: input.headers,
      slots: remaining,
      reason: "remove-guest-slot-record",
    });
    syncOk = clearRes.ok;
    if (!syncOk && clearRes.error) {
      error = String(clearRes.error);
    }
  } catch (e: any) {
    error = String(e?.message || e);
  }

  const ok = syncOk;

  console.log("KRISTO_GUEST_SLOT_DELETE_RESULT", {
    feedId: input.feedId,
    slotId: input.slotId,
    resolvedSlotId: input.resolvedSlotId,
    unclaimOk,
    syncOk,
    ok,
    error,
    removedCount,
    remainingCount: remaining.length,
  });

  if (!ok) {
    return {
      feedId: input.feedId,
      resolvedSlotId: input.resolvedSlotId,
      ok: false,
      error: error || "slot-delete-failed",
      removedCount: 0,
    };
  }

  const reload = await forceReloadGuestScheduleFromBackend({
    churchId: input.churchId,
    headers: input.headers,
    setBackendFeedItems: input.setBackendFeedItems,
    setHomeFeedItems: input.setHomeFeedItems,
    setGuestClaimSlots: input.setGuestClaimSlots,
  });

  const verify = logGuestAfterReloadVerify({
    selectedSlotId: input.slotId,
    feedId: reload.feedId || input.feedId,
    backendFeedItems: reload.rows,
    runtimeSlots: reload.backendSlots,
    nowMs: input.nowMs,
    sourceUsed: reload.sourceUsed,
  });

  const invalidate = await invalidateGuestClaimGlobalLiveState({
    churchId: input.churchId,
    userId: String(input.userId || input.headers?.["x-kristo-user-id"] || ""),
    scheduleId: reload.feedId || input.feedId,
    headers: input.headers,
    reloadRows: reload.rows,
    backendSlotCount: reload.backendSlots.length,
    reason: "remove-guest-slot-record",
    slotId: input.slotId,
    nowMs: input.nowMs,
    setBackendFeedItems: input.setBackendFeedItems,
    setHomeFeedItems: input.setHomeFeedItems,
    setGuestClaimSlots: input.setGuestClaimSlots,
  });

  return {
    feedId: input.feedId,
    resolvedSlotId: input.resolvedSlotId,
    ok: true,
    error: null,
    removedCount,
    verify,
    reload,
    invalidate,
  };
}

export function guestScheduleSlotHasClaimant(slot: any): boolean {
  const status = String(slot?.status || "").toLowerCase().trim();
  if (status === "claimed" || status === "taken") return true;

  const claimedByUserId = String(
    slot?.claimedByUserId ||
      (typeof slot?.claimedBy === "object" && slot?.claimedBy ? slot.claimedBy.userId : "") ||
      ""
  ).trim();
  if (claimedByUserId) return true;

  const claimedBy = slot?.claimedBy;
  if (
    typeof claimedBy === "string" &&
    claimedBy.trim() &&
    claimedBy.trim().toLowerCase() !== "open"
  ) {
    return true;
  }

  return false;
}

export function isGuestScheduleSlotOpenUnclaimed(slot: any): boolean {
  return !guestScheduleSlotHasClaimant(slot);
}

export function summarizeGuestScheduleSlotBuckets(slots: any[], nowMs = Date.now()) {
  let openSlots = 0;
  let expiredOpenSlots = 0;
  let futureOpenSlots = 0;
  let claimedSlots = 0;

  for (const slot of slots) {
    if (guestScheduleSlotHasClaimant(slot)) {
      claimedSlots += 1;
      continue;
    }

    openSlots += 1;
    if (isGuestScheduleSlotExpired(slot, nowMs)) {
      expiredOpenSlots += 1;
    } else {
      futureOpenSlots += 1;
    }
  }

  return {
    totalSlots: slots.length,
    openSlots,
    expiredOpenSlots,
    futureOpenSlots,
    claimedSlots,
  };
}

export function removeOpenGuestScheduleSlots(slots: any[]) {
  const removed = slots.filter((slot) => isGuestScheduleSlotOpenUnclaimed(slot));
  const remaining = slots.filter((slot) => !isGuestScheduleSlotOpenUnclaimed(slot));
  return { remaining, removed, removedCount: removed.length };
}

export function removeClaimedGuestScheduleSlots(slots: any[]) {
  const removed = slots.filter((slot) => guestScheduleSlotHasClaimant(slot));
  const remaining = slots.filter((slot) => !guestScheduleSlotHasClaimant(slot));
  return { remaining, removed, removedCount: removed.length };
}

export function removeEndedGuestScheduleSlots(slots: any[], nowMs = Date.now()) {
  const removed = slots.filter((slot) => isGuestScheduleSlotExpired(slot, nowMs));
  const remaining = slots.filter((slot) => !isGuestScheduleSlotExpired(slot, nowMs));
  return { remaining, removed, removedCount: removed.length };
}

export function removeGuestScheduleSlotById(slots: any[], slotId: string) {
  const resolvedSlotId = resolveGuestActionSlotId(slots, slotId);
  const remaining = slots.filter((slot: any, index: number) => {
    if (slotIdsMatch(slot, resolvedSlotId) || slotIdsMatch(slot, slotId)) return false;
    const syncedIndexMatch = String(slotId).match(/^synced-slot-(\d+)$/i);
    if (syncedIndexMatch && Number(syncedIndexMatch[1]) === index) return false;
    return true;
  });
  const removed = slots.filter((slot: any, index: number) => {
    if (slotIdsMatch(slot, resolvedSlotId) || slotIdsMatch(slot, slotId)) return true;
    const syncedIndexMatch = String(slotId).match(/^synced-slot-(\d+)$/i);
    return Boolean(syncedIndexMatch && Number(syncedIndexMatch[1]) === index);
  });
  return { remaining, removed, removedCount: removed.length };
}

export function removeExpiredOpenGuestScheduleSlots(slots: any[], nowMs = Date.now()) {
  const removed = slots.filter(
    (slot) => isGuestScheduleSlotOpenUnclaimed(slot) && isGuestScheduleSlotExpired(slot, nowMs)
  );
  const remaining = slots.filter(
    (slot) => !(isGuestScheduleSlotOpenUnclaimed(slot) && isGuestScheduleSlotExpired(slot, nowMs))
  );
  return { remaining, removed, removedCount: removed.length };
}

function resolveGuestScheduleActionContext(input: {
  sourceFeedId?: string;
  backendFeedItems: any[];
  homeFeedItems: any[];
  churchId: string;
  nowMs?: number;
  viewerUserId?: string;
  churchLiveControlRoomSchedule?: any | null;
}) {
  const churchId = String(input.churchId || "").trim();
  const nowMs = Number(input.nowMs || Date.now());
  const requestedFeedId = String(input.sourceFeedId || "").trim();
  const viewerUserId = String(input.viewerUserId || "").trim();

  const canonical = churchId
    ? resolveGuestCenterCanonicalSchedule({
        homeFeedItems: input.homeFeedItems,
        backendFeedItems: input.backendFeedItems,
        churchId,
        targetChurchId: churchId,
        viewerUserId,
        nowMs,
        churchLiveControlRoomSchedule: input.churchLiveControlRoomSchedule,
      })
    : null;

  const canonicalFeedId = String(canonical?.feedId || "").trim();
  const canonicalRawSlots = Array.isArray(canonical?.schedule?.scheduleSlots)
    ? canonical.schedule.scheduleSlots
    : [];
  const canonicalDisplaySlots = filterGuestCenterDisplaySlots(canonicalRawSlots);

  const mergedRows = [...(feedList() as any[]), ...input.homeFeedItems, ...input.backendFeedItems];
  const resolvedFeedId =
    (canonicalFeedId ? resolveCanonicalScheduleFeedId(canonicalFeedId, mergedRows) : "") ||
    canonicalFeedId;

  const legacySeed = requestedFeedId || canonicalFeedId;
  const legacyRead = legacySeed
    ? readGuestActionScheduleSlots({
        sourceFeedId: legacySeed,
        backendFeedItems: input.backendFeedItems,
        homeFeedItems: input.homeFeedItems,
      })
    : { feedId: "", slots: [] as any[], sourceUsed: "none" as const };

  console.log("KRISTO_DELETE_TARGET_FEED", {
    scheduleFeedIdPassed: requestedFeedId || null,
    activeScheduleId: requestedFeedId || canonicalFeedId || null,
    requestedFeedId: requestedFeedId || null,
    churchId,
  });

  console.log("KRISTO_DELETE_CANONICAL_FEED", {
    feedId: resolvedFeedId || canonicalFeedId || null,
    canonicalFeedId: canonicalFeedId || null,
    canonicalSource: canonical?.source || "none",
    mergedSlotCount: canonical?.mergedSlotCount ?? 0,
    displaySlotCount: canonicalDisplaySlots.length,
    rawCanonicalSlotCount: canonicalRawSlots.length,
    churchId,
  });

  console.log("KRISTO_DELETE_SLOT_SOURCE_COMPARE", {
    requestedFeedId: requestedFeedId || null,
    canonicalFeedId: canonicalFeedId || null,
    resolvedFeedId: resolvedFeedId || null,
    legacyFeedId: legacyRead.feedId || null,
    legacySourceUsed: legacyRead.sourceUsed,
    legacySlotCount: legacyRead.slots.length,
    canonicalRawSlotCount: canonicalRawSlots.length,
    canonicalDisplaySlotCount: canonicalDisplaySlots.length,
    canonicalMergedSlotCount: canonical?.mergedSlotCount ?? 0,
    backendSlotCount: canonical?.backendSlotCount ?? 0,
    feedIdMatch:
      !requestedFeedId ||
      requestedFeedId === canonicalFeedId ||
      requestedFeedId === resolvedFeedId,
    slotCountDelta: canonicalDisplaySlots.length - legacyRead.slots.length,
    usingCanonical: Boolean(canonicalFeedId && canonicalDisplaySlots.length),
  });

  if (!resolvedFeedId && !canonicalFeedId) {
    return null;
  }

  const feedId = resolvedFeedId || canonicalFeedId;
  const slots = canonicalDisplaySlots.length ? canonicalDisplaySlots : canonicalRawSlots;

  return {
    feedId,
    slots,
    sourceUsed: "guest-center-canonical" as const,
    churchId,
    nowMs,
    canonicalSource: canonical?.source || "none",
  };
}

type GuestCenterRoomMutationUi = {
  churchLiveControlRoomSchedule?: any | null;
  setChurchLiveControlRoomSchedule?: (schedule: any | null) => void;
  reloadChurchLiveControlOpts?: {
    churchName?: string;
    mediaName?: string;
    nowMs?: number;
  };
};

async function persistChurchLiveControlGuestCenterSlotRemoval(input: {
  context: NonNullable<ReturnType<typeof resolveGuestScheduleActionContext>>;
  headers: Record<string, string>;
  churchId: string;
  userId?: string;
  reason: string;
  mode: "delete-open" | "delete-claimed" | "delete-ended" | "delete-all" | "auto-delete-expired-open";
  setGuestClaimSlots?: (slots: any[]) => void;
  setChurchLiveControlRoomSchedule?: (schedule: any | null) => void;
  reloadChurchLiveControlOpts?: GuestCenterRoomMutationUi["reloadChurchLiveControlOpts"];
}) {
  const { context } = input;
  const { feedId, slots: sourceSlots, nowMs } = context;
  const beforeBuckets = summarizeGuestScheduleSlotBuckets(sourceSlots, nowMs);
  const partition =
    input.mode === "delete-all"
      ? { remaining: [] as any[], removed: sourceSlots, removedCount: sourceSlots.length }
      : input.mode === "delete-open"
        ? removeOpenGuestScheduleSlots(sourceSlots)
        : input.mode === "delete-claimed"
          ? removeClaimedGuestScheduleSlots(sourceSlots)
          : input.mode === "delete-ended"
            ? removeEndedGuestScheduleSlots(sourceSlots, nowMs)
            : removeExpiredOpenGuestScheduleSlots(sourceSlots, nowMs);
  const { remaining, removed, removedCount } = partition;

  if (removedCount <= 0) {
    return {
      ok: true,
      skipped: true,
      feedId,
      ...beforeBuckets,
      removedCount: 0,
      remainingCount: sourceSlots.length,
      syncOk: true,
      error: null,
    };
  }

  const mutation =
    input.mode === "delete-all"
      ? await mutateChurchLiveControlGuestCenterRoomSchedule({
          action: "delete_all",
          clearAll: true,
          headers: input.headers,
          churchId: input.churchId,
          userId: input.userId,
          reloadOpts: input.reloadChurchLiveControlOpts,
        })
      : await mutateChurchLiveControlGuestCenterRoomSchedule({
          action: "delete_slot",
          headers: input.headers,
          churchId: input.churchId,
          userId: input.userId,
          slotsToDelete: removed,
          reloadOpts: input.reloadChurchLiveControlOpts,
        });

  if (!mutation.ok) {
    return {
      ok: false,
      skipped: false,
      feedId,
      ...beforeBuckets,
      removedCount: 0,
      remainingCount: sourceSlots.length,
      syncOk: false,
      error: mutation.error || "room-delete-failed",
    };
  }

  input.setChurchLiveControlRoomSchedule?.(mutation.schedule);
  input.setGuestClaimSlots?.(
    Array.isArray(mutation.schedule?.scheduleSlots) ? mutation.schedule.scheduleSlots : remaining
  );

  return {
    ok: true,
    skipped: false,
    feedId,
    reason: input.reason,
    ...beforeBuckets,
    removedCount,
    remainingCount: remaining.length,
    syncOk: true,
    error: null,
    affectedMessageIds: mutation.affectedMessageIds,
    schedule: mutation.schedule,
  };
}

async function persistGuestScheduleSlotRemoval(input: {
  sourceFeedId?: string;
  backendFeedItems: any[];
  homeFeedItems: any[];
  headers: Record<string, string>;
  churchId: string;
  nowMs?: number;
  userId?: string;
  reason: string;
  mode: "delete-open" | "delete-claimed" | "delete-ended" | "delete-all" | "auto-delete-expired-open";
  setBackendFeedItems: (items: any[]) => void;
  setHomeFeedItems: (items: any[]) => void;
  setGuestClaimSlots?: (slots: any[]) => void;
} & GuestCenterRoomMutationUi) {
  const context = resolveGuestScheduleActionContext({
    sourceFeedId: input.sourceFeedId,
    backendFeedItems: input.backendFeedItems,
    homeFeedItems: input.homeFeedItems,
    churchId: input.churchId,
    nowMs: input.nowMs,
    viewerUserId: input.userId,
    churchLiveControlRoomSchedule: input.churchLiveControlRoomSchedule,
  });

  if (context && isGuestCenterChurchLiveControlRoomSource(context.canonicalSource)) {
    return persistChurchLiveControlGuestCenterSlotRemoval({
      context,
      headers: input.headers,
      churchId: input.churchId,
      userId: input.userId,
      reason: input.reason,
      mode: input.mode,
      setGuestClaimSlots: input.setGuestClaimSlots,
      setChurchLiveControlRoomSchedule: input.setChurchLiveControlRoomSchedule,
      reloadChurchLiveControlOpts: input.reloadChurchLiveControlOpts,
    });
  }
  if (!context?.feedId || !context.slots.length) {
    const emptyBuckets = summarizeGuestScheduleSlotBuckets([], Number(input.nowMs || Date.now()));
    const emptyResult = {
      ok: true,
      skipped: true,
      feedId: String(context?.feedId || input.sourceFeedId || ""),
      ...emptyBuckets,
      removedCount: 0,
      remainingCount: 0,
      syncOk: true,
      error: null as string | null,
    };
    if (input.mode === "delete-open") {
      console.log("KRISTO_DELETE_OPEN_SLOTS_RESULT", emptyResult);
    } else if (input.mode === "delete-claimed") {
      console.log("KRISTO_DELETE_CLAIMED_SLOTS_RESULT", emptyResult);
    } else if (input.mode === "delete-ended") {
      console.log("KRISTO_DELETE_ENDED_SLOTS_RESULT", emptyResult);
    } else if (input.mode === "delete-all") {
      console.log("KRISTO_DELETE_ALL_GUEST_SLOTS_RESULT", emptyResult);
    } else {
      console.log("KRISTO_AUTO_DELETE_EXPIRED_SLOTS_RESULT", emptyResult);
    }
    return emptyResult;
  }

  const nowMs = Number(input.nowMs || context.nowMs || Date.now());
  const { feedId, slots: sourceSlots, sourceUsed } = context;
  const beforeBuckets = summarizeGuestScheduleSlotBuckets(sourceSlots, nowMs);
  const partition =
    input.mode === "delete-all"
      ? { remaining: [] as any[], removed: sourceSlots, removedCount: sourceSlots.length }
      : input.mode === "delete-open"
      ? removeOpenGuestScheduleSlots(sourceSlots)
      : input.mode === "delete-claimed"
        ? removeClaimedGuestScheduleSlots(sourceSlots)
        : input.mode === "delete-ended"
          ? removeEndedGuestScheduleSlots(sourceSlots, nowMs)
          : removeExpiredOpenGuestScheduleSlots(sourceSlots, nowMs);
  const { remaining, removed, removedCount } = partition;

  if (input.mode === "delete-open") {
    console.log("KRISTO_DELETE_OPEN_SLOTS_START", {
      feedId,
      reason: input.reason,
      sourceUsed,
      ...beforeBuckets,
    });
  } else if (input.mode === "delete-claimed") {
    console.log("KRISTO_DELETE_CLAIMED_SLOTS_START", {
      feedId,
      reason: input.reason,
      sourceUsed,
      ...beforeBuckets,
    });
  } else if (input.mode === "delete-ended") {
    console.log("KRISTO_DELETE_ENDED_SLOTS_START", {
      feedId,
      reason: input.reason,
      sourceUsed,
      ...beforeBuckets,
    });
  } else if (input.mode === "delete-all") {
    console.log("KRISTO_DELETE_ALL_GUEST_SLOTS_START", {
      feedId,
      reason: input.reason,
      sourceUsed,
      ...beforeBuckets,
    });
  } else if (removedCount <= 0) {
    console.log("KRISTO_AUTO_DELETE_EXPIRED_SLOTS_RESULT", {
      feedId,
      reason: input.reason,
      sourceUsed,
      ...beforeBuckets,
      removedCount: 0,
      remainingCount: sourceSlots.length,
      skipped: true,
      syncOk: true,
      ok: true,
      error: null,
    });
    return {
      ok: true,
      skipped: true,
      feedId,
      ...beforeBuckets,
      removedCount: 0,
      remainingCount: sourceSlots.length,
      syncOk: true,
      error: null,
    };
  }

  if (
    removedCount <= 0 &&
    (input.mode === "delete-open" ||
      input.mode === "delete-claimed" ||
      input.mode === "delete-ended" ||
      input.mode === "delete-all")
  ) {
    const skippedResult = {
      ok: true,
      skipped: true,
      feedId,
      ...beforeBuckets,
      removedCount: 0,
      remainingCount: sourceSlots.length,
      syncOk: true,
      error: null as string | null,
    };
    if (input.mode === "delete-open") {
      console.log("KRISTO_DELETE_OPEN_SLOTS_RESULT", skippedResult);
    } else if (input.mode === "delete-claimed") {
      console.log("KRISTO_DELETE_CLAIMED_SLOTS_RESULT", skippedResult);
    } else if (input.mode === "delete-ended") {
      console.log("KRISTO_DELETE_ENDED_SLOTS_RESULT", skippedResult);
    } else {
      console.log("KRISTO_DELETE_ALL_GUEST_SLOTS_RESULT", skippedResult);
    }
    return skippedResult;
  }

  if (input.mode === "auto-delete-expired-open") {
    for (const slot of removed) {
      const { startMs, endMs } = resolveMediaSlotTimeWindow(slot, nowMs);
      console.log("KRISTO_AUTO_DELETE_EXPIRED_SLOT", {
        feedId,
        slotId: String(slot?.id || slot?.slotId || ""),
        startMs: startMs || null,
        endMs: endMs || null,
        nowMs,
        reason: input.reason,
      });
    }
  }

  let syncOk = false;
  let error: string | null = null;

  try {
    const clearRes = await clearMediaScheduleSlotsOnBackend({
      feedId,
      churchId: input.churchId,
      headers: input.headers,
      slots: remaining,
      reason: input.reason,
    });
    syncOk = clearRes.ok;
    if (!syncOk && clearRes.error) {
      error = clearRes.error;
    }
  } catch (e: any) {
    error = String(e?.message || e);
  }

  const afterBuckets = summarizeGuestScheduleSlotBuckets(remaining, nowMs);
  const resultPayload = {
    feedId,
    reason: input.reason,
    sourceUsed,
    ...beforeBuckets,
    removedCount,
    remainingCount: remaining.length,
    ...afterBuckets,
    syncOk,
    ok: syncOk,
    error,
  };

  if (input.mode === "delete-open") {
    console.log("KRISTO_DELETE_OPEN_SLOTS_RESULT", resultPayload);
  } else if (input.mode === "delete-claimed") {
    console.log("KRISTO_DELETE_CLAIMED_SLOTS_RESULT", resultPayload);
  } else if (input.mode === "delete-ended") {
    console.log("KRISTO_DELETE_ENDED_SLOTS_RESULT", resultPayload);
  } else if (input.mode === "delete-all") {
    console.log("KRISTO_DELETE_ALL_GUEST_SLOTS_RESULT", resultPayload);
  } else {
    console.log("KRISTO_AUTO_DELETE_EXPIRED_SLOTS_RESULT", resultPayload);
  }

  if (!syncOk) {
    return {
      ...resultPayload,
      skipped: false,
      verify: null,
      reload: null,
      invalidate: null,
    };
  }

  if (input.mode === "delete-all") {
    await purgeDeletedScheduleFromAllSources({
      feedId,
      churchId: input.churchId,
      userId: String(input.userId || input.headers?.["x-kristo-user-id"] || ""),
      reason: input.reason,
      backendRows: input.backendFeedItems,
      setBackendFeedItems: input.setBackendFeedItems,
      setHomeFeedItems: input.setHomeFeedItems,
      setGuestClaimSlots: input.setGuestClaimSlots,
    });

    const sync = await fetchMediaScheduleFeedSync(input.churchId, input.headers);
    const reloadedRows = filterBackendRowsWithoutDeletedSchedule(
      filterOutDeletedScheduleRows(Array.isArray(sync.rows) ? sync.rows : []),
      feedId
    );

    input.setBackendFeedItems(reloadedRows);
    input.setHomeFeedItems([...feedList()]);
    input.setGuestClaimSlots?.([]);

    const purgeAfterReload = await purgeDeletedScheduleFromAllSources({
      feedId,
      churchId: input.churchId,
      userId: String(input.userId || input.headers?.["x-kristo-user-id"] || ""),
      reason: `${input.reason}-after-reload`,
      backendRows: reloadedRows,
      setBackendFeedItems: input.setBackendFeedItems,
      setHomeFeedItems: input.setHomeFeedItems,
      setGuestClaimSlots: input.setGuestClaimSlots,
    });

    try {
      await fetchHomeFeedFromApi("delete-all-guest-slots", { force: true, reconcile: true });
    } catch {
      // ignore home feed refresh errors
    }

    const verify = logGuestAfterReloadVerify({
      selectedSlotId: "",
      feedId,
      backendFeedItems: reloadedRows,
      runtimeSlots: [],
      nowMs,
      sourceUsed: "backend",
    });

    return {
      ...resultPayload,
      skipped: false,
      verify,
      reload: {
        rows: reloadedRows,
        feedId,
        backendSlots: [],
        sourceUsed: "backend" as const,
      },
      invalidate: purgeAfterReload,
    };
  }

  const reload = await forceReloadGuestScheduleFromBackend({
    churchId: input.churchId,
    headers: input.headers,
    setBackendFeedItems: input.setBackendFeedItems,
    setHomeFeedItems: input.setHomeFeedItems,
    setGuestClaimSlots: input.setGuestClaimSlots,
  });

  const verify = logGuestAfterReloadVerify({
    selectedSlotId: "",
    feedId: reload.feedId || feedId,
    backendFeedItems: reload.rows,
    runtimeSlots: reload.backendSlots,
    nowMs,
    sourceUsed: reload.sourceUsed,
  });

  const invalidate = await invalidateGuestClaimGlobalLiveState({
    churchId: input.churchId,
    userId: String(input.userId || input.headers?.["x-kristo-user-id"] || ""),
    scheduleId: reload.feedId || feedId,
    headers: input.headers,
    reloadRows: reload.rows,
    backendSlotCount: reload.backendSlots.length,
    reason: input.reason,
    nowMs,
    setBackendFeedItems: input.setBackendFeedItems,
    setHomeFeedItems: input.setHomeFeedItems,
    setGuestClaimSlots: input.setGuestClaimSlots,
  });

  return {
    ...resultPayload,
    skipped: false,
    verify,
    reload,
    invalidate,
  };
}

export async function persistDeleteAllGuestSlots(input: {
  sourceFeedId?: string;
  backendFeedItems: any[];
  homeFeedItems: any[];
  headers: Record<string, string>;
  churchId: string;
  nowMs?: number;
  userId?: string;
  setBackendFeedItems: (items: any[]) => void;
  setHomeFeedItems: (items: any[]) => void;
  setGuestClaimSlots?: (slots: any[]) => void;
}) {
  return persistGuestScheduleSlotRemoval({
    ...input,
    reason: "delete-all-guest-slots",
    mode: "delete-all",
  });
}

export async function persistDeleteOpenGuestSlots(input: {
  sourceFeedId: string;
  backendFeedItems: any[];
  homeFeedItems: any[];
  headers: Record<string, string>;
  churchId: string;
  nowMs?: number;
  userId?: string;
  setBackendFeedItems: (items: any[]) => void;
  setHomeFeedItems: (items: any[]) => void;
  setGuestClaimSlots?: (slots: any[]) => void;
}) {
  return persistGuestScheduleSlotRemoval({
    ...input,
    reason: "delete-open-slots",
    mode: "delete-open",
  });
}

export async function persistDeleteClaimedGuestSlots(input: {
  sourceFeedId: string;
  backendFeedItems: any[];
  homeFeedItems: any[];
  headers: Record<string, string>;
  churchId: string;
  nowMs?: number;
  userId?: string;
  setBackendFeedItems: (items: any[]) => void;
  setHomeFeedItems: (items: any[]) => void;
  setGuestClaimSlots?: (slots: any[]) => void;
}) {
  return persistGuestScheduleSlotRemoval({
    ...input,
    reason: "delete-claimed-slots",
    mode: "delete-claimed",
  });
}

export async function persistDeleteEndedGuestSlots(input: {
  sourceFeedId: string;
  backendFeedItems: any[];
  homeFeedItems: any[];
  headers: Record<string, string>;
  churchId: string;
  nowMs?: number;
  userId?: string;
  setBackendFeedItems: (items: any[]) => void;
  setHomeFeedItems: (items: any[]) => void;
  setGuestClaimSlots?: (slots: any[]) => void;
}) {
  return persistGuestScheduleSlotRemoval({
    ...input,
    reason: "delete-ended-slots",
    mode: "delete-ended",
  });
}

/** @deprecated Use persistDeleteOpenGuestSlots */
export async function persistDeleteExpiredGuestSlots(input: {
  sourceFeedId: string;
  backendFeedItems: any[];
  homeFeedItems: any[];
  headers: Record<string, string>;
  churchId: string;
  nowMs?: number;
  userId?: string;
  setBackendFeedItems: (items: any[]) => void;
  setHomeFeedItems: (items: any[]) => void;
  setGuestClaimSlots?: (slots: any[]) => void;
}) {
  return persistDeleteOpenGuestSlots(input);
}

function isAutoDeleteScreenLoadReason(reason: string) {
  const value = String(reason || "");
  return (
    value.includes("guest-claim-center-load") ||
    value.includes("live-slots-load") ||
    value.startsWith("media-reload:")
  );
}

function backendFeedHasScheduleFeedId(rows: any[], feedId: string) {
  const seed = String(feedId || "").trim();
  if (!seed) return false;
  return rows.some((item) => {
    const aliases = [
      item?.id,
      item?.sourceScheduleId,
      item?.liveScheduleFeedId,
      item?.scheduleFeedId,
      item?.parentScheduleId,
      item?.liveId,
    ].map((value) => String(value || "").trim());
    return aliases.includes(seed);
  });
}

export async function autoDeleteExpiredOpenGuestSlots(input: {
  reason: string;
  churchId: string;
  headers: Record<string, string>;
  backendFeedItems?: any[];
  homeFeedItems?: any[];
  sourceFeedId?: string;
  nowMs?: number;
  userId?: string;
  setBackendFeedItems?: (items: any[]) => void;
  setHomeFeedItems?: (items: any[]) => void;
  setGuestClaimSlots?: (slots: any[]) => void;
} & GuestCenterRoomMutationUi) {
  const churchId = String(input.churchId || "").trim();
  if (!churchId) {
    return {
      ok: true,
      skipped: true,
      removedCount: 0,
      remainingCount: 0,
    };
  }

  const backendFeedItems = Array.isArray(input.backendFeedItems) ? input.backendFeedItems : [];
  const homeFeedItems = Array.isArray(input.homeFeedItems) ? input.homeFeedItems : [];
  const context = resolveGuestScheduleActionContext({
    sourceFeedId: input.sourceFeedId,
    backendFeedItems,
    homeFeedItems,
    churchId,
    nowMs: input.nowMs,
    viewerUserId: input.userId,
    churchLiveControlRoomSchedule: input.churchLiveControlRoomSchedule,
  });

  if (!context?.feedId || !context.slots.length) {
    return {
      ok: true,
      skipped: true,
      removedCount: 0,
      remainingCount: 0,
      feedId: String(context?.feedId || ""),
    };
  }

  const buckets = summarizeGuestScheduleSlotBuckets(context.slots, context.nowMs);
  if (buckets.expiredOpenSlots <= 0) {
    return {
      ok: true,
      skipped: true,
      feedId: context.feedId,
      ...buckets,
      removedCount: 0,
      remainingCount: context.slots.length,
    };
  }

  if (
    !isGuestCenterChurchLiveControlRoomSource(context.canonicalSource) &&
    isAutoDeleteScreenLoadReason(input.reason) &&
    !backendFeedHasScheduleFeedId(backendFeedItems, context.feedId)
  ) {
    console.log("KRISTO_AUTO_DELETE_EXPIRED_SLOTS_SKIPPED", {
      reason: input.reason,
      feedId: context.feedId,
      cause: "no-backend-feed-row-for-screen-load",
      expiredOpenSlots: buckets.expiredOpenSlots,
    });
    return {
      ok: true,
      skipped: true,
      feedId: context.feedId,
      ...buckets,
      removedCount: 0,
      remainingCount: context.slots.length,
    };
  }

  if (!input.setBackendFeedItems || !input.setHomeFeedItems) {
    const { remaining, removedCount } = removeExpiredOpenGuestScheduleSlots(
      context.slots,
      context.nowMs
    );
    if (removedCount <= 0) {
      return {
        ok: true,
        skipped: true,
        feedId: context.feedId,
        ...buckets,
        removedCount: 0,
        remainingCount: context.slots.length,
      };
    }

    let syncOk = false;
    let error: string | null = null;
    try {
      const clearRes = await clearMediaScheduleSlotsOnBackend({
        feedId: context.feedId,
        churchId,
        headers: input.headers,
        slots: remaining,
        reason: input.reason,
      });
      syncOk = clearRes.ok;
      error = clearRes.error || null;
    } catch (e: any) {
      error = String(e?.message || e);
    }

    for (const slot of context.slots.filter(
      (row: any) =>
        isGuestScheduleSlotOpenUnclaimed(row) && isGuestScheduleSlotExpired(row, context.nowMs)
    )) {
      const { startMs, endMs } = resolveMediaSlotTimeWindow(slot, context.nowMs);
      console.log("KRISTO_AUTO_DELETE_EXPIRED_SLOT", {
        feedId: context.feedId,
        slotId: String(slot?.id || slot?.slotId || ""),
        startMs: startMs || null,
        endMs: endMs || null,
        nowMs: context.nowMs,
        reason: input.reason,
      });
    }

    const resultPayload = {
      feedId: context.feedId,
      reason: input.reason,
      ...buckets,
      removedCount,
      remainingCount: remaining.length,
      syncOk,
      ok: syncOk,
      error,
    };
    console.log("KRISTO_AUTO_DELETE_EXPIRED_SLOTS_RESULT", resultPayload);
    emitLiveRingRefresh(input.reason);
    return resultPayload;
  }

  return persistGuestScheduleSlotRemoval({
    sourceFeedId: context.feedId,
    backendFeedItems,
    homeFeedItems,
    headers: input.headers,
    churchId,
    nowMs: input.nowMs,
    userId: input.userId,
    reason: input.reason,
    mode: "auto-delete-expired-open",
    setBackendFeedItems: input.setBackendFeedItems,
    setHomeFeedItems: input.setHomeFeedItems,
    setGuestClaimSlots: input.setGuestClaimSlots,
    churchLiveControlRoomSchedule: input.churchLiveControlRoomSchedule,
    setChurchLiveControlRoomSchedule: input.setChurchLiveControlRoomSchedule,
    reloadChurchLiveControlOpts: input.reloadChurchLiveControlOpts,
  });
}
