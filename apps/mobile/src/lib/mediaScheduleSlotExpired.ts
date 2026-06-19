import { isActiveScheduleSlot } from "@/lib/mediaScheduleSlotActive";

type AnyFeedItem = Record<string, any>;

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
