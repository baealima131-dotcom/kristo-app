import { isChurchLiveControlScheduleFeedRow } from "@/lib/churchLiveControlSchedule";
import { localCalendarDateFromString } from "@/lib/scheduleDateUtils";

export const ACTIVE_MEDIA_SCHEDULE_ERROR =
  "A media schedule is already active. Please end or delete it before creating another one.";

type AnyFeedItem = Record<string, any>;

function parseMeridiemTimeOnDate(base: Date, timeText: string): number {
  const rawTime = String(timeText || "").trim();
  if (!rawTime || !Number.isFinite(base.getTime())) return NaN;

  const match = rawTime.match(/(\d{1,2})(?::(\d{2}))?\s*(AM|PM)?/i);
  if (!match) return NaN;

  let hour = Number(match[1] || 0);
  const minute = Number(match[2] || 0);
  const meridiem = String(match[3] || "").toUpperCase();

  if (meridiem === "PM" && hour < 12) hour += 12;
  if (meridiem === "AM" && hour === 12) hour = 0;
  if (!meridiem && hour >= 24) return NaN;

  const d = new Date(base);
  d.setHours(hour, minute, 0, 0);
  return d.getTime();
}

function parseSlotStartMs(slot: AnyFeedItem): number {
  const explicitStart = Number(slot?.startMs || 0);
  if (explicitStart > 0) return explicitStart;

  const startsAt = String(slot?.startsAt || "").trim();
  if (startsAt) {
    const parsed = Date.parse(startsAt);
    if (Number.isFinite(parsed) && parsed > 0) return parsed;
  }

  const meetingDate = String(slot?.meetingDate || slot?.meetingDay || "").trim();
  const startTime = String(slot?.startTime || slot?.time || slot?.timeLabel || "").trim();

  if (!meetingDate) return 0;

  const base = localCalendarDateFromString(meetingDate);
  if (!base) return 0;

  if (!startTime) return base.getTime();

  const startMs = parseMeridiemTimeOnDate(base, startTime);
  return Number.isFinite(startMs) ? startMs : base.getTime();
}

function parseSlotEndMs(slot: AnyFeedItem): number {
  const startMs = parseSlotStartMs(slot);

  const explicitEnd = Number(slot?.endMs || 0);
  if (explicitEnd > startMs) return explicitEnd;

  const endsAt = String(slot?.endsAt || "").trim();
  if (endsAt) {
    const parsed = Date.parse(endsAt);
    if (Number.isFinite(parsed) && parsed > startMs) return parsed;
  }

  const meetingDate = String(slot?.meetingDate || slot?.meetingDay || "").trim();
  const endTime = String(slot?.endTime || "").trim();

  if (meetingDate && endTime) {
    const base = localCalendarDateFromString(
      String(slot?.meetingEndDate || meetingDate).trim()
    );
    if (base) {
      let endMs = parseMeridiemTimeOnDate(base, endTime);
      if (Number.isFinite(endMs)) {
        if (startMs > 0 && endMs <= startMs) {
          endMs += 24 * 60 * 60 * 1000;
        }
        if (endMs > startMs) return endMs;
      }
    }
  }

  if (!startMs) return 0;

  const durationMs = Math.max(1, Number(slot?.durationMin || 1)) * 60000;
  return startMs + durationMs;
}

function isSlotStatusClosed(slot: AnyFeedItem): boolean {
  const status = String(slot?.status || "").toLowerCase();
  const scheduleStatus = String(slot?.scheduleStatus || "").toLowerCase();
  return (
    slot?.deleted === true ||
    slot?.deletedAt ||
    status === "deleted" ||
    status === "cancelled" ||
    status === "canceled" ||
    status === "completed" ||
    status === "complete" ||
    status === "removed" ||
    status === "ended" ||
    status === "closed" ||
    status === "cleared" ||
    scheduleStatus === "deleted" ||
    scheduleStatus === "ended" ||
    scheduleStatus === "closed" ||
    scheduleStatus === "cleared"
  );
}

function isSlotClaimedOrLive(slot: AnyFeedItem): boolean {
  const status = String(slot?.status || "").toLowerCase();
  if (status === "claimed" || status === "live") return true;
  if (slot?.claimed === true || slot?.isClaimed === true || slot?.isLiveNow === true) return true;

  const uid = String(slot?.claimedByUserId || slot?.claimedBy?.userId || "").trim();
  if (uid) return true;

  const claimedBy = slot?.claimedBy;
  if (typeof claimedBy === "object" && claimedBy && String(claimedBy.userId || "").trim()) return true;
  if (typeof claimedBy === "string" && claimedBy.trim() && claimedBy.toLowerCase() !== "open") return true;

  return false;
}

