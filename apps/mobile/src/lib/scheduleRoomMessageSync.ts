import {
  clearRoomMessagesCacheAfterDelete,
  invalidateRoomMessagesCache,
} from "@/src/lib/churchMediaRoomCache";
import {
  CHURCH_MEDIA_ROOM_ID,
  resetRoomMessagesRefreshState,
} from "@/src/lib/churchMediaRoomRefresh";
import { markScheduleFeedDeleted } from "@/src/lib/deletedScheduleRegistry";
import { clearHomeFeedApiCache } from "@/src/lib/homeFeedScheduleDirty";
import { feedList, purgeClaimedSlotLocalState } from "@/src/lib/homeFeedStore";
import { getKristoHeaders } from "@/src/lib/kristoHeaders";
import { isMediaScheduleFeedItem } from "@/src/lib/mediaScheduleFeedPredicates";
import { removeAssignmentCardsFromThreads } from "@/src/lib/messagesStore";
import { markRoomMessagesForcePoll } from "@/src/lib/roomMessagesDeletePoll";
import { clearMediaScheduleSlotsOnBackend } from "@/src/lib/staleMediaScheduleCleanup";
import { scheduleSlotClaimUserId } from "@/src/lib/scheduleSlotUtils";

export type ScheduleRoomDeletePayload = {
  roomIds?: string[];
  threadIds?: string[];
  cardIds?: string[];
  clearAllAssignmentCards?: boolean;
  assignmentId?: string;
  scheduleBatchId?: string;
  churchId?: string;
  userId?: string;
  reason?: string;
};

const deleteListeners = new Set<(payload: ScheduleRoomDeletePayload) => void>();

export {
  consumeRoomMessagesForcePoll,
  consumeRoomMessagesForcePollAfterDelete,
} from "@/src/lib/roomMessagesDeletePoll";

export function subscribeScheduleRoomDeleteInvalidation(
  listener: (payload: ScheduleRoomDeletePayload) => void
) {
  deleteListeners.add(listener);
  return () => {
    deleteListeners.delete(listener);
  };
}

function notifyScheduleRoomDeleteInvalidation(payload: ScheduleRoomDeletePayload) {
  for (const listener of Array.from(deleteListeners)) {
    try {
      listener(payload);
    } catch {
      // ignore listener errors
    }
  }
}

export function applyScheduleDeleteToLocalRoom(
  args: ScheduleRoomDeletePayload & { reason: string }
) {
  const threadIds = Array.from(
    new Set(
      [
        ...(args.threadIds || []),
        ...(args.roomIds || []),
        CHURCH_MEDIA_ROOM_ID,
        args.assignmentId,
      ]
        .map((x) => String(x || "").trim())
        .filter(Boolean)
    )
  );

  const cardIds = Array.from(
    new Set((args.cardIds || []).map((x) => String(x || "").trim()).filter(Boolean))
  );

  console.log("KRISTO_SCHEDULE_LOCAL_PURGE", {
    threadIds,
    cardIds,
    clearAllAssignmentCards: !!args.clearAllAssignmentCards,
    scheduleBatchId: args.scheduleBatchId || null,
    reason: args.reason,
  });

  let mode = "cardIds";
  let purgeResult = removeAssignmentCardsFromThreads(threadIds, {
    cardIds,
    clearAllAssignmentCards: args.clearAllAssignmentCards,
    scheduleBatchId: args.scheduleBatchId,
  });

  if (
    purgeResult.removedCount === 0 &&
    (args.clearAllAssignmentCards || cardIds.length > 0 || args.scheduleBatchId)
  ) {
    mode = "clearAllAssignmentCards-fallback";
    purgeResult = removeAssignmentCardsFromThreads(
      [CHURCH_MEDIA_ROOM_ID, ...threadIds],
      { clearAllAssignmentCards: true }
    );
  }

  if (args.clearAllAssignmentCards) {
    mode = "clearAllAssignmentCards";
    const churchRoomPurge = removeAssignmentCardsFromThreads([CHURCH_MEDIA_ROOM_ID], {
      clearAllAssignmentCards: true,
    });
    purgeResult = {
      removedCount: purgeResult.removedCount + churchRoomPurge.removedCount,
      removedIds: [...purgeResult.removedIds, ...churchRoomPurge.removedIds],
    };
  }

  console.log("KRISTO_SCHEDULE_DELETE_PURGE_MATCHES", {
    count: purgeResult.removedCount,
    ids: purgeResult.removedIds,
    mode,
  });

  const churchId = String(args.churchId || "").trim();
  const userId = String(args.userId || "").trim();
  const roomIds = Array.from(
    new Set(
      [...(args.roomIds || []), ...threadIds, CHURCH_MEDIA_ROOM_ID]
        .map((x) => String(x || "").trim())
        .filter(Boolean)
    )
  );

  if (churchId && userId) {
    for (const roomId of roomIds) {
      invalidateRoomMessagesCache(churchId, userId, roomId);
      resetRoomMessagesRefreshState(churchId, userId, roomId);
      markRoomMessagesForcePoll(roomId);
      void clearRoomMessagesCacheAfterDelete(churchId, userId, roomId);
    }

    console.log("KRISTO_ROOM_MESSAGES_CACHE_INVALIDATED_AFTER_DELETE", {
      churchId,
      userId,
      roomIds,
      removedCount: purgeResult.removedCount,
      reason: args.reason,
    });
  }

  const payload: ScheduleRoomDeletePayload = {
    ...args,
    roomIds,
    threadIds,
    cardIds,
  };

  notifyScheduleRoomDeleteInvalidation(payload);

  return {
    removedCount: purgeResult.removedCount,
    removedIds: purgeResult.removedIds,
    threadIds,
    roomIds,
  };
}

