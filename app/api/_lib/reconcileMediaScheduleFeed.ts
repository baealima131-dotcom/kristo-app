import {
  CHURCH_LIVE_CONTROL_SCHEDULE_ROOM_ID,
  isChurchLiveControlScheduleFeedRow,
} from "@/lib/churchLiveControlSchedule";
import {
  isMediaScheduleFeedItem,
  isMediaScheduleForChurch,
} from "@/lib/mediaScheduleLock";
import { readRoomMessagesJsonFile } from "@/app/api/_lib/store/roomMessageDb";
import { endStaleMediaScheduleFeedItem } from "@/app/api/_lib/staleMediaScheduleFeed";

const ROOM_MESSAGES_STORE_FILE = "room-messages.json";

type AnyFeedItem = Record<string, any>;

export type AuthoritativeScheduleIndex = {
  scheduleIds: Set<string>;
  slotIds: Set<string>;
  assignmentCardCount: number;
};

function roomStoreKey(churchId: string, roomId: string) {
  return `${String(churchId || "").trim()}::${String(roomId || "").trim()}`;
}

function rememberId(target: Set<string>, value: unknown) {
  const id = String(value || "").trim();
  if (!id) return;
  target.add(id);
}

function slotIdsFromFeedItem(item: AnyFeedItem): string[] {
  const slots = Array.isArray(item?.scheduleSlots) ? item.scheduleSlots : [];
  return slots
    .map((slot: any) => String(slot?.id || slot?.slotId || slot?.cardId || "").trim())
    .filter(Boolean);
}

function scheduleIdsFromFeedItem(item: AnyFeedItem): string[] {
  return [
    item?.id,
    item?.sourceScheduleId,
    item?.liveId,
    item?.parentScheduleId,
    item?.scheduleFeedId,
  ]
    .map((value) => String(value || "").trim())
    .filter(Boolean);
}

export function isChurchLiveControlScheduleFeedMirror(item: AnyFeedItem | null | undefined): boolean {
  if (!item || typeof item !== "object") return false;
  if (isChurchLiveControlScheduleFeedRow(item)) return true;

  const source = String(item?.source || "").toLowerCase();
  if (source.includes("church-live-control")) return true;

  const feedId = String(item?.id || item?.sourceScheduleId || "").trim();
  if (feedId.startsWith("batch_")) return true;

  for (const slotId of slotIdsFromFeedItem(item)) {
    if (slotId.startsWith("batch_") && slotId.includes("-slot-")) return true;
  }

  if (
    isMediaScheduleFeedItem(item) &&
    item?.isGlobalMediaSlot !== true &&
    !String(item?.audience || "").toLowerCase().includes("global")
  ) {
    const roomId = String(item?.roomId || item?.assignmentId || "").trim();
    if (roomId === CHURCH_LIVE_CONTROL_SCHEDULE_ROOM_ID) return true;
  }

  return false;
}

export async function loadAuthoritativeScheduleIndexForChurch(
  churchId: string
): Promise<AuthoritativeScheduleIndex> {
  const scheduleIds = new Set<string>();
  const slotIds = new Set<string>();
  let assignmentCardCount = 0;

  const cid = String(churchId || "").trim();
  if (!cid) {
    return { scheduleIds, slotIds, assignmentCardCount };
  }

  try {
    const store = await readRoomMessagesJsonFile<Record<string, any[]>>(
      ROOM_MESSAGES_STORE_FILE,
      {}
    );
    const key = roomStoreKey(cid, CHURCH_LIVE_CONTROL_SCHEDULE_ROOM_ID);
    const rows = Array.isArray(store[key]) ? store[key] : [];

    for (const message of rows) {
      if (String(message?.kind || "") !== "assignment_card") continue;
      const card = message?.card;
      if (!card || typeof card !== "object") continue;

      assignmentCardCount += 1;
      rememberId(scheduleIds, card.scheduleBatchId);
      rememberId(scheduleIds, card.sourceScheduleId);
      rememberId(scheduleIds, card.sourceFeedId);
      rememberId(scheduleIds, message?.scheduleId);
      rememberId(scheduleIds, message?.parentScheduleId);
      rememberId(slotIds, card.cardId);
      rememberId(slotIds, card.id);
      rememberId(slotIds, message?.slotId);
      rememberId(slotIds, message?.id);
    }
  } catch (error: any) {
    console.log("KRISTO_FEED_SCHEDULE_RECONCILE_ROOM_READ_FAILED", {
      churchId: cid,
      error: String(error?.message || error),
    });
  }

  return { scheduleIds, slotIds, assignmentCardCount };
}