export function isMediaScheduleFeedItem(item: AnyFeedItem | null | undefined): boolean {
  if (!item || typeof item !== "object") return false;

  const source = String(item.source || "").toLowerCase();
  const scheduleType = String(item.scheduleType || "").toLowerCase();

  return source.includes("media-schedule") || scheduleType === "media-live-slots";
}

export function isMediaScheduleFeedItemClosed(item: AnyFeedItem): boolean {
  if (item?.deletedAt) return true;

  const status = String(item?.status || "").toLowerCase();
  const scheduleStatus = String(item?.scheduleStatus || "").toLowerCase();
  const deleted = item?.deleted === true || status === "deleted" || scheduleStatus === "deleted";
  const cancelled = status === "cancelled" || status === "canceled";
  const completed =
    status === "completed" ||
    status === "closed" ||
    status === "ended" ||
    status === "complete" ||
    status === "cleared" ||
    scheduleStatus === "ended" ||
    scheduleStatus === "closed" ||
    scheduleStatus === "cleared";

  return deleted || cancelled || completed;
}

export function isMediaScheduleForChurch(item: AnyFeedItem | null | undefined, churchId: string): boolean {
  if (!item || typeof item !== "object") return false;

  const id = String(item.id || "").toLowerCase();
  const isMedia =
    isMediaScheduleFeedItem(item) ||
    id.startsWith("media-live-") ||
    id.startsWith("media-schedule-");

  if (!isMedia) return false;

  const cid = String(churchId || "").trim();
  const itemCid = String(item?.churchId || "").trim();
  if (itemCid) return itemCid === cid;

  // Legacy rows without churchId are church-scoped during explicit clear for that church.
  return Boolean(cid);
}

export function isActiveScheduleSlot(
  slot: AnyFeedItem | null | undefined,
  nowMs = Date.now()
): boolean {
  if (!slot || typeof slot !== "object") return false;
  if (isSlotStatusClosed(slot)) return false;

  const startMs = parseSlotStartMs(slot);
  const endMs = parseSlotEndMs(slot);

  if (startMs > nowMs) return true;

  if (isSlotClaimedOrLive(slot)) {
    if (endMs <= 0) return true;
    return nowMs <= endMs;
  }

  if (endMs > 0 && nowMs > endMs) return false;

  return false;
}

export function getActiveScheduleSlots(
  item: AnyFeedItem | null | undefined,
  nowMs = Date.now()
): AnyFeedItem[] {
  const slots = Array.isArray(item?.scheduleSlots) ? item.scheduleSlots : [];
  return slots.filter((slot) => isActiveScheduleSlot(slot, nowMs));
}

export function areAllScheduleSlotsExpired(item: AnyFeedItem, nowMs = Date.now()): boolean {
  const slots = Array.isArray(item?.scheduleSlots) ? item.scheduleSlots : [];
  if (!slots.length) return true;
  return getActiveScheduleSlots(item, nowMs).length === 0;
}

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

  // Legacy/local rows may omit churchId; treat as current church in-session.
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
    if (isChurchLiveControlScheduleFeedRow(item)) continue;
    if (!belongsToChurch(item)) continue;
    if (isActiveMediaSchedule(item, nowMs)) return item;
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
    if (isChurchLiveControlScheduleFeedRow(item)) continue;
    if (!isMediaScheduleFeedItem(item)) continue;
    if (isMediaScheduleFeedItemClosed(item as AnyFeedItem)) continue;
    if (!belongsToChurch(item)) continue;
    if (getActiveScheduleSlots(item, nowMs).length > 0) return item;
  }

  return null;
}

export function findAllActiveMediaSchedulesForChurch(
  items: AnyFeedItem[],
  churchId: string,
  options?: { excludeId?: string; nowMs?: number; strictChurch?: boolean }
): AnyFeedItem[] {
  const cid = String(churchId || "").trim();
  if (!cid) return [];

  const excludeId = String(options?.excludeId || "").trim();
  const nowMs = options?.nowMs ?? Date.now();
  const belongsToChurch = options?.strictChurch
    ? (item: AnyFeedItem) => feedItemBelongsToChurchStrict(item, cid)
    : (item: AnyFeedItem) => feedItemBelongsToChurch(item, cid);

  return items.filter((item) => {
    if (excludeId && String(item?.id || "") === excludeId) return false;
    if (isChurchLiveControlScheduleFeedRow(item)) return false;
    if (!belongsToChurch(item)) return false;
    return isActiveMediaSchedule(item, nowMs);
  });
}

export function isIncomingMediaScheduleCreate(body: AnyFeedItem | null | undefined): boolean {
  const source = String(body?.source || "").trim().toLowerCase();
  const scheduleType = String(body?.scheduleType || "").trim().toLowerCase();

  return source === "media-schedule" || scheduleType === "media-live-slots";
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
    activeSlotCount: activeSlots.length,
    status: String(item.status || ""),
    deletedAt: item.deletedAt || null,
  };
}
