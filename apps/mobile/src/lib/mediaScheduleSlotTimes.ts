import { isPendingLocalMediaScheduleRow } from "@/src/lib/mediaSchedulePendingSync";
import {
  findActiveMediaScheduleForChurch,
  isMediaScheduleFeedItemClosed,
} from "@/src/lib/mediaScheduleLock";
import { parseSlotClockMs, parseSlotStartMs } from "@/src/lib/scheduleSlotUtils";

export type MediaSlotTimeWindow = {
  startMs: number;
  endMs: number;
};

export type MediaSlotTimeDraft = {
  id?: string;
  name?: string;
  durationMin?: number;
  minutes?: number;
  startTime?: string;
  endTime?: string;
  timeLabel?: string;
  meetingDate?: string;
  meetingDay?: string;
  startMs?: number;
  endMs?: number;
  status?: string;
  deleted?: boolean;
  [key: string]: unknown;
};

function formatClockFromMs(ms: number) {
  const d = new Date(ms);
  let hour = d.getHours();
  const minute = String(d.getMinutes()).padStart(2, "0");
  const meridiem = hour >= 12 ? "PM" : "AM";
  hour = hour % 12;
  if (hour === 0) hour = 12;
  return `${hour}:${minute} ${meridiem}`;
}

export function formatLocalMeetingDateFromMs(ms: number) {
  const d = new Date(ms);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

export function resolveMediaSlotTimeWindow(slot: any, nowMs = Date.now()): MediaSlotTimeWindow {
  const explicitStart = Number(slot?.startMs || 0);
  const explicitEnd = Number(slot?.endMs || 0);
  if (explicitStart > 0 && explicitEnd > explicitStart) {
    return { startMs: explicitStart, endMs: explicitEnd };
  }

  const rawDate = String(slot?.meetingDate || slot?.meetingDay || "").trim();
  const startMs = parseSlotStartMs(slot);
  const endFromClock = parseSlotClockMs(rawDate, String(slot?.endTime || "").trim());
  const durationMs =
    Math.max(1, Number(slot?.durationMin || slot?.minutes || 1)) * 60 * 1000;
  const endMs = endFromClock > startMs ? endFromClock : startMs > 0 ? startMs + durationMs : 0;

  void nowMs;
  return { startMs, endMs };
}

export function isMediaSlotEndedOrStale(slot: any, nowMs = Date.now()) {
  const status = String(slot?.status || "").toLowerCase();
  if (
    slot?.deleted === true ||
    status === "deleted" ||
    status === "cancelled" ||
    status === "canceled" ||
    status === "completed" ||
    status === "complete" ||
    status === "removed" ||
    status === "ended" ||
    status === "closed"
  ) {
    return true;
  }

  const { endMs } = resolveMediaSlotTimeWindow(slot, nowMs);
  return endMs > 0 && nowMs > endMs;
}

/** Assign non-overlapping times: each slot starts exactly when the previous ends. */
export function assignSequentialMediaSlotTimes<T extends MediaSlotTimeDraft>(
  slots: T[],
  meetingStartMs: number,
  options?: {
    scheduleDay?: string;
    maxEndMs?: number;
    reason?: string;
  }
): T[] {
  const reason = String(options?.reason || "assignSequentialMediaSlotTimes");
  const scheduleDay = String(options?.scheduleDay || "").trim();
  const maxEndMs = Number(options?.maxEndMs || 0);
  let cursorMs = Math.max(0, Number(meetingStartMs || 0));

  console.log("KRISTO_MEDIA_SLOT_TIMES_BUILD", {
    reason,
    slotCount: slots.length,
    meetingStartMs: cursorMs,
    maxEndMs: maxEndMs || null,
    scheduleDay: scheduleDay || null,
  });

  const assigned = slots.map((slot, index) => {
    const durationMin = Math.max(
      1,
      Number(slot?.durationMin || slot?.minutes || 1)
    );
    const startMs = cursorMs;
    let endMs = startMs + durationMin * 60 * 1000;

    if (maxEndMs > startMs && index === slots.length - 1 && endMs > maxEndMs) {
      endMs = maxEndMs;
    }

    const startTime = formatClockFromMs(startMs);
    const endTime = formatClockFromMs(endMs);
    const meetingDate = formatLocalMeetingDateFromMs(startMs);
    const resolvedDurationMin = Math.max(1, Math.round((endMs - startMs) / 60000));

    console.log("KRISTO_MEDIA_SLOT_TIME_ASSIGNED", {
      reason,
      index,
      slotId: String(slot?.id || ""),
      name: String(slot?.name || ""),
      startMs,
      endMs,
      startTime,
      endTime,
      durationMin: resolvedDurationMin,
      meetingDate,
    });

    cursorMs = endMs;

    return {
      ...slot,
      durationMin: resolvedDurationMin,
      minutes: resolvedDurationMin,
      startMs,
      endMs,
      startTime,
      endTime,
      timeLabel: `${startTime} - ${endTime}`,
      meetingDate,
      meetingDay: scheduleDay || slot?.meetingDay,
    };
  });

  logMediaSlotConflictCheck(assigned, reason);
  return assigned;
}

export function findMediaSlotTimeConflict(
  slot: any,
  slots: any[],
  nowMs = Date.now()
): string {
  const current = resolveMediaSlotTimeWindow(slot, nowMs);
  if (!current.startMs || !current.endMs) return "";
  if (current.endMs <= current.startMs) return "Invalid time";
  if (isMediaSlotEndedOrStale(slot, nowMs)) return "";

  const chronological = slots
    .filter((row) => row && !isMediaSlotEndedOrStale(row, nowMs))
    .map((row) => ({
      slot: row,
      ...resolveMediaSlotTimeWindow(row, nowMs),
    }))
    .filter((row) => row.startMs > 0 && row.endMs > row.startMs)
    .sort((a, b) => a.startMs - b.startMs);

  const index = chronological.findIndex(
    (row) => String(row.slot?.id || "") === String(slot?.id || "")
  );
  if (index < 0) return "";

  const prev = index > 0 ? chronological[index - 1] : null;
  const next = index < chronological.length - 1 ? chronological[index + 1] : null;

  if (prev && current.startMs < prev.endMs) {
    return "Overlaps previous slot";
  }
  if (next && current.endMs > next.startMs) {
    return "Overlaps next slot";
  }
  return "";
}

export function countMediaSlotTimeConflicts(slots: any[], nowMs = Date.now()) {
  logMediaSlotConflictCheck(slots, "countMediaSlotTimeConflicts", nowMs);

  const active = slots.filter((slot) => slot && !isMediaSlotEndedOrStale(slot, nowMs));
  let count = 0;
  for (const slot of active) {
    if (findMediaSlotTimeConflict(slot, slots, nowMs)) count += 1;
  }
  return count;
}

export function logMediaSlotConflictCheck(
  slots: any[],
  reason: string,
  nowMs = Date.now()
) {
  const active = (Array.isArray(slots) ? slots : []).filter(
    (slot) => slot && !isMediaSlotEndedOrStale(slot, nowMs)
  );

  const conflicts = active
    .map((slot) => ({
      slotId: String(slot?.id || ""),
      name: String(slot?.name || ""),
      conflict: findMediaSlotTimeConflict(slot, slots, nowMs),
      ...resolveMediaSlotTimeWindow(slot, nowMs),
    }))
    .filter((row) => Boolean(row.conflict));

  console.log("KRISTO_MEDIA_SLOT_CONFLICT_CHECK", {
    reason,
    slotCount: Array.isArray(slots) ? slots.length : 0,
    activeSlotCount: active.length,
    conflictCount: conflicts.length,
  });

  for (const row of conflicts) {
    console.log("KRISTO_MEDIA_SLOT_CONFLICT_FOUND", {
      reason,
      slotId: row.slotId,
      name: row.name,
      conflict: row.conflict,
      startMs: row.startMs,
      endMs: row.endMs,
    });
  }

  return conflicts.length;
}

/** Prefer durable backend schedule over optimistic local pending duplicate. */
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

  const homeActive = findActiveMediaScheduleForChurch(homeFeedItems, cid, {
    strictChurch: true,
    nowMs,
  });

  if (backendActive && !isPendingLocalMediaScheduleRow(backendActive, cid)) {
    if (
      homeActive &&
      homeActive.pendingBackendSync === true &&
      String(homeActive.id || "") !== String(backendActive.id || "")
    ) {
      return backendActive;
    }
    return backendActive;
  }

  if (homeActive) {
    if (homeActive.pendingBackendSync === true && backendActive) {
      return backendActive;
    }
    if (!isMediaScheduleFeedItemClosed(homeActive)) {
      return homeActive;
    }
  }

  return backendActive || homeActive || null;
}
