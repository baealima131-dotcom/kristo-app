import { invalidateRoomMessagesCache } from "@/src/lib/churchMediaRoomCache";
import {
  CHURCH_LIVE_CONTROL_SCHEDULE_ROOM_ID,
} from "@/src/lib/churchLiveControlSchedule";
import {
  CHURCH_MEDIA_ROOM_ID,
  resetRoomMessagesRefreshState,
} from "@/src/lib/churchMediaRoomRefresh";
import { markRoomMessagesForcePoll } from "@/src/lib/roomMessagesDeletePoll";

export type ChurchLiveControlRoomSyncAction =
  | "create"
  | "claim"
  | "release"
  | "patch"
  | "delete"
  | "delete_all";

export type ChurchLiveControlRoomSyncPayload = {
  action: ChurchLiveControlRoomSyncAction;
  churchId?: string;
  userId?: string;
  roomId?: string;
  scheduleId?: string;
  messageId?: string;
  cardId?: string;
  reason?: string;
};

const syncListeners = new Set<(payload: ChurchLiveControlRoomSyncPayload) => void>();

export function subscribeChurchLiveControlRoomSync(
  listener: (payload: ChurchLiveControlRoomSyncPayload) => void
) {
  syncListeners.add(listener);
  return () => {
    syncListeners.delete(listener);
  };
}

export function notifyChurchLiveControlRoomSync(payload: ChurchLiveControlRoomSyncPayload) {
  console.log("KRISTO_CHURCH_LIVE_CONTROL_ROOM_SYNC", payload);
  for (const listener of Array.from(syncListeners)) {
    try {
      listener(payload);
    } catch {
      // ignore listener errors
    }
  }
}

/** Invalidate caches, force the next room poll, and notify in-app listeners. */
export function broadcastChurchLiveControlRoomSync(
  input: ChurchLiveControlRoomSyncPayload & { churchId: string; userId?: string }
) {
  const churchId = String(input.churchId || "").trim();
  const userId = String(input.userId || "").trim();
  const roomId = String(
    input.roomId || CHURCH_LIVE_CONTROL_SCHEDULE_ROOM_ID || CHURCH_MEDIA_ROOM_ID
  ).trim();

  if (churchId && userId && roomId) {
    invalidateRoomMessagesCache(churchId, userId, roomId);
    resetRoomMessagesRefreshState(churchId, userId, roomId);
    markRoomMessagesForcePoll(roomId);
  }

  notifyChurchLiveControlRoomSync({
    ...input,
    roomId,
  });
}
