import {
  isMediaScheduleFeedItem,
  isMediaScheduleFeedItemClosed,
} from "@/src/lib/mediaScheduleFeedPredicates";
import {
  isMediaSlotEndedOrStale,
  resolveMediaSlotTimeWindow,
} from "@/src/lib/mediaScheduleSlotTimeCore";

type AnyFeedItem = Record<string, any>;

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
