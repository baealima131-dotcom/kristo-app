import { prepareMediaScheduleFeedItemForClient } from "@/src/lib/mediaScheduleFeedPrepare";
import {
  feedItemBelongsToChurch,
  feedItemBelongsToChurchStrict,
  isMediaScheduleFeedItem,
  isMediaScheduleFeedItemClosed,
} from "@/src/lib/mediaScheduleFeedPredicates";
import {
  getActiveScheduleSlots,
  isActiveMediaSchedule,
} from "@/src/lib/mediaScheduleSlotActive";

type AnyFeedItem = Record<string, any>;

export function findActiveMediaScheduleForChurch(
  items: AnyFeedItem[],
  churchId: string,
  options?: { excludeId?: string; nowMs?: number; strictChurch?: boolean }
): AnyFeedItem | null {
  const cid = String(churchId || "").trim();
  if (!cid) return null;

  const excludeId = String(options?.excludeId || "").trim();
  const nowMs = options?.nowMs ?? Date.now();
  const belongsToChurch = options?.strictChurch
    ? (item: AnyFeedItem) => feedItemBelongsToChurchStrict(item, cid)
    : (item: AnyFeedItem) => feedItemBelongsToChurch(item, cid);

  for (const item of items) {
    if (excludeId && String(item?.id || "") === excludeId) continue;
    if (!belongsToChurch(item)) continue;
    if (isActiveMediaSchedule(item, nowMs)) return item;
  }

  return null;
}

export function findMediaScheduleFeedForChurch(
  items: AnyFeedItem[],
  churchId: string,
  options?: { strictChurch?: boolean; nowMs?: number }
): AnyFeedItem | null {
  const cid = String(churchId || "").trim();
  if (!cid) return null;
  const nowMs = options?.nowMs ?? Date.now();

  const belongsToChurch = options?.strictChurch
    ? (item: AnyFeedItem) => feedItemBelongsToChurchStrict(item, cid)
    : (item: AnyFeedItem) => feedItemBelongsToChurch(item, cid);

  for (const item of items) {
    if (!isMediaScheduleFeedItem(item)) continue;
    if (isMediaScheduleFeedItemClosed(item as AnyFeedItem)) continue;
    if (!belongsToChurch(item)) continue;
    const prepared = prepareMediaScheduleFeedItemForClient(item);
    if (prepared && getActiveScheduleSlots(prepared, nowMs).length > 0) return prepared;
  }

  return findPersistedMediaScheduleFeedForChurch(items, churchId, options);
}

export function findPersistedMediaScheduleFeedForChurch(
  items: AnyFeedItem[],
  churchId: string,
  options?: { strictChurch?: boolean; nowMs?: number }
): AnyFeedItem | null {
  const cid = String(churchId || "").trim();
  if (!cid) return null;
  void options?.nowMs;

  const belongsToChurch = options?.strictChurch
    ? (item: AnyFeedItem) => feedItemBelongsToChurchStrict(item, cid)
    : (item: AnyFeedItem) => feedItemBelongsToChurch(item, cid);

  for (const item of items) {
    if (!isMediaScheduleFeedItem(item)) continue;
    if (isMediaScheduleFeedItemClosed(item as AnyFeedItem)) continue;
    if (!belongsToChurch(item)) continue;
    const slots = Array.isArray(item?.scheduleSlots) ? item.scheduleSlots : [];
    if (slots.length > 0) {
      const prepared = prepareMediaScheduleFeedItemForClient(item);
      return prepared || item;
    }
  }

  return null;
}

export function resolveChurchMediaScheduleFromFeedRows(
  items: AnyFeedItem[],
  churchId: string,
  options?: { strictChurch?: boolean; nowMs?: number; excludeId?: string }
): AnyFeedItem | null {
  const nowMs = options?.nowMs ?? Date.now();
  const strictFindOpts = {
    excludeId: options?.excludeId,
    nowMs,
    strictChurch: options?.strictChurch !== false,
  };

  const active = findActiveMediaScheduleForChurch(items, churchId, strictFindOpts);
  if (active) {
    const prepared = prepareMediaScheduleFeedItemForClient(active);
    return prepared || active;
  }

  const feed = findMediaScheduleFeedForChurch(items, churchId, {
    strictChurch: options?.strictChurch !== false,
    nowMs,
  });
  if (feed) return feed;

  return findPersistedMediaScheduleFeedForChurch(items, churchId, {
    strictChurch: options?.strictChurch !== false,
    nowMs,
  });
}

export function summarizeActiveMediaSchedule(item: AnyFeedItem | null | undefined) {
  if (!item) return null;

  const slots = Array.isArray(item.scheduleSlots) ? item.scheduleSlots : [];
  const activeSlots = getActiveScheduleSlots(item);

  return {
    id: String(item.id || ""),
    title: String(item.title || item.text || ""),
    createdBy: String(item.createdBy || ""),
    scheduleSlots: slots,
    slotCount: slots.length,
    activeSlotCount: activeSlots.length,
    status: String(item.status || ""),
    deletedAt: item.deletedAt || null,
  };
}
