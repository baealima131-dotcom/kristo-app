import { feedList, getRingClaimHints, getUserClaimedSlotEntries } from "@/src/lib/homeFeedStore";
import { filterOutDeletedScheduleRows } from "@/src/lib/deletedScheduleRegistry";
import {
  collectScheduleRowsForRingScan,
  findAuthoritativeScheduleSlot,
  injectClaimStoreScheduleRows,
  mergeScheduleFeedClaimRows,
  overlayStableClaimsOnFeedRows,
  reconcileUserClaimedSlotStoreAgainstScheduleRows,
} from "@/src/lib/claimStateMerge";
import { isMediaScheduleFeedItem } from "@/src/lib/mediaScheduleFeedPredicates";
import { isChurchLiveControlScheduleFeedRow } from "@/src/lib/churchLiveControlSchedule";
import { isActiveScheduleSlot } from "@/src/lib/mediaScheduleSlotActive";
import { resolveCanonicalMediaScheduleForGuests } from "@/src/lib/mediaScheduleGuestResolve";
import { isMediaSlotEndedOrStale, resolveMediaSlotTimeWindow } from "@/src/lib/mediaScheduleSlotTimes";
import {
  filterLocalRowsWhenBackendZeroSlots,
  purgeStaleLocalScheduleRowsWhenBackendZero,
} from "@/src/lib/staleBackendZeroSlotGuard";
import {
  baseFeedId,
  collectScheduleAliasIds,
  enrichScheduleSlot,
  normalizeLiveScheduleSlots,
  resolveCanonicalScheduleFeedId,
  scheduleSlotClaimUserId,
} from "@/src/lib/scheduleSlotUtils";
import {
  findProtectedClaimableSchedule,
  findProtectedNearLiveSchedule,
  getSlotRingWindow,
  isNearLiveOrActiveSlot,
  isPersonalRingWindow,
  NEAR_LIVE_WINDOW_MS,
} from "@/src/lib/liveScheduleRingSlotWindow";
export {
  findProtectedClaimableSchedule,
  findProtectedNearLiveSchedule,
  getSlotRingWindow,
  isNearLiveOrActiveSlot,
  isPersonalRingWindow,
  NEAR_LIVE_WINDOW_MS,
} from "@/src/lib/liveScheduleRingSlotWindow";
export {
  emitLiveRingRefresh,
  KRISTO_LIVE_RING_REFRESH,
  onLiveRingRefresh,
  type LiveRingRefreshPayload,
} from "@/src/lib/liveScheduleRingEvents";

export const RING_RECOMPUTE_INTERVAL_MS = 20_000;

export type ScheduleRingAlert = {
  item: any;
  slot: any;
  index: number;
  startMs: number;
  endMs: number;
  startsInMin: number;
  isLiveNow: boolean;
  color: string;
  match?: string;
  feedId?: string;
  slotNumber?: number;
  icon?: keyof typeof import("@expo/vector-icons").Ionicons.glyphMap;
};

function isMediaScheduleRow(item: any): boolean {
  return isMediaScheduleFeedItem(item);
}

function isSlotClaimedByViewer(slot: any, viewerUserId: string, feedId?: string): boolean {
  const uid = String(viewerUserId || "").trim();
  if (!uid) return false;
  if (scheduleSlotClaimUserId(slot) === uid) return true;
  return slotClaimedByUser(slot, uid, feedId);
}

/** Active or upcoming claimed slot — same window rules as Guests Claim Center / Live Slots. */
function isCountableProfileClaimedSlot(slot: any, index: number, nowMs: number): boolean {
  if (!slot || typeof slot !== "object") return false;
  if (slot.deleted === true || slot.deletedAt) return false;

  const status = String(slot?.status || "").toLowerCase();
  if (status === "deleted" || status === "removed" || status === "cancelled" || status === "canceled") {
    return false;
  }

  const normalized = normalizeLiveScheduleSlots([slot])[0] || slot;
  if (isMediaSlotEndedOrStale(normalized, nowMs)) return false;
  return isActiveScheduleSlot(normalized, nowMs);
}

function localStoreClaimsSlot(
  slot: any,
  userId: string,
  feedId?: string
): boolean {
  const uid = String(userId || "").trim();
  const slotId = String(slot?.id || slot?.slotId || "").trim();
  const seed = baseFeedId(feedId || "");
  if (!uid || !slotId) return false;

  const rows = feedList() as any[];
  const aliases = seed ? new Set(collectScheduleAliasIds(seed, rows)) : null;

  return getUserClaimedSlotEntries(uid).some((entry) => {
    if (String(entry?.slotId || "").trim() !== slotId) return false;
    if (!seed || !aliases) return true;
    const entryPostId = String(entry?.postId || "").trim();
    return aliases.has(entryPostId) || aliases.has(baseFeedId(entryPostId));
  });
}

