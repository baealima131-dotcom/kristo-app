import {
  isMediaScheduleFeedItemClosed,
} from "@/src/lib/mediaScheduleFeedPredicates";
import {
  findActiveMediaScheduleForChurch,
  findMediaScheduleFeedForChurch,
} from "@/src/lib/mediaScheduleChurchQueries";
import { isPendingLocalMediaScheduleRow } from "@/src/lib/mediaSchedulePendingRegistry";
import { feedList } from "@/src/lib/homeFeedStore";
import {
  baseFeedId,
  resolveCanonicalScheduleFeedId,
} from "@/src/lib/scheduleSlotUtils";

function hydrateCanonicalGuestScheduleFromLocal(
  schedule: any,
  homeFeedItems: any[],
  backendFeedItems: any[],
  churchId: string
) {
  if (!schedule) return schedule;
  const slots = Array.isArray(schedule?.scheduleSlots) ? schedule.scheduleSlots : [];
  if (slots.length > 0) return schedule;

  const seed = String(schedule?.sourceScheduleId || schedule?.id || "").trim();
  const merged = [...(feedList() as any[]), ...homeFeedItems, ...backendFeedItems];
  const canonicalId =
    resolveCanonicalScheduleFeedId(seed, merged) || baseFeedId(seed) || seed;

  for (const row of merged) {
    const rowSeed = String(row?.sourceScheduleId || row?.id || "").trim();
    const rowCanon =
      resolveCanonicalScheduleFeedId(rowSeed, merged) || baseFeedId(rowSeed);
    if (rowCanon !== canonicalId && rowSeed !== seed && baseFeedId(rowSeed) !== canonicalId) {
      continue;
    }
    const rowCid = String(row?.churchId || "").trim();
    if (rowCid && rowCid !== churchId) continue;
    const rowSlots = Array.isArray(row?.scheduleSlots) ? row.scheduleSlots : [];
    if (rowSlots.length > 0) {
      return { ...schedule, scheduleSlots: rowSlots };
    }
  }

  return schedule;
}

export function resolveCanonicalMediaScheduleForGuests(
  homeFeedItems: any[],
  backendFeedItems: any[],
  churchId: string,
  nowMs = Date.now()
) {
  const cid = String(churchId || "").trim();
  if (!cid) return null;

  const backendActive = backendFeedItems.length
    ? findActiveMediaScheduleForChurch(backendFeedItems, cid, {
        strictChurch: true,
        nowMs,
      })
    : null;

  const backendScheduleFeed = backendFeedItems.length
    ? findMediaScheduleFeedForChurch(backendFeedItems, cid, { strictChurch: true, nowMs })
    : null;

  let backendSchedule = backendActive || backendScheduleFeed;
  if (backendSchedule && !isPendingLocalMediaScheduleRow(backendSchedule, cid)) {
    backendSchedule = hydrateCanonicalGuestScheduleFromLocal(
      backendSchedule,
      homeFeedItems,
      backendFeedItems,
      cid
    );
    return backendSchedule;
  }

  if (!backendFeedItems.length) {
    const homeActive = findActiveMediaScheduleForChurch(homeFeedItems, cid, {
      strictChurch: true,
      nowMs,
    });
    if (homeActive && !isMediaScheduleFeedItemClosed(homeActive)) {
      return homeActive;
    }
  }

  if (backendSchedule) {
    return hydrateCanonicalGuestScheduleFromLocal(
      backendSchedule,
      homeFeedItems,
      backendFeedItems,
      cid
    );
  }

  return null;
}
