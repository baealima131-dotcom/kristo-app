import {
  invalidateRoomMessagesCache,
} from "@/src/lib/churchMediaRoomCache";
import {
  CHURCH_MEDIA_ROOM_ID,
  resetRoomMessagesRefreshState,
} from "@/src/lib/churchMediaRoomRefresh";
import { removeAssignmentCardsFromThreads } from "@/src/lib/messagesStore";

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

  const removedCount = removeAssignmentCardsFromThreads(threadIds, {
    cardIds,
    clearAllAssignmentCards: args.clearAllAssignmentCards,
    scheduleBatchId: args.scheduleBatchId,
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
    }

    console.log("KRISTO_ROOM_MESSAGES_CACHE_INVALIDATED_AFTER_DELETE", {
      churchId,
      userId,
      roomIds,
      removedCount,
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

  return { removedCount, threadIds, roomIds };
}