export function slotClaimedByUser(
  slot: any,
  userId: string,
  feedId?: string
): boolean {
  const uid = String(userId || "").trim();
  if (!uid) return false;

  const claimedRaw = slot?.claimedBy;
  const slotUserId = String(
    slot?.claimedByUserId ||
      (claimedRaw && typeof claimedRaw === "object" ? claimedRaw.userId : "") ||
      ""
  ).trim();

  if (slotUserId === uid) return true;
  return localStoreClaimsSlot(slot, uid, feedId);
}

export function ringColorForSlot(startMs: number, endMs: number, nowMs: number): string {
  const startsInMin = Math.ceil((startMs - nowMs) / 60000);
  const isLiveNow = nowMs >= startMs && nowMs <= endMs;

  if (isLiveNow || startsInMin <= 0) return "#EF4444";
  if (startsInMin <= 5) return "#F59E0B";
  if (startsInMin <= 15) return "#A78BFA";
  return "#38BDF8";
}

function buildClaimedPersonalAlert(
  item: any,
  slot: any,
  index: number,
  nowMs: number,
  feedId?: string,
  slotNumber?: number
): ScheduleRingAlert | null {
  const { startMs, endMs, isLiveNow } = getSlotRingWindow(slot, index, nowMs);
  if (!isPersonalRingWindow(startMs, endMs, nowMs)) return null;

  const startsInMin = Math.ceil((startMs - nowMs) / 60000);

  return {
    item,
    slot,
    index,
    startMs,
    endMs,
    startsInMin,
    isLiveNow,
    match: "claimed",
    feedId: feedId || baseFeedId(String(item?.sourceScheduleId || item?.id || "")),
    slotNumber:
      slotNumber ||
      Number(slot?.slot || slot?.slotNumber || slot?.order || index + 1),
    icon: isLiveNow || startsInMin <= 0 ? "radio" : "hand-left",
    color: ringColorForSlot(startMs, endMs, nowMs),
  };
}

export function mergeFeedRowsForScheduleScan(
  backendRows: any[] = [],
  options?: { backendFeedLoaded?: boolean; churchId?: string; viewerUserId?: string }
): any[] {
  const backendFeedLoaded = options?.backendFeedLoaded === true;
  const viewerUserId = String(options?.viewerUserId || "").trim();

  if (backendFeedLoaded) {
    purgeStaleLocalScheduleRowsWhenBackendZero({
      backendRows,
      backendFeedLoaded: true,
      churchId: options?.churchId,
      reason: "ring-merge-scan",
      viewerUserId,
    });
  }

  const localRows = filterOutDeletedScheduleRows(
    (() => {
      try {
        const rows = feedList() as any[];
        return filterLocalRowsWhenBackendZeroSlots(rows, backendRows, backendFeedLoaded);
      } catch {
        return [];
      }
    })()
  );
  const filteredBackendRows = filterOutDeletedScheduleRows(
    Array.isArray(backendRows) ? backendRows : []
  );

  const mergedRows = [...localRows, ...filteredBackendRows];
  const byBase = new Map<string, any>();

  for (const row of localRows) {
    const seed = String(row?.sourceScheduleId || row?.id || "");
    const key =
      resolveCanonicalScheduleFeedId(seed, mergedRows) ||
      baseFeedId(seed) ||
      String(row?.id || "");
    if (!key) continue;
    byBase.set(key, row);
  }

  for (const row of filteredBackendRows) {
    const seed = String(row?.sourceScheduleId || row?.id || "");
    const key =
      resolveCanonicalScheduleFeedId(seed, mergedRows) ||
      baseFeedId(seed) ||
      String(row?.id || "");
    if (!key) continue;
    const existing = byBase.get(key);
    byBase.set(
      key,
      existing ? mergeScheduleFeedClaimRows(existing, row, viewerUserId) : row
    );
  }

  let result = filterOutDeletedScheduleRows(Array.from(byBase.values()));
  if (backendFeedLoaded && viewerUserId) {
    reconcileUserClaimedSlotStoreAgainstScheduleRows(result, viewerUserId, {
      authoritative: true,
      reason: "ring-merge-scan",
    });
  }
  result = overlayStableClaimsOnFeedRows(result, viewerUserId, { allSources: mergedRows });
  result = injectClaimStoreScheduleRows(result, viewerUserId, { allSources: mergedRows });
  return filterOutDeletedScheduleRows(result);
}

