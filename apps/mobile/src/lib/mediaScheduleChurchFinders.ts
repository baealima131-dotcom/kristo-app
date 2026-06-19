import {
  isMediaScheduleFeedItem,
  isMediaScheduleFeedItemClosed,
} from "@/lib/mediaScheduleFeedIdentify";
import { prepareMediaScheduleFeedItemForClient } from "@/lib/mediaScheduleFeedPrepare";
import { getActiveScheduleSlots } from "@/lib/mediaScheduleSlotExpired";

type AnyFeedItem = Record<string, any>;

export function isActiveMediaSchedule(item: AnyFeedItem | null | undefined, nowMs = Date.now()): boolean {
  if (!isMediaScheduleFeedItem(item)) return false;
  if (isMediaScheduleFeedItemClosed(item as AnyFeedItem)) return false;

  const slots = Array.isArray(item?.scheduleSlots) ? item.scheduleSlots : [];
  if (!slots.length) return false;

  return getActiveScheduleSlots(item, nowMs).length > 0;
}

export function feedItemBelongsToChurch(item: AnyFeedItem, churchId: string): boolean {
  const cid = String(churchId || "").trim();
  if (!cid) return true;

  const itemCid = String(item?.churchId || "").trim();
  if (itemCid) return itemCid === cid;

  return true;
}

export function feedItemBelongsToChurchStrict(item: AnyFeedItem, churchId: string): boolean {
  const cid = String(churchId || "").trim();
  const itemCid = String(item?.churchId || "").trim();
  if (!cid || !itemCid) return false;
  return itemCid === cid;
}

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

/** Any persisted media schedule row for a church with at least one active slot. */
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
