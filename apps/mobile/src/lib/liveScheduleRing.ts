import { feedList, getRingClaimHints, getUserClaimedSlotEntries } from "@/src/lib/homeFeedStore";
import { isMediaScheduleFeedItem } from "@/src/lib/mediaScheduleLock";
import { baseFeedId, collectScheduleAliasIds, enrichScheduleSlot, resolveCanonicalScheduleFeedId } from "@/src/lib/scheduleSlotUtils";

export const NEAR_LIVE_WINDOW_MS = 30 * 60 * 1000;
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
  if (!item || typeof item !== "object") return false;
  const source = String(item?.source || "").toLowerCase();
  const scheduleType = String(item?.scheduleType || "").toLowerCase();
  return (
    isMediaScheduleFeedItem(item) ||
    source.includes("media-schedule") ||
    scheduleType.includes("media-live-slots")
  );
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

export function getSlotRingWindow(slot: any, index = 0, nowMs = Date.now()) {
  const enriched = enrichScheduleSlot(slot, index, nowMs);
  const startMs = Number(slot?.startMs) > 0 ? Number(slot.startMs) : enriched.startMs;
  const endMs = Number(slot?.endMs) > 0 ? Number(slot.endMs) : enriched.endMs;
  const isLiveNow = startMs > 0 && endMs > 0 && nowMs >= startMs && nowMs <= endMs;
  const msUntilStart = startMs > nowMs ? startMs - nowMs : 0;

  return {
    startMs,
    endMs,
    isLiveNow,
    msUntilStart,
  };
}

export function isPersonalRingWindow(startMs: number, endMs: number, nowMs: number): boolean {
  if (!startMs || endMs <= nowMs) return false;
  if (nowMs >= startMs && nowMs <= endMs) return true;
  const msUntilStart = startMs - nowMs;
  return msUntilStart >= 0 && msUntilStart <= NEAR_LIVE_WINDOW_MS;
}

export function isNearLiveOrActiveSlot(slot: any, index = 0, nowMs = Date.now()): boolean {
  const { startMs, endMs } = getSlotRingWindow(slot, index, nowMs);
  return isPersonalRingWindow(startMs, endMs, nowMs);
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

export function mergeFeedRowsForScheduleScan(backendRows: any[] = []): any[] {
  const localRows = (() => {
    try {
      return feedList() as any[];
    } catch {
      return [];
    }
  })();

  const byBase = new Map<string, any>();
  const mergedRows = [...localRows, ...backendRows];

  for (const row of mergedRows) {
    const seed = String(row?.sourceScheduleId || row?.id || "");
    const key =
      resolveCanonicalScheduleFeedId(seed, mergedRows) ||
      baseFeedId(seed) ||
      String(row?.id || "");
    if (!key) continue;

    const prev = byBase.get(key);
    if (!prev) {
      byBase.set(key, row);
      continue;
    }

    const prevClaimed = (Array.isArray(prev.scheduleSlots) ? prev.scheduleSlots : []).filter(
      (slot: any) => String(slot?.claimedByUserId || slot?.claimedBy?.userId || "").trim()
    ).length;
    const nextClaimed = (Array.isArray(row.scheduleSlots) ? row.scheduleSlots : []).filter(
      (slot: any) => String(slot?.claimedByUserId || slot?.claimedBy?.userId || "").trim()
    ).length;
    const prevUpdated = Number(prev.updatedAt || prev.publishedAt || 0);
    const nextUpdated = Number(row.updatedAt || row.publishedAt || 0);

    if (nextClaimed > prevClaimed || (nextClaimed === prevClaimed && nextUpdated >= prevUpdated)) {
      byBase.set(key, row);
    } else {
      byBase.set(key, prev);
    }
  }

  return Array.from(byBase.values());
}

export function findProtectedNearLiveSchedule(
  items: any[],
  churchId: string,
  nowMs = Date.now()
): { item: any; slot: any; index: number } | null {
  const cid = String(churchId || "").trim();
  if (!cid) return null;

  for (const item of items) {
    if (!isMediaScheduleRow(item)) continue;
    if (String(item?.churchId || "").trim() !== cid) continue;

    const slots = Array.isArray(item?.scheduleSlots) ? item.scheduleSlots : [];
    for (let index = 0; index < slots.length; index += 1) {
      const slot = slots[index];
      if (isNearLiveOrActiveSlot(slot, index, nowMs)) {
        return { item, slot, index };
      }
    }
  }

  return null;
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
    if (!isMediaScheduleRow(item)) continue;
    if (String(item?.churchId || "").trim() !== viewerChurchId) continue;

    const slots = Array.isArray(item?.scheduleSlots) ? item.scheduleSlots : [];
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
      const slotClaimedByMe = slotClaimedByUser(slot, viewerUserId, feedId);
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
  const hintPersonal = computePersonalAlertFromClaimHints(viewerUserId, nowMs);

  if (feedPersonal?.match === "claimed") return feedPersonal;
  if (hintPersonal) return hintPersonal;
  return feedPersonal;
}

export function recomputeScheduleRingsFromRows(options: {
  rows: any[];
  viewerUserId: string;
  viewerChurchId: string;
  nowMs?: number;
  source?: string;
}) {
  const nowMs = options.nowMs ?? Date.now();
  const rows = mergeFeedRowsForScheduleScan(options.rows);

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