/** Same merged row source as KRISTO_LIVE_RING_FAST_SYNC / recomputeScheduleRingsFromRows. */
export function resolveRingMergedScheduleRows(options: {
  churchBackendRows?: any[];
  viewerUserId?: string;
  viewerChurchId?: string;
  backendFeedLoaded?: boolean;
}): any[] {
  const viewerUserId = String(options.viewerUserId || "").trim();
  const scanRows = collectScheduleRowsForRingScan(
    filterOutDeletedScheduleRows(
      (Array.isArray(options.churchBackendRows) ? options.churchBackendRows : []).filter(
        (row) => !isChurchLiveControlScheduleFeedRow(row)
      )
    ),
    viewerUserId
  );
  return filterOutDeletedScheduleRows(
    mergeFeedRowsForScheduleScan(scanRows, {
      backendFeedLoaded: options.backendFeedLoaded === true,
      churchId: String(options.viewerChurchId || "").trim(),
      viewerUserId,
    })
  );
}

export function resolveRingChurchScheduleSnapshot(options: {
  mergedRows: any[];
  viewerChurchId: string;
  nowMs?: number;
}): { schedule: any | null; feedId: string; slotCount: number } {
  const viewerChurchId = String(options.viewerChurchId || "").trim();
  const nowMs = options.nowMs ?? Date.now();

  const churchLive = computeChurchScheduleTabLive({
    rows: options.mergedRows,
    viewerChurchId,
    nowMs,
  });

  if (churchLive?.item) {
    const item = churchLive.item;
    const slots = Array.isArray(item?.scheduleSlots) ? item.scheduleSlots : [];
    return {
      schedule: item,
      feedId: String(item?.sourceScheduleId || item?.id || "").trim(),
      slotCount: slots.length,
    };
  }

  let best: any = null;
  let bestCount = 0;
  for (const row of options.mergedRows) {
    if (!isMediaScheduleFeedItem(row)) continue;
    if (String(row?.churchId || row?.sourceChurchId || "").trim() !== viewerChurchId) continue;
    const count = Array.isArray(row?.scheduleSlots) ? row.scheduleSlots.length : 0;
    if (count > bestCount) {
      best = row;
      bestCount = count;
    }
  }

  if (best) {
    return {
      schedule: best,
      feedId: String(best?.sourceScheduleId || best?.id || "").trim(),
      slotCount: bestCount,
    };
  }

  return { schedule: null, feedId: "", slotCount: 0 };
}

export function logRingToGuestCenterBridge(input: {
  ringMergedRowCount: number;
  guestMergedRowCount: number;
  ringFeedId: string;
  guestFeedId: string;
  ringSlotCount: number;
  guestSlotCount: number;
}) {
  console.log("KRISTO_RING_TO_GUEST_CENTER_BRIDGE", input);
}

export function computeChurchScheduleTabLive(options: {
  rows: any[];
  viewerChurchId: string;
  nowMs?: number;
}): ScheduleRingAlert | null {
  const viewerChurchId = String(options.viewerChurchId || "").trim();
  const nowMs = options.nowMs ?? Date.now();
  const upcoming: ScheduleRingAlert[] = [];

  for (const item of options.rows) {
    if (isChurchLiveControlScheduleFeedRow(item)) continue;
    if (!isMediaScheduleRow(item)) continue;
    if (String(item?.churchId || "").trim() !== viewerChurchId) continue;

    const slots = Array.isArray(item?.scheduleSlots) ? item.scheduleSlots : [];
    if (!slots.length) continue;
    slots.forEach((slot: any, index: number) => {
      const { startMs, endMs, isLiveNow } = getSlotRingWindow(slot, index, nowMs);
      if (!startMs || endMs <= nowMs) return;

      const startsInMin = Math.ceil((startMs - nowMs) / 60000);
      const isSoon = startsInMin >= 0 && startsInMin <= 30;
      if (!isLiveNow && !isSoon) return;

      upcoming.push({
        item,
        slot,
        index,
        startMs,
        endMs,
        startsInMin,
        isLiveNow,
        color: ringColorForSlot(startMs, endMs, nowMs),
      });
    });
  }

  upcoming.sort((a, b) => a.startMs - b.startMs);
  return upcoming[0] || null;
}

