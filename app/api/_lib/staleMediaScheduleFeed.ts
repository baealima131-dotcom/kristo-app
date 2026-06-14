import { deleteFeedItemById, getFeedItemById } from "@/app/api/_lib/store/feedDb";
import { endChurchLiveSessionsForSchedule } from "@/app/api/_lib/churchLiveControl";
import {
  getActiveScheduleSlots,
  isMediaScheduleFeedItemClosed,
  isMediaScheduleForChurch,
} from "@/lib/mediaScheduleLock";

type AnyFeedItem = Record<string, any>;

export function scanMediaScheduleRowForLockServer(
  item: AnyFeedItem | null | undefined,
  nowMs = Date.now()
) {
  const feedId = String(item?.id || item?.sourceScheduleId || "").trim();
  const slots = Array.isArray(item?.scheduleSlots) ? item.scheduleSlots : [];
  const activeSlots = item ? getActiveScheduleSlots(item, nowMs) : [];
  const activeSlotCount = activeSlots.length;
  const closed = item ? isMediaScheduleFeedItemClosed(item) : false;
  const renderedInLiveSlots = closed ? 0 : activeSlotCount;
  const protectedRow = !closed && activeSlotCount > 0;

  return {
    feedId,
    slotCount: slots.length,
    activeSlotCount,
    renderedInLiveSlots,
    protected: protectedRow,
    reason: closed
      ? "ended-or-deleted"
      : protectedRow
        ? "active-slots"
        : slots.length > 0
          ? "inactive-slots"
          : "empty-slots",
  };
}

export async function cleanupStaleMediaScheduleRowsForChurch(input: {
  churchId: string;
  items: AnyFeedItem[];
  reason?: string;
  deletedBy?: string;
  nowMs?: number;
}) {
  const churchId = String(input.churchId || "").trim();
  const nowMs = Number(input.nowMs || Date.now());
  const cleanedFeedIds: string[] = [];

  for (const item of input.items) {
    if (!isMediaScheduleForChurch(item, churchId)) continue;

    const scan = scanMediaScheduleRowForLockServer(item, nowMs);
    console.log("KRISTO_ACTIVE_SCHEDULE_SCAN", { churchId, ...scan });

    if (scan.protected) continue;
    if (isMediaScheduleFeedItemClosed(item)) continue;

    const feedId = String(item?.id || "").trim();
    if (!feedId) continue;

    const result = await endStaleMediaScheduleFeedItem({
      postId: feedId,
      churchId,
      reason: String(input.reason || "cleanup-stale-media-schedule"),
      deletedBy: input.deletedBy,
    });

    if (result.ok && result.deleted) {
      cleanedFeedIds.push(feedId);
    }
  }

  return { cleanedFeedIds };
}

export async function endStaleMediaScheduleFeedItem(input: {
  postId: string;
  churchId: string;
  reason?: string;
  deletedBy?: string;
}) {
  const postId = String(input.postId || "").trim();
  const churchId = String(input.churchId || "").trim();
  const reason = String(input.reason || "end-stale-media-schedule").trim();

  console.log("KRISTO_STALE_SCHEDULE_CLEANUP_START", {
    feedId: postId,
    churchId,
    reason,
  });

  if (!postId) {
    const result = { ok: false as const, error: "postId is required", feedId: "", deleted: false };
    console.log("KRISTO_STALE_SCHEDULE_CLEANUP_RESULT", result);
    return result;
  }

  const item = await getFeedItemById(postId);
  if (!item) {
    const result = {
      ok: false as const,
      error: "Feed item not found",
      feedId: postId,
      deleted: false,
    };
    console.log("KRISTO_STALE_SCHEDULE_CLEANUP_RESULT", result);
    return result;
  }

  const itemChurchId = String(item.churchId || churchId || "").trim();
  if (churchId && itemChurchId && itemChurchId !== churchId) {
    const result = {
      ok: false as const,
      error: "Feed item not in your church",
      feedId: postId,
      deleted: false,
    };
    console.log("KRISTO_STALE_SCHEDULE_CLEANUP_RESULT", result);
    return result;
  }

  if (!isMediaScheduleForChurch(item, itemChurchId || churchId)) {
    const result = {
      ok: false as const,
      error: "Not a media schedule feed item",
      feedId: postId,
      deleted: false,
    };
    console.log("KRISTO_STALE_SCHEDULE_CLEANUP_RESULT", result);
    return result;
  }

  const scheduleLiveId = String(
    item.sourceScheduleId || item.liveId || item.id || postId
  ).trim();

  const ended = await endChurchLiveSessionsForSchedule({
    churchId: itemChurchId || churchId,
    liveId: scheduleLiveId,
    reason,
  });

  const deleted = await deleteFeedItemById(postId);

  const result = {
    ok: true as const,
    feedId: postId,
    churchId: itemChurchId || churchId,
    deleted,
    endedLiveKeys: ended.endedKeys,
    reason,
    clearedBy: String(input.deletedBy || "").trim() || null,
  };

  console.log("KRISTO_STALE_SCHEDULE_CLEANUP_RESULT", result);
  return result;
}