function feedItemOverlapsAuthoritativeIndex(
  item: AnyFeedItem,
  index: AuthoritativeScheduleIndex
): boolean {
  for (const scheduleId of scheduleIdsFromFeedItem(item)) {
    if (index.scheduleIds.has(scheduleId)) return true;
  }

  for (const slotId of slotIdsFromFeedItem(item)) {
    if (index.slotIds.has(slotId)) return true;
  }

  return false;
}

function filterFeedItemSlotsToAuthoritativeIndex(
  item: AnyFeedItem,
  index: AuthoritativeScheduleIndex
): AnyFeedItem | null {
  const slots = Array.isArray(item?.scheduleSlots) ? item.scheduleSlots : [];
  if (!slots.length) return null;

  const filtered = slots.filter((slot: any) => {
    const slotId = String(slot?.id || slot?.slotId || slot?.cardId || "").trim();
    if (slotId && index.slotIds.has(slotId)) return true;
    return feedItemOverlapsAuthoritativeIndex(
      {
        ...item,
        scheduleSlots: [slot],
      },
      index
    );
  });

  if (!filtered.length) return null;
  return { ...item, scheduleSlots: filtered };
}

export async function reconcileMediaScheduleFeedRowsForChurch(input: {
  churchId: string;
  rows: AnyFeedItem[];
  persistStaleDeletes?: boolean;
  reason?: string;
}): Promise<AnyFeedItem[]> {
  const churchId = String(input.churchId || "").trim();
  const rows = Array.isArray(input.rows) ? input.rows : [];
  if (!churchId || !rows.length) return rows;

  const index = await loadAuthoritativeScheduleIndexForChurch(churchId);
  const reason = String(input.reason || "feed-get-reconcile").trim();
  const next: AnyFeedItem[] = [];

  for (const item of rows) {
    if (!isMediaScheduleForChurch(item, churchId)) {
      next.push(item);
      continue;
    }

    if (!isChurchLiveControlScheduleFeedMirror(item)) {
      next.push(item);
      continue;
    }

    if (!feedItemOverlapsAuthoritativeIndex(item, index)) {
      const feedId = String(item?.id || item?.sourceScheduleId || "").trim();
      console.log("KRISTO_FEED_STALE_SCHEDULE_ROW_DROPPED", {
        churchId,
        feedId,
        reason,
        assignmentCardCount: index.assignmentCardCount,
        scheduleIds: scheduleIdsFromFeedItem(item),
        slotIds: slotIdsFromFeedItem(item),
      });

      if (input.persistStaleDeletes !== false && feedId) {
        void endStaleMediaScheduleFeedItem({
          postId: feedId,
          churchId,
          reason,
        }).catch((error: any) => {
          console.log("KRISTO_FEED_STALE_SCHEDULE_ROW_DELETE_FAILED", {
            churchId,
            feedId,
            error: String(error?.message || error),
          });
        });
      }
      continue;
    }

    const filtered = filterFeedItemSlotsToAuthoritativeIndex(item, index);
    if (!filtered) {
      const feedId = String(item?.id || item?.sourceScheduleId || "").trim();
      console.log("KRISTO_FEED_STALE_SCHEDULE_ROW_DROPPED", {
        churchId,
        feedId,
        reason: `${reason}-slots-pruned-empty`,
        assignmentCardCount: index.assignmentCardCount,
        scheduleIds: scheduleIdsFromFeedItem(item),
        slotIds: slotIdsFromFeedItem(item),
      });
      continue;
    }

    next.push(filtered);
  }

  return next;
}

export async function purgeFeedSchedulesForDeletedRoomCards(input: {
  churchId: string;
  deletedMessages: any[];
  reason?: string;
}) {
  const churchId = String(input.churchId || "").trim();
  const deletedMessages = Array.isArray(input.deletedMessages) ? input.deletedMessages : [];
  if (!churchId || !deletedMessages.length) return;

  const feedIds = new Set<string>();
  for (const message of deletedMessages) {
    const card = message?.card;
    if (!card || typeof card !== "object") continue;
    for (const candidate of [
      card.sourceFeedId,
      card.sourceScheduleId,
      card.scheduleBatchId,
      message?.scheduleId,
      message?.parentScheduleId,
    ]) {
      const id = String(candidate || "").trim();
      if (id) feedIds.add(id);
    }
  }

  const reason = String(input.reason || "room-messages-delete").trim();
  for (const feedId of feedIds) {
    console.log("KRISTO_FEED_STALE_SCHEDULE_ROW_DROPPED", {
      churchId,
      feedId,
      reason,
      source: "room-messages-delete",
    });
    void endStaleMediaScheduleFeedItem({
      postId: feedId,
      churchId,
      reason,
    }).catch((error: any) => {
      console.log("KRISTO_FEED_STALE_SCHEDULE_ROW_DELETE_FAILED", {
        churchId,
        feedId,
        error: String(error?.message || error),
      });
    });
  }
}