function computePersonalAlertFromClaimHints(
  viewerUserId: string,
  nowMs: number
): ScheduleRingAlert | null {
  const hints = getRingClaimHints(viewerUserId);
  const alerts: ScheduleRingAlert[] = [];

  for (const hint of hints) {
    const startMs = Number(hint.startMs || 0);
    const endMs = Number(hint.endMs || 0);
    if (!isPersonalRingWindow(startMs, endMs, nowMs)) continue;

    const item =
      hint.item ||
      ({
        id: hint.feedId,
        sourceScheduleId: hint.baseFeedId,
        churchId: hint.churchId,
      } as any);

    const slot =
      hint.slot ||
      ({
        id: hint.slotId,
        slot: hint.slotNumber,
        slotNumber: hint.slotNumber,
        startMs,
        endMs,
        claimedByUserId: hint.userId,
        claimedByName: hint.name,
        claimedByAvatar: hint.avatarUri,
        claimedBy: {
          userId: hint.userId,
          name: hint.name,
          role: hint.role,
          avatarUri: hint.avatarUri,
          claimedAt: hint.claimedAt,
        },
      } as any);

    const alert = buildClaimedPersonalAlert(
      item,
      slot,
      Math.max(0, Number(hint.slotNumber || 1) - 1),
      nowMs,
      hint.baseFeedId,
      hint.slotNumber
    );

    if (alert) {
      console.log("KRISTO_RING_PERSONAL_SLOT_MATCH", {
        source: "claim-hint",
        feedId: hint.baseFeedId,
        slotId: hint.slotId,
        slotNumber: hint.slotNumber,
        startMs,
        endMs,
        isLiveNow: alert.isLiveNow,
      });
      alerts.push(alert);
    }
  }

  alerts.sort((a, b) => a.startMs - b.startMs);
  return alerts[0] || null;
}

function computePersonalAlertFromClaimStore(
  viewerUserId: string,
  nowMs: number,
  rows: any[]
): ScheduleRingAlert | null {
  const uid = String(viewerUserId || "").trim();
  if (!uid) return null;

  const alerts: ScheduleRingAlert[] = [];
  const hints = getRingClaimHints(uid);

  for (const entry of getUserClaimedSlotEntries(uid)) {
    const feedId = baseFeedId(String(entry?.postId || ""));
    const slotId = String(entry?.slotId || "").trim();
    if (!feedId || !slotId) continue;

    const hint = hints.find(
      (candidate) =>
        String(candidate.slotId || "").trim() === slotId &&
        baseFeedId(String(candidate.baseFeedId || candidate.feedId || "")) === feedId
    );
    const startMs = Number(hint?.startMs || entry?.startMs || 0);
    const endMs = Number(hint?.endMs || entry?.endMs || 0);

    const item =
      rows.find((row) => {
        const rowFeedId = baseFeedId(String(row?.sourceScheduleId || row?.id || ""));
        return rowFeedId === feedId;
      }) ||
      ({
        id: feedId,
        sourceScheduleId: feedId,
        churchId: String(entry?.churchId || entry?.targetChurchId || "").trim(),
        title: "Live Schedule",
      } as any);

    const slots = Array.isArray(item?.scheduleSlots) ? item.scheduleSlots : [];
    const matchedSlot =
      slots.find(
        (slot: any) => String(slot?.id || slot?.slotId || "").trim() === slotId
      ) ||
      normalizeLiveScheduleSlots([
        {
          id: slotId,
          slotId,
          claimedByUserId: entry.userId,
          claimedByName: entry.name,
          slot: Number(entry?.slotNumber || hint?.slotNumber || 1),
          startMs: startMs || undefined,
          endMs: endMs || undefined,
          ...(hint?.slot && typeof hint.slot === "object" ? hint.slot : {}),
        },
      ])[0];

    const slotIndex = Math.max(0, Number(entry?.slotNumber || matchedSlot?.slot || 1) - 1);
    const alert = buildClaimedPersonalAlert(
      item,
      matchedSlot,
      slotIndex,
      nowMs,
      feedId,
      Number(entry?.slotNumber || matchedSlot?.slot || slotIndex + 1)
    );

    if (alert) {
      console.log("KRISTO_RING_PERSONAL_SLOT_MATCH", {
        source: "claim-store",
        feedId,
        slotId,
        slotNumber: alert.slotNumber,
        startMs: alert.startMs,
        endMs: alert.endMs,
        isLiveNow: alert.isLiveNow,
      });
      alerts.push(alert);
    }
  }

  alerts.sort((a, b) => a.startMs - b.startMs);
  return alerts[0] || null;
}

