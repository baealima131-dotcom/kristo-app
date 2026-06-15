import { apiPost } from "@/src/lib/kristoApi";
import {
  clearScheduleClaimRuntimeState,
  feedList,
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
  getActiveScheduleSlots,
} from "@/src/lib/mediaScheduleLock";
import {
  clearActiveLiveAfterGuestSlotDelete,
  shouldClearActiveLiveAfterGuestDelete,
} from "@/src/lib/guestClaimClearActiveLive";
import { publishLiveEnded } from "@/src/lib/liveBridge";
import {
  computeChurchScheduleTabLive,
  emitLiveRingRefresh,
  mergeFeedRowsForScheduleScan,
  recomputeScheduleRingsFromRows,
} from "@/src/lib/liveScheduleRing";
import {
  baseFeedId,
  collectScheduleAliasIds,
  isBackendFeedScheduleId,
  isLocalMediaScheduleId,
  resolveCanonicalScheduleFeedId,
} from "@/src/lib/scheduleSlotUtils";
import {
  resolveMediaSlotTimeWindow,
  resolveCanonicalMediaScheduleForGuests,
  summarizeGuestClaimSlotForLog,
} from "@/src/lib/mediaScheduleSlotTimes";
import {
  fetchHomeFeedFromApi,
  getCachedHomeFeedBackendRows,
  mergeCachedHomeFeedBackendRows,
} from "@/src/components/homeFeed/homeFeedApi";
import { buildLiveSlotsCatalogFromFeedRows } from "@/src/lib/liveSlotsCatalog";
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
      return {
        feedId,
        slots: backendItem.scheduleSlots,
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
  const rows = Array.isArray(sync.rows) ? sync.rows : [];

  applyBackendMediaScheduleToLocalFeed(rows, churchId);
  input.setBackendFeedItems(rows);
  input.setHomeFeedItems([...feedList()]);
  input.setGuestClaimSlots?.([]);

  const backendSchedule =
    findMediaScheduleFeedForChurch(rows, churchId, { strictChurch: true }) ||
    findActiveMediaScheduleForChurch(rows, churchId, { strictChurch: true });

  return {
    rows,
    backendSchedule,
    feedId: String(backendSchedule?.id || backendSchedule?.sourceScheduleId || "").trim(),
    backendSlots: Array.isArray(backendSchedule?.scheduleSlots) ? backendSchedule.scheduleSlots : [],
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

  if (
    scheduleId &&
    shouldEndStaleMediaScheduleFeedRow({
      remainingSlotCount: backendSlotCount,
      activeSlotCount: backendActiveSlotCount,
    })
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

  if (!backendSchedule || backendSlotCount === 0) {
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
  } else {
    applyBackendMediaScheduleToLocalFeed(reloadRows, churchId);
    input.setBackendFeedItems?.(reloadRows);
    input.setHomeFeedItems?.([...feedList()]);
    input.setGuestClaimSlots?.([]);

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
}) {
  const action = input.action;
  const startLog = action === "reject" ? "KRISTO_GUEST_REJECT_START" : "KRISTO_GUEST_DELETE_START";
  const payloadLog = action === "reject" ? "KRISTO_GUEST_REJECT_PAYLOAD" : "KRISTO_GUEST_DELETE_PAYLOAD";
  const resultLog = action === "reject" ? "KRISTO_GUEST_REJECT_RESULT" : "KRISTO_GUEST_DELETE_RESULT";

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
}) {
  const churchId = String(input.churchId || "").trim();
  const nowMs = Number(input.nowMs || Date.now());
  const seed = String(input.sourceFeedId || "").trim();

  if (seed) {
    const read = readGuestActionScheduleSlots({
      sourceFeedId: seed,
      backendFeedItems: input.backendFeedItems,
      homeFeedItems: input.homeFeedItems,
    });
    return {
      feedId: read.feedId,
      slots: read.slots,
      sourceUsed: read.sourceUsed,
      churchId,
      nowMs,
    };
  }

  const activeSchedule = churchId
    ? resolveCanonicalMediaScheduleForGuests(
        input.homeFeedItems,
        input.backendFeedItems,
        churchId,
        nowMs
      )
    : null;
  const sourceFeedId = String(activeSchedule?.sourceScheduleId || activeSchedule?.id || "").trim();
  if (!sourceFeedId) return null;

  const read = readGuestActionScheduleSlots({
    sourceFeedId,
    backendFeedItems: input.backendFeedItems,
    homeFeedItems: input.homeFeedItems,
  });

  return {
    feedId: read.feedId,
    slots: read.slots,
    sourceUsed: read.sourceUsed,
    churchId,
    nowMs,
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
}) {
  const context = resolveGuestScheduleActionContext(input);
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
}) {
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
  });
}
