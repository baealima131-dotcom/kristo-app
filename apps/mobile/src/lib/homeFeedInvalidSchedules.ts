import { feedRemoveWhere } from "@/src/lib/homeFeedStore";
import { baseFeedId } from "@/src/lib/scheduleSlotUtils";

const hiddenInvalidScheduleIds = new Set<string>();
const hiddenInvalidScheduleLogged = new Set<string>();

export function isHiddenInvalidHomeFeedSchedule(scheduleId: string) {
  const id = baseFeedId(String(scheduleId || "").trim());
  return Boolean(id && hiddenInvalidScheduleIds.has(id));
}

/** Permanently hide a schedule with unusable slot times (log once per id). */
export function markHiddenInvalidHomeFeedSchedule(
  row: any,
  source: "backend" | "local" | "api" = "backend"
) {
  const id = baseFeedId(String(row?.id || "").trim());
  if (!id) return;

  hiddenInvalidScheduleIds.add(id);

  if (!hiddenInvalidScheduleLogged.has(id)) {
    hiddenInvalidScheduleLogged.add(id);
    console.log("KRISTO_HOME_FEED_SCHEDULE_HIDDEN_INVALID_TIME", {
      scheduleId: id,
      source,
      slotCount: Array.isArray(row?.scheduleSlots) ? row.scheduleSlots.length : 0,
      pendingBackendSync: row?.pendingBackendSync === true,
    });
  }

  feedRemoveWhere((item) => baseFeedId(String(item?.id || "").trim()) === id);
}