export function computePersonalScheduleTabAlert(options: {
  rows: any[];
  viewerUserId: string;
  nowMs?: number;
}): ScheduleRingAlert | null {
  const viewerUserId = String(options.viewerUserId || "").trim();
  const nowMs = options.nowMs ?? Date.now();
  const personalUpcoming: ScheduleRingAlert[] = [];

  for (const item of options.rows) {
    if (!isMediaScheduleRow(item)) continue;

    const feedId = baseFeedId(String(item?.sourceScheduleId || item?.id || ""));
    const slots = Array.isArray(item?.scheduleSlots) ? item.scheduleSlots : [];

    slots.forEach((slot: any, index: number) => {
      const slotClaimedByMe = scheduleSlotClaimUserId(slot) === viewerUserId;
      if (!slotClaimedByMe) return;

      const { startMs, endMs, isLiveNow } = getSlotRingWindow(slot, index, nowMs);
      if (!isPersonalRingWindow(startMs, endMs, nowMs)) return;

      const startsInMin = Math.ceil((startMs - nowMs) / 60000);
      const alert = buildClaimedPersonalAlert(item, slot, index, nowMs, feedId);

      if (alert) {
        console.log("KRISTO_RING_PERSONAL_SLOT_MATCH", {
          source: "feed-row",
          feedId,
          slotId: String(slot?.id || ""),
          slotNumber: alert.slotNumber,
          startMs,
          endMs,
          isLiveNow,
          startsInMin,
        });
        personalUpcoming.push(alert);
        return;
      }

      const savedByMe =
        item?.saved === true ||
        item?.isSaved === true ||
        item?.savedByMe === true ||
        slot?.saved === true ||
        slot?.savedByMe === true;
      const likedByMe =
        item?.liked === true ||
        item?.likedByMe === true ||
        slot?.liked === true ||
        slot?.likedByMe === true;

      let match = "";
      let icon: ScheduleRingAlert["icon"] = "notifications";
      let color = "#38BDF8";

      if (savedByMe && startsInMin <= 15) {
        match = "saved";
        icon = "bookmark";
        color = startsInMin <= 5 ? "#F59E0B" : "#A78BFA";
      } else if (likedByMe && startsInMin <= 5) {
        match = "liked";
        icon = "heart";
        color = "#FF5A7A";
      }

      if (!match) return;

      personalUpcoming.push({
        item,
        slot,
        index,
        startMs,
        endMs,
        startsInMin,
        isLiveNow,
        match,
        icon,
        color,
        feedId,
      });
    });
  }

  personalUpcoming.sort((a, b) => {
    const pri: Record<string, number> = { claimed: 0, saved: 1, liked: 2 };
    return (pri[a.match || ""] ?? 9) - (pri[b.match || ""] ?? 9) || a.startMs - b.startMs;
  });

  const feedPersonal = personalUpcoming[0] || null;
  return feedPersonal;
}

export function recomputeScheduleRingsFromRows(options: {
  rows: any[];
  viewerUserId: string;
  viewerChurchId: string;
  nowMs?: number;
  source?: string;
  backendFeedLoaded?: boolean;
}) {
  const nowMs = options.nowMs ?? Date.now();
  const rows = mergeFeedRowsForScheduleScan(options.rows, {
    backendFeedLoaded: options.backendFeedLoaded,
    churchId: options.viewerChurchId,
    viewerUserId: options.viewerUserId,
  });

  const personal = computePersonalScheduleTabAlert({
    rows,
    viewerUserId: options.viewerUserId,
    nowMs,
  });

  const church = computeChurchScheduleTabLive({
    rows,
    viewerChurchId: options.viewerChurchId,
    nowMs,
  });

  console.log("KRISTO_LIVE_RING_FAST_SYNC", {
    source: options.source || "local",
    hasChurchLive: !!church,
    isLiveNow: church?.isLiveNow ?? false,
    startsInMin: church?.startsInMin ?? null,
    mergedRowCount: rows.length,
  });

  console.log("KRISTO_PROFILE_RING_RECOMPUTE", {
    source: options.source || "local",
    hasPersonal: !!personal,
    personalMatch: personal?.match || "",
    feedId: personal?.feedId || "",
    slotNumber: personal?.slotNumber ?? null,
    startsInMin: personal?.startsInMin ?? null,
    isLiveNow: personal?.isLiveNow ?? false,
    hasChurchLive: !!church,
  });

  if (personal?.match === "claimed") {
    console.log("KRISTO_NEAR_LIVE_SLOT_DETECTED", {
      source: options.source || "local",
      feedId: personal.feedId || "",
      slotNumber: personal.slotNumber ?? null,
      slotId: String(personal.slot?.id || ""),
      startsInMin: personal.startsInMin,
      isLiveNow: personal.isLiveNow,
      startMs: personal.startMs,
      endMs: personal.endMs,
    });
  }

  return { personal, church, rows };
}

