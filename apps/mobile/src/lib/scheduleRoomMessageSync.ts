import {
  clearRoomMessagesCacheAfterDelete,
  invalidateRoomMessagesCache,
} from "@/src/lib/churchMediaRoomCache";
import {
  CHURCH_MEDIA_ROOM_ID,
  resetRoomMessagesRefreshState,
} from "@/src/lib/churchMediaRoomRefresh";
import { removeAssignmentCardsFromThreads } from "@/src/lib/messagesStore";
import { markRoomMessagesForcePollAfterDelete } from "@/src/lib/roomMessagesDeletePoll";

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

export { consumeRoomMessagesForcePollAfterDelete } from "@/src/lib/roomMessagesDeletePoll";

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
      markRoomMessagesForcePollAfterDelete(roomId);
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