function collectScheduleFeedIdsFromBatchDelete(input: {
  scheduleBatchId?: string;
  slots?: any[];
  cardIds?: string[];
}): string[] {
  const feedIds = new Set<string>();
  const batchId = String(input.scheduleBatchId || "").trim();
  if (batchId && batchId !== "batch_1") feedIds.add(batchId);

  for (const slot of Array.isArray(input.slots) ? input.slots : []) {
    const scheduleBatchId = String(slot?.scheduleBatchId || "").trim();
    if (scheduleBatchId) feedIds.add(scheduleBatchId);
    const backendFeedId = String(
      slot?.backendFeedId || slot?.sourceScheduleId || slot?.sourceFeedId || ""
    ).trim();
    if (backendFeedId) feedIds.add(backendFeedId);

    const slotId = String(slot?.id || slot?.cardId || "").trim();
    const batchPrefix = slotId.match(/^(batch_[^-]+)-slot-/)?.[1];
    if (batchPrefix) feedIds.add(batchPrefix);
  }

  for (const cardId of Array.isArray(input.cardIds) ? input.cardIds : []) {
    const id = String(cardId || "").trim();
    const batchPrefix = id.match(/^(batch_[^-]+)-slot-/)?.[1];
    if (batchPrefix) feedIds.add(batchPrefix);
  }

  if (!feedIds.size) {
    const deletedSlotIds = new Set(
      [
        ...(Array.isArray(input.cardIds) ? input.cardIds : []),
        ...(Array.isArray(input.slots) ? input.slots : []).map((slot: any) =>
          String(slot?.id || slot?.cardId || "")
        ),
      ]
        .map((value) => String(value || "").trim())
        .filter(Boolean)
    );

    for (const row of feedList() as any[]) {
      if (!isMediaScheduleFeedItem(row)) continue;
      const rowId = String(row?.id || row?.sourceScheduleId || "").trim();
      const slots = Array.isArray(row?.scheduleSlots) ? row.scheduleSlots : [];
      const overlaps = slots.some((slot: any) =>
        deletedSlotIds.has(String(slot?.id || slot?.slotId || slot?.cardId || "").trim())
      );
      if (overlaps && rowId) feedIds.add(rowId);
    }
  }

  return Array.from(feedIds).filter(Boolean);
}

export async function purgeFeedSchedulesAfterBatchDelete(input: {
  churchId: string;
  userId?: string;
  scheduleBatchId?: string;
  slots?: any[];
  cardIds?: string[];
  reason: string;
}) {
  const churchId = String(input.churchId || "").trim();
  const userId = String(input.userId || "").trim();
  let feedIds = collectScheduleFeedIdsFromBatchDelete(input);
  if (!feedIds.length) {
    const fallbackIds: string[] = [];
    for (const row of feedList() as any[]) {
      if (String(row?.churchId || "").trim() !== churchId) continue;
      if (!isMediaScheduleFeedItem(row)) continue;
      if (row?.isGlobalMediaSlot === true) continue;
      const rowId = String(row?.id || row?.sourceScheduleId || "").trim();
      if (rowId.startsWith("batch_")) fallbackIds.push(rowId);
    }
    feedIds = fallbackIds;
  }

  if (!churchId || !feedIds.length) return { cleared: [] as string[] };

  const headers = getKristoHeaders() as Record<string, string>;
  const cleared: string[] = [];

  for (const feedId of feedIds) {
    const clearRes = await clearMediaScheduleSlotsOnBackend({
      feedId,
      churchId,
      headers,
      slots: [],
      reason: input.reason,
    });
    if (clearRes.ok) {
      cleared.push(feedId);
      markScheduleFeedDeleted(feedId, [...(feedList() as any[])]);
      const feedRow = (feedList() as any[]).find(
        (row) => String(row?.id || row?.sourceScheduleId || "").trim() === feedId
      );
      const slotsToPurge = Array.isArray(feedRow?.scheduleSlots)
        ? feedRow.scheduleSlots
        : Array.isArray(input.slots)
          ? input.slots
          : [];
      const purgedSlotIds = new Set<string>();
      for (const slot of slotsToPurge) {
        const slotId = String(slot?.id || slot?.cardId || slot?.slotId || "").trim();
        if (!slotId || purgedSlotIds.has(slotId)) continue;
        purgedSlotIds.add(slotId);
        purgeClaimedSlotLocalState({
          scheduleId: feedId,
          slotId,
          userId: String(scheduleSlotClaimUserId(slot) || userId || ""),
          reason: input.reason,
        });
      }
    }
  }

  clearHomeFeedApiCache(userId);
  return { cleared };
}