export function logMeTabRingDecision(args: {
  currentUserId: string;
  personal: ScheduleRingAlert | null;
  source: string;
}) {
  const personal = args.personal;
  const nowMs = Date.now();

  if (!personal || personal.match !== "claimed") {
    console.log("KRISTO_ME_TAB_RING_DECISION", {
      currentUserId: args.currentUserId,
      claimedSlotUserId: personal ? scheduleSlotClaimUserId(personal.slot) || null : null,
      slotId: String(personal?.slot?.id || personal?.slot?.slotId || ""),
      slotNumber: personal?.slotNumber ?? null,
      startMs: personal?.startMs ?? 0,
      endMs: personal?.endMs ?? 0,
      isLiveNow: personal?.isLiveNow ?? false,
      startsInMin: personal?.startsInMin ?? null,
      source: args.source,
      ringVisible: false,
      ringMode: "hidden",
    });
    return;
  }

  const ringVisible = isPersonalRingWindow(personal.startMs, personal.endMs, nowMs);
  const ringMode = personal.isLiveNow
    ? "live"
    : personal.startsInMin <= 30
      ? "upcoming"
      : "hidden";

  console.log("KRISTO_ME_TAB_RING_DECISION", {
    currentUserId: args.currentUserId,
    claimedSlotUserId: scheduleSlotClaimUserId(personal.slot) || args.currentUserId,
    slotId: String(personal.slot?.id || personal.slot?.slotId || ""),
    slotNumber: personal.slotNumber ?? null,
    startMs: personal.startMs,
    endMs: personal.endMs,
    isLiveNow: personal.isLiveNow,
    startsInMin: personal.startsInMin,
    source: args.source,
    ringVisible: ringVisible && personal.match === "claimed",
    ringMode: ringVisible ? ringMode : "hidden",
  });
}

export type ProfileClaimedScheduleSlot = {
  id?: string;
  slotId?: string;
  slot?: number;
  slotNumber?: number;
  claimedByUserId?: string;
  claimedByName?: string;
  startMs?: number;
  endMs?: number;
  startTime?: string;
  endTime?: string;
  meetingDate?: string;
  feedTitle?: string;
  __feedItem?: any;
  __slotIndex?: number;
  __source?: string;
};

function scheduleRowChurchId(item: any): string {
  return String(item?.churchId || item?.sourceChurchId || item?.church?.id || "").trim();
}

function scheduleRowMatchesChurch(item: any, churchId: string): boolean {
  const cid = String(churchId || "").trim();
  if (!cid) return false;
  const rowChurch = scheduleRowChurchId(item);
  return !rowChurch || rowChurch === cid;
}

function mergeProfileFeedRows(...sources: any[][]): any[] {
  const byKey = new Map<string, any>();
  for (const rows of sources) {
    for (const row of rows) {
      if (!row || typeof row !== "object") continue;
      const key =
        String(row?.id || row?.sourceScheduleId || row?.feedId || "").trim() ||
        `${scheduleRowChurchId(row)}|${String(row?.title || row?.mediaName || "")}`;
      if (!key) continue;
      byKey.set(key, row);
    }
  }
  return Array.from(byKey.values());
}

function collectProfileScheduleFeedItems(options: {
  explicitFeedRows: any[];
  homeFeedRows: any[];
  churchId: string;
  nowMs: number;
}): { items: any[]; canonicalFeedId: string | null } {
  const churchId = String(options.churchId || "").trim();
  const homeFeedRows = Array.isArray(options.homeFeedRows) ? options.homeFeedRows : [];
  const explicitFeedRows = Array.isArray(options.explicitFeedRows) ? options.explicitFeedRows : [];
  const mergedRows = mergeProfileFeedRows(explicitFeedRows, homeFeedRows);

  const canonical = resolveCanonicalMediaScheduleForGuests(
    homeFeedRows,
    explicitFeedRows,
    churchId,
    options.nowMs
  );

  const items: any[] = [];
  const seen = new Set<string>();

  const pushItem = (item: any) => {
    if (!item || !isMediaScheduleRow(item)) return;
    if (!scheduleRowMatchesChurch(item, churchId)) return;
    const key = baseFeedId(String(item?.sourceScheduleId || item?.id || ""));
    if (key && seen.has(key)) return;
    if (key) seen.add(key);
    items.push(item);
  };

  if (canonical) pushItem(canonical);
  for (const row of mergedRows) pushItem(row);

  return {
    items,
    canonicalFeedId: canonical
      ? baseFeedId(String(canonical?.sourceScheduleId || canonical?.id || "")) || null
      : null,
  };
}

