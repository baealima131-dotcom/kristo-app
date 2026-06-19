import { isMediaScheduleFeedItem } from "@/lib/mediaScheduleFeedIdentify";
import { enrichScheduleSlot } from "@/lib/scheduleSlotUtils";

export const NEAR_LIVE_WINDOW_MS = 30 * 60 * 1000;

function isMediaScheduleRow(item: any): boolean {
  return isMediaScheduleFeedItem(item);
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

function isOpenClaimableScheduleSlot(slot: any, index = 0, nowMs = Date.now()): boolean {
  if (!slot || typeof slot !== "object") return false;

  const status = String(slot?.status || "").toLowerCase();
  if (
    status === "claimed" ||
    status === "live" ||
    status === "taken" ||
    status === "closed" ||
    status === "ended"
  ) {
    return false;
  }
  if (slot?.claimed === true || slot?.isClaimed === true) return false;

  const claimedByUserId = String(
    slot?.claimedByUserId || slot?.claimedBy?.userId || ""
  ).trim();
  if (claimedByUserId) return false;

  const claimedBy = slot?.claimedBy;
  if (
    typeof claimedBy === "string" &&
    claimedBy.trim() &&
    claimedBy.trim().toLowerCase() !== "open"
  ) {
    return false;
  }

  const { startMs, endMs } = getSlotRingWindow(slot, index, nowMs);
  if (endMs > 0 && nowMs > endMs) return false;
  if (startMs > nowMs) return true;
  if (endMs > nowMs) return true;
  return false;
}

/** Protect open media schedule slots that members can still claim (not only near-live). */
export function findProtectedClaimableSchedule(
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
      if (isOpenClaimableScheduleSlot(slot, index, nowMs)) {
        return { item, slot, index };
      }
    }
  }

  return null;
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
