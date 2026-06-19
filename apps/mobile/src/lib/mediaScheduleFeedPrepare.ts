import { materializeMediaSlotTimeFields } from "@/src/lib/mediaScheduleSlotTimes";

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