function profileClaimedSlotKey(slot: any, index = 0): string {
  const feedKey = baseFeedId(
    String(slot?.__feedItem?.sourceScheduleId || slot?.__feedItem?.id || "")
  );
  const slotKey = String(slot?.id || slot?.slotId || slot?.slot || slot?.slotNumber || index);
  return `${feedKey}|${slotKey}`;
}

function resolveFeedItemForClaimEntry(
  entry: any,
  feedRows: any[],
  churchId: string
): any | null {
  const postId = String(entry?.postId || "").trim();
  if (!postId) return null;

  const aliases = new Set(collectScheduleAliasIds(postId, feedRows));
  return (
    feedRows.find((row) => {
      if (!scheduleRowMatchesChurch(row, churchId)) return false;
      const rowId = String(row?.id || "").trim();
      const sourceId = String(row?.sourceScheduleId || "").trim();
      return (
        aliases.has(rowId) ||
        aliases.has(sourceId) ||
        aliases.has(baseFeedId(rowId)) ||
        aliases.has(baseFeedId(sourceId))
      );
    }) || null
  );
}

/** Active/upcoming media schedule slots claimed by the viewer in their church. */
export function buildProfileClaimedSchedules(options: {
  viewerUserId: string;
  churchId: string;
  feedRows?: any[];
  nowMs?: number;
}): ProfileClaimedScheduleSlot[] {
  const viewerUserId = String(options.viewerUserId || "").trim();
  const churchId = String(options.churchId || "").trim();
  const nowMs = options.nowMs ?? Date.now();
  const homeFeedRows = feedList() as any[];
  const explicitFeedRows = Array.isArray(options.feedRows) ? options.feedRows : [];
  const { items: scheduleItems, canonicalFeedId } = collectProfileScheduleFeedItems({
    explicitFeedRows,
    homeFeedRows,
    churchId,
    nowMs,
  });

  let totalScheduleSlots = 0;
  for (const item of scheduleItems) {
    totalScheduleSlots += Array.isArray(item?.scheduleSlots) ? item.scheduleSlots.length : 0;
  }

  console.log("KRISTO_PROFILE_CLAIMED_COUNT_BUILD", {
    viewerUserId,
    churchId,
    feedRowCount: scheduleItems.length,
    totalScheduleSlots,
    canonicalFeedId,
  });

  if (!viewerUserId || !churchId) {
    console.log("KRISTO_PROFILE_CLAIMED_COUNT_SOURCE", {
      currentUserId: viewerUserId,
      totalScheduleSlots,
      claimedByMeCount: 0,
      feedIds: [],
      slotIds: [],
      reason: "missing-viewer-or-church",
    });
    return [];
  }

  const merged: ProfileClaimedScheduleSlot[] = [];

  for (const item of scheduleItems) {
    const feedId = resolveCanonicalScheduleFeedId(
      String(item?.sourceScheduleId || item?.id || ""),
      mergeProfileFeedRows(explicitFeedRows, homeFeedRows)
    );
    const slots = normalizeLiveScheduleSlots(
      Array.isArray(item?.scheduleSlots) ? item.scheduleSlots : []
    );
    const feedTitle = String(item?.title || item?.mediaName || "Live Schedule").trim();

    slots.forEach((slot: any, index: number) => {
      if (!isSlotClaimedByViewer(slot, viewerUserId, feedId || baseFeedId(item?.id))) return;
      if (!isCountableProfileClaimedSlot(slot, index, nowMs)) return;

      const window = resolveMediaSlotTimeWindow(slot, nowMs);
      console.log("KRISTO_PROFILE_CLAIMED_SLOT_COUNTED", {
        source: "feed",
        feedId: feedId || baseFeedId(item?.id),
        slotId: String(slot?.id || slot?.slotId || ""),
        slotNumber: Number(slot?.slot || slot?.slotNumber || index + 1),
        startMs: window.startMs,
        endMs: window.endMs,
        claimedByUserId: scheduleSlotClaimUserId(slot),
      });

      merged.push({
        ...slot,
        startMs: window.startMs,
        endMs: window.endMs,
        feedTitle,
        __feedItem: item,
        __slotIndex: index,
        __source: "feed",
      });
    });
  }

  for (const entry of getUserClaimedSlotEntries(viewerUserId)) {
    const feedRows = mergeProfileFeedRows(explicitFeedRows, homeFeedRows);
    const feedId = baseFeedId(String(entry?.postId || ""));
    const slotId = String(entry?.slotId || "").trim();
    const authoritative = findAuthoritativeScheduleSlot(feedRows, feedId, slotId);
    if (!authoritative) continue;

    const { item: feedItem, slot: matchedSlot, index: slotIndex } = authoritative;
    const resolvedFeedId = feedItem
      ? resolveCanonicalScheduleFeedId(
          String(feedItem?.sourceScheduleId || feedItem?.id || entry?.postId || ""),
          feedRows
        )
      : feedId;

    if (!isSlotClaimedByViewer(matchedSlot, viewerUserId, resolvedFeedId || feedId)) continue;
    if (!isCountableProfileClaimedSlot(matchedSlot, slotIndex, nowMs)) continue;

    const window = resolveMediaSlotTimeWindow(matchedSlot, nowMs);
    console.log("KRISTO_PROFILE_CLAIMED_SLOT_COUNTED", {
      source: "claim-store",
      feedId: resolvedFeedId || feedId,
      slotId,
      slotNumber: Number(matchedSlot?.slot || matchedSlot?.slotNumber || slotIndex + 1),
      startMs: window.startMs,
      endMs: window.endMs,
      claimedByUserId: scheduleSlotClaimUserId(matchedSlot),
    });

    merged.push({
      ...matchedSlot,
      startMs: window.startMs,
      endMs: window.endMs,
      feedTitle: String(feedItem?.title || feedItem?.mediaName || "Claimed slot").trim(),
      __feedItem: feedItem || undefined,
      __slotIndex: slotIndex,
      __source: "claim-store",
    });
  }

  for (const hint of getRingClaimHints(viewerUserId)) {
    const feedRows = mergeProfileFeedRows(explicitFeedRows, homeFeedRows);
    const feedId = baseFeedId(String(hint?.baseFeedId || hint?.feedId || ""));
    const slotId = String(hint?.slotId || "").trim();
    const authoritative = findAuthoritativeScheduleSlot(feedRows, feedId, slotId);
    if (!authoritative) continue;

    const { item: feedItem, slot, index: slotIndex } = authoritative;
    if (!isSlotClaimedByViewer(slot, viewerUserId, feedId)) continue;
    if (!isCountableProfileClaimedSlot(slot, slotIndex, nowMs)) continue;

    const window = resolveMediaSlotTimeWindow(slot, nowMs);
    console.log("KRISTO_PROFILE_CLAIMED_SLOT_COUNTED", {
      source: "ring-hint",
      feedId,
      slotId: String(hint.slotId || ""),
      slotNumber: Number(hint.slotNumber || slotIndex + 1),
      startMs: window.startMs,
      endMs: window.endMs,
      claimedByUserId: scheduleSlotClaimUserId(slot),
    });

    merged.push({
      ...slot,
      startMs: window.startMs,
      endMs: window.endMs,
      feedTitle: String(feedItem?.title || feedItem?.mediaName || hint.item?.title || "Live Schedule").trim(),
      __feedItem: feedItem || hint.item,
      __slotIndex: slotIndex,
      __source: "ring-hint",
    });
  }

  const seen = new Set<string>();
  const result = merged
    .filter((slot, index) => {
      const key = profileClaimedSlotKey(slot, Number(slot.__slotIndex ?? index));
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .sort((a, b) => {
      const aStart = Number(
        a.startMs || resolveMediaSlotTimeWindow(a, nowMs).startMs
      );
      const bStart = Number(
        b.startMs || resolveMediaSlotTimeWindow(b, nowMs).startMs
      );
      return aStart - bStart;
    });

  console.log("KRISTO_PROFILE_CLAIMED_COUNT_SOURCE", {
    currentUserId: viewerUserId,
    totalScheduleSlots,
    claimedByMeCount: result.length,
    feedIds: [...new Set(result.map((row) => baseFeedId(String(row?.__feedItem?.sourceScheduleId || row?.__feedItem?.id || ""))).filter(Boolean))],
    slotIds: result.map((row) => String(row?.id || row?.slotId || "")).filter(Boolean),
    canonicalFeedId,
    fromFeed: result.filter((row) => row.__source === "feed").length,
    fromClaimStore: result.filter((row) => row.__source === "claim-store").length,
    fromRingHint: result.filter((row) => row.__source === "ring-hint").length,
  });

  console.log("KRISTO_PROFILE_CLAIMED_COUNT_UPDATED", {
    viewerUserId,
    churchId,
    count: result.length,
    fromFeed: result.filter((row) => row.__source === "feed").length,
    fromClaimStore: result.filter((row) => row.__source === "claim-store").length,
    fromRingHint: result.filter((row) => row.__source === "ring-hint").length,
  });

  return result;
}
