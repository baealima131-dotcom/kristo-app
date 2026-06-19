import {
  parseSlotEndMs,
  parseSlotStartMs,
} from "@/src/lib/scheduleSlotUtils";

export { resolveCanonicalMediaScheduleForGuests } from "@/src/lib/mediaScheduleGuestResolve";

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

function parseIsoMs(value: unknown) {
  const raw = String(value || "").trim();
  if (!raw) return 0;
  const parsed = Date.parse(raw);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 0;
}

function formatMeetingDayLabel(ms: number) {
  if (!ms) return "";
  return new Date(ms).toLocaleDateString("en-US", {
    month: "long",
    day: "numeric",
    year: "numeric",
  });
}

function slotHasPersistedTimeHints(slot: any) {
  return Boolean(
    Number(slot?.startMs || 0) > 0 ||
      Number(slot?.endMs || 0) > 0 ||
      String(slot?.startsAt || "").trim() ||
      String(slot?.endsAt || "").trim() ||
      String(slot?.startTime || "").trim() ||
      String(slot?.meetingDate || "").trim()
  );
}

export function logMediaSlotTimeLost(slot: any, source: string, resolved: MediaSlotTimeWindow) {
  if (resolved.startMs > 0 && resolved.endMs > resolved.startMs) return;
  if (!slotHasPersistedTimeHints(slot)) return;

  console.log("KRISTO_MEDIA_SLOT_TIME_LOST", {
    source,
    slotId: String(slot?.id || ""),
    name: String(slot?.name || ""),
    startMs: Number(slot?.startMs || 0) || null,
    endMs: Number(slot?.endMs || 0) || null,
    startsAt: String(slot?.startsAt || "").trim() || null,
    endsAt: String(slot?.endsAt || "").trim() || null,
    meetingDate: String(slot?.meetingDate || "").trim() || null,
    meetingEndDate: String(slot?.meetingEndDate || "").trim() || null,
    startTime: String(slot?.startTime || "").trim() || null,
    endTime: String(slot?.endTime || "").trim() || null,
    resolvedStartMs: resolved.startMs || null,
    resolvedEndMs: resolved.endMs || null,
  });
}

export function logMediaSlotReloadTime(slot: any, source: string, index = 0) {
  const resolved = resolveMediaSlotTimeWindow(slot);
  console.log("KRISTO_MEDIA_SLOT_RELOAD_TIME", {
    source,
    index,
    slotId: String(slot?.id || ""),
    name: String(slot?.name || ""),
    startMs: resolved.startMs || null,
    endMs: resolved.endMs || null,
    startsAt: String(slot?.startsAt || "").trim() || null,
    endsAt: String(slot?.endsAt || "").trim() || null,
    meetingDate: String(slot?.meetingDate || "").trim() || null,
    meetingEndDate: String(slot?.meetingEndDate || "").trim() || null,
    startTime: String(slot?.startTime || "").trim() || null,
    endTime: String(slot?.endTime || "").trim() || null,
  });
  logMediaSlotTimeLost(slot, source, resolved);
  return resolved;
}

export function buildPersistedMediaSlotTimeFields(slot: MediaSlotTimeDraft) {
  const startMs = Number(slot?.startMs || 0);
  const endMs = Number(slot?.endMs || 0);
  const durationMin = Math.max(1, Number(slot?.durationMin || slot?.minutes || 1));
  const startsAt = startMs > 0 ? new Date(startMs).toISOString() : "";
  const endsAt = endMs > 0 ? new Date(endMs).toISOString() : "";
  const meetingDate =
    startMs > 0 ? formatLocalMeetingDateFromMs(startMs) : String(slot?.meetingDate || "").trim();
  const meetingEndDate =
    endMs > 0 ? formatLocalMeetingDateFromMs(endMs) : meetingDate;

  return {
    startMs,
    endMs,
    startsAt,
    endsAt,
    meetingDate,
    meetingEndDate,
    meetingDay: formatMeetingDayLabel(startMs) || String(slot?.meetingDay || "").trim(),
    startTime: String(slot?.startTime || "").trim(),
    endTime: String(slot?.endTime || "").trim(),
    durationMin,
    durationMinutes: durationMin,
  };
}

export function logMediaSlotPayloadTime(
  slot: any,
  index: number,
  source: string
) {
  const persisted = buildPersistedMediaSlotTimeFields(slot);
  console.log("KRISTO_MEDIA_SLOT_PAYLOAD_TIME", {
    source,
    index,
    slotId: String(slot?.id || ""),
    name: String(slot?.name || ""),
    startMs: persisted.startMs || null,
    endMs: persisted.endMs || null,
    startsAt: persisted.startsAt || null,
    endsAt: persisted.endsAt || null,
    meetingDate: persisted.meetingDate || null,
    meetingEndDate: persisted.meetingEndDate || null,
    startTime: persisted.startTime || null,
    endTime: persisted.endTime || null,
    durationMinutes: persisted.durationMinutes,
  });
  return persisted;
}

export function resolveMediaSlotTimeWindow(slot: any, nowMs = Date.now()): MediaSlotTimeWindow {
  const explicitStart = Number(slot?.startMs || 0);
  const explicitEnd = Number(slot?.endMs || 0);
  if (explicitStart > 0 && explicitEnd > explicitStart) {
    return { startMs: explicitStart, endMs: explicitEnd };
  }

  const startsAtMs = parseIsoMs(slot?.startsAt);
  const endsAtMs = parseIsoMs(slot?.endsAt);
  if (startsAtMs > 0 && endsAtMs > startsAtMs) {
    return { startMs: startsAtMs, endMs: endsAtMs };
  }

  const startMs = parseSlotStartMs(slot);
  const endMs = parseSlotEndMs(slot, startMs);

  void nowMs;
  return { startMs, endMs };
}

export function isMediaSlotEndedOrStale(slot: any, nowMs = Date.now()) {
  const status = String(slot?.status || "").toLowerCase();
  if (
    slot?.deleted === true ||
    slot?.deletedAt ||
    slot?.pendingBackendFailed === true ||
    status === "deleted" ||
    status === "cancelled" ||
    status === "canceled" ||
    status === "completed" ||
    status === "complete" ||
    status === "removed" ||
    status === "ended" ||
    status === "closed" ||
    status === "cleared"
  ) {
    return true;
  }

  const scheduleStatus = String(slot?.scheduleStatus || "").toLowerCase();
  if (
    scheduleStatus === "deleted" ||
    scheduleStatus === "ended" ||
    scheduleStatus === "closed" ||
    scheduleStatus === "cleared"
  ) {
    return true;
  }

  const { endMs } = resolveMediaSlotTimeWindow(slot, nowMs);
  return endMs > 0 && nowMs > endMs;
}

export function isMediaScheduleConflictCandidate(slot: any, nowMs = Date.now()) {
  if (!slot || typeof slot !== "object") return false;
  if (isMediaSlotEndedOrStale(slot, nowMs)) return false;
  return true;
}

export type MediaScheduleConflictSlotGroup = {
  source: string;
  slots: any[];
  feedId?: string;
  sourceScheduleId?: string;
  churchId?: string;
  deleted?: boolean;
  scheduleStatus?: string;
};

export function summarizeMediaSlotConflictItem(
  slot: any,
  group: Pick<
    MediaScheduleConflictSlotGroup,
    "source" | "feedId" | "sourceScheduleId" | "churchId" | "deleted" | "scheduleStatus"
  >,
  nowMs = Date.now()
) {
  const window = resolveMediaSlotTimeWindow(slot, nowMs);
  return {
    feedId: String(group.feedId || slot?.feedId || slot?.sourceFeedId || ""),
    sourceScheduleId: String(
      group.sourceScheduleId || slot?.sourceScheduleId || slot?.scheduleId || ""
    ),
    churchId: String(group.churchId || slot?.churchId || ""),
    deleted: Boolean(group.deleted ?? slot?.deleted),
    scheduleStatus: String(group.scheduleStatus || slot?.scheduleStatus || slot?.status || ""),
    meetingDate: String(slot?.meetingDate || "").split("T")[0] || "",
    slotStartMs: window.startMs || null,
    slotEndMs: window.endMs || null,
    slotStartTime: String(slot?.startTime || "").trim() || null,
    slotEndTime: String(slot?.endTime || "").trim() || null,
    slotId: String(slot?.id || slot?.cardId || ""),
    slotName: String(slot?.name || slot?.title || ""),
    source: group.source,
  };
}

export function logMediaScheduleConflictItem(
  slot: any,
  group: MediaScheduleConflictSlotGroup,
  reason: string,
  nowMs = Date.now()
) {
  console.log("KRISTO_MEDIA_SLOT_CONFLICT_SOURCE", {
    reason,
    source: group.source,
    feedId: String(group.feedId || ""),
    sourceScheduleId: String(group.sourceScheduleId || ""),
    churchId: String(group.churchId || ""),
    deleted: Boolean(group.deleted),
    scheduleStatus: String(group.scheduleStatus || ""),
    slotCount: Array.isArray(group.slots) ? group.slots.length : 0,
  });
  console.log("KRISTO_MEDIA_SLOT_CONFLICT_ITEM", {
    reason,
    ...summarizeMediaSlotConflictItem(slot, group, nowMs),
  });
}

export function isStaleMediaBatchSpeakerSlot(slot: any) {
  const slotId = String(slot?.id || slot?.cardId || "").trim();
  const batchId = String(slot?.scheduleBatchId || "").trim();
  return slotId.startsWith("batch_") || batchId.startsWith("batch_");
}

export function shouldIgnoreStaleMediaSpeakerSlot(
  slot: any,
  group: MediaScheduleConflictSlotGroup,
  options?: {
    backendActiveScheduleCount?: number;
    meetingSentToSchedule?: boolean;
    reason?: string;
  }
) {
  if (String(group.source || "") !== "schedule-speaker-slots") return false;

  const backendCount = Number(options?.backendActiveScheduleCount ?? -1);
  const meetingSentToSchedule = Boolean(options?.meetingSentToSchedule);
  const feedId = String(group.feedId || slot?.feedId || slot?.sourceFeedId || "").trim();
  const sourceScheduleId = String(
    group.sourceScheduleId || slot?.sourceScheduleId || slot?.scheduleId || ""
  ).trim();
  const slotId = String(slot?.id || slot?.cardId || "").trim();
  const isStaleBatch = isStaleMediaBatchSpeakerSlot(slot);

  const shouldIgnore =
    backendCount === 0 &&
    !sourceScheduleId &&
    !feedId &&
    isStaleBatch &&
    !meetingSentToSchedule;

  if (shouldIgnore) {
    console.log("KRISTO_MEDIA_SPEAKER_SLOTS_IGNORED_STALE_BATCH", {
      reason: String(options?.reason || "conflict-check"),
      slotId,
      slotName: String(slot?.name || slot?.title || ""),
      backendActiveScheduleCount: backendCount,
      meetingSentToSchedule,
      feedId: feedId || null,
      sourceScheduleId: sourceScheduleId || null,
      scheduleBatchId: String(slot?.scheduleBatchId || "").trim() || null,
    });
  }

  return shouldIgnore;
}

export function filterMediaSpeakerSlotsForConflict(
  slots: any[],
  group: MediaScheduleConflictSlotGroup,
  options?: {
    backendActiveScheduleCount?: number;
    meetingSentToSchedule?: boolean;
    reason?: string;
    nowMs?: number;
  }
) {
  const nowMs = options?.nowMs ?? Date.now();
  const input = Array.isArray(slots) ? slots : [];
  const kept = input.filter((slot) => {
    if (!isMediaScheduleConflictCandidate(slot, nowMs)) return false;
    if (shouldIgnoreStaleMediaSpeakerSlot(slot, group, options)) return false;
    return true;
  });

  if (
    String(group.source || "") === "schedule-speaker-slots" &&
    input.length > 0 &&
    kept.length === 0
  ) {
    console.log("KRISTO_MEDIA_SPEAKER_SLOTS_CONFLICT_ALLOWED", {
      reason: String(options?.reason || "conflict-check"),
      inputSlotCount: input.length,
      keptSlotCount: kept.length,
      backendActiveScheduleCount: Number(options?.backendActiveScheduleCount ?? -1),
      meetingSentToSchedule: Boolean(options?.meetingSentToSchedule),
    });
  }

  return kept;
}

export function findMediaScheduleWindowConflict(
  startMs: number,
  endMs: number,
  groups: MediaScheduleConflictSlotGroup[],
  options?: {
    reason?: string;
    nowMs?: number;
    backendActiveScheduleCount?: number;
    meetingSentToSchedule?: boolean;
  }
) {
  const nowMs = options?.nowMs ?? Date.now();
  const reason = String(options?.reason || "findMediaScheduleWindowConflict");

  if (!Number.isFinite(startMs) || !Number.isFinite(endMs) || endMs <= startMs) {
    return null;
  }

  for (const group of groups) {
    const slots = Array.isArray(group.slots) ? group.slots : [];
    const activeSlots =
      String(group.source || "") === "schedule-speaker-slots"
        ? filterMediaSpeakerSlotsForConflict(slots, group, {
            backendActiveScheduleCount: options?.backendActiveScheduleCount,
            meetingSentToSchedule: options?.meetingSentToSchedule,
            reason,
            nowMs,
          })
        : slots.filter((slot) => isMediaScheduleConflictCandidate(slot, nowMs));

    for (const slot of activeSlots) {
      const existing = resolveMediaSlotTimeWindow(slot, nowMs);
      if (!existing.startMs || !existing.endMs || existing.endMs <= existing.startMs) {
        continue;
      }

      const overlaps = startMs < existing.endMs && endMs > existing.startMs;
      if (!overlaps) continue;

      logMediaScheduleConflictItem(slot, group, reason, nowMs);
      return { slot, group, existing };
    }
  }

  return null;
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
    const meetingEndDate = formatLocalMeetingDateFromMs(endMs);
    const resolvedDurationMin = Math.max(1, Math.round((endMs - startMs) / 60000));
    const startsAt = new Date(startMs).toISOString();
    const endsAt = new Date(endMs).toISOString();
    const meetingDay = formatMeetingDayLabel(startMs) || scheduleDay || slot?.meetingDay;

    console.log("KRISTO_MEDIA_SLOT_TIME_ASSIGNED", {
      reason,
      index,
      slotId: String(slot?.id || ""),
      name: String(slot?.name || ""),
      startMs,
      endMs,
      startsAt,
      endsAt,
      startTime,
      endTime,
      durationMin: resolvedDurationMin,
      meetingDate,
      meetingEndDate,
    });

    cursorMs = endMs;

    return {
      ...slot,
      durationMin: resolvedDurationMin,
      durationMinutes: resolvedDurationMin,
      minutes: resolvedDurationMin,
      startMs,
      endMs,
      startsAt,
      endsAt,
      startTime,
      endTime,
      timeLabel: `${startTime} - ${endTime}`,
      meetingDate,
      meetingEndDate,
      meetingDay,
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
    const slot = active.find((s) => String(s?.id || "") === row.slotId);
    const group: MediaScheduleConflictSlotGroup = {
      source: reason,
      slots: active,
    };
    if (slot) {
      logMediaScheduleConflictItem(slot, group, reason, nowMs);
    } else {
      console.log("KRISTO_MEDIA_SLOT_CONFLICT_ITEM", {
        reason,
        source: reason,
        slotId: row.slotId,
        slotName: row.name,
        conflict: row.conflict,
        slotStartMs: row.startMs,
        slotEndMs: row.endMs,
      });
    }
  }

  return conflicts.length;
}

export function deriveMediaSlotDurationMin(slot: any) {
  const window = resolveMediaSlotTimeWindow(slot);
  if (window.endMs > window.startMs) {
    return Math.max(1, Math.round((window.endMs - window.startMs) / 60000));
  }
  return Math.max(0, Number(slot?.durationMin || slot?.durationMinutes || 0));
}

export function summarizeGuestClaimSlotForLog(slot: any, order = 0) {
  const window = resolveMediaSlotTimeWindow(slot);
  return {
    order,
    slotId: String(slot?.id || ""),
    startMs: window.startMs || null,
    endMs: window.endMs || null,
    startsAt: String(slot?.startsAt || "").trim() || null,
    endsAt: String(slot?.endsAt || "").trim() || null,
    startTime: String(slot?.startTime || "").trim() || null,
    endTime: String(slot?.endTime || "").trim() || null,
    durationMin: deriveMediaSlotDurationMin(slot),
    slotOrder: Number(slot?.order || slot?.slot || slot?.slotNumber || 0) || null,
  };
}

export function sortSlotsForGuestClaimCenter(slots: any[], nowMs = Date.now()) {
  return [...slots].sort((a: any, b: any) => {
    const da = resolveMediaSlotTimeWindow(a, nowMs);
    const db = resolveMediaSlotTimeWindow(b, nowMs);

    const aStart = Number(da?.startMs || 0);
    const bStart = Number(db?.startMs || 0);

    const aEnd =
      Number(da?.endMs || 0) ||
      (aStart ? aStart + Math.max(1, deriveMediaSlotDurationMin(a)) * 60 * 1000 : 0);

    const bEnd =
      Number(db?.endMs || 0) ||
      (bStart ? bStart + Math.max(1, deriveMediaSlotDurationMin(b)) * 60 * 1000 : 0);

    const rank = (start: number, end: number) => {
      if (start && end && nowMs >= start && nowMs <= end) return 0;
      if (end && nowMs > end) return 2;
      return 1;
    };

    const ar = rank(aStart, aEnd);
    const br = rank(bStart, bEnd);

    if (ar !== br) return ar - br;
    if (ar === 2) return bEnd - aEnd;
    return aStart - bStart;
  });
}

function sortSlotsChronologically(slots: any[]) {
  return [...slots].sort((a, b) => {
    const wa = resolveMediaSlotTimeWindow(a);
    const wb = resolveMediaSlotTimeWindow(b);
    const startDiff = wa.startMs - wb.startMs;
    if (startDiff !== 0) return startDiff;
    return String(a?.id || "").localeCompare(String(b?.id || ""));
  });
}

export function materializeMediaSlotTimeFields(slot: any) {
  const window = resolveMediaSlotTimeWindow(slot);
  const startMs = Number(slot?.startMs || window.startMs || 0);
  let endMs = Number(slot?.endMs || window.endMs || 0);
  if (!(startMs > 0 && endMs > startMs)) {
    return { ...slot };
  }

  const durationMin = Math.max(1, Math.round((endMs - startMs) / 60000));
  endMs = startMs + durationMin * 60000;
  const startTime = formatClockFromMs(startMs);
  const endTime = formatClockFromMs(endMs);

  return {
    ...slot,
    startMs,
    endMs,
    startsAt: new Date(startMs).toISOString(),
    endsAt: new Date(endMs).toISOString(),
    meetingDate: formatLocalMeetingDateFromMs(startMs),
    meetingEndDate: formatLocalMeetingDateFromMs(endMs),
    meetingDay: formatMeetingDayLabel(startMs) || String(slot?.meetingDay || "").trim(),
    startTime,
    endTime,
    timeLabel: `${startTime} - ${endTime}`,
    durationMin,
    durationMinutes: durationMin,
  };
}

function cascadeMediaScheduleSlotsFromIndex(slots: any[], fromIndex: number) {
  const out = slots.map((slot) => ({ ...slot }));
  for (let i = Math.max(0, fromIndex + 1); i < out.length; i++) {
    const prev = materializeMediaSlotTimeFields(out[i - 1]);
    out[i - 1] = prev;
    const prevEnd = Number(prev.endMs || 0);
    if (!prevEnd) continue;

    const cur = out[i];
    const curWindow = resolveMediaSlotTimeWindow(cur);
    const durationMin = Math.max(
      1,
      deriveMediaSlotDurationMin(cur) ||
        (curWindow.endMs > curWindow.startMs
          ? Math.round((curWindow.endMs - curWindow.startMs) / 60000)
          : 1)
    );

    out[i] = materializeMediaSlotTimeFields({
      ...cur,
      startMs: prevEnd,
      endMs: prevEnd + durationMin * 60000,
      durationMin,
      manuallyModified: true,
    });
  }
  return out;
}

export function applyGuestClaimDurationDelta(
  slots: any[],
  slotId: string,
  minutesDelta: number,
  minDurationMin = 5
) {
  const ordered = sortSlotsChronologically(slots);
  const targetIdx = ordered.findIndex((slot) => String(slot?.id || "") === String(slotId));
  if (targetIdx < 0) return { slots, changed: false };

  const target = ordered[targetIdx];
  const window = resolveMediaSlotTimeWindow(target);
  if (!(window.startMs > 0 && window.endMs > window.startMs)) {
    return { slots, changed: false };
  }

  const nextEndMs = Math.max(
    window.startMs + minDurationMin * 60000,
    window.endMs + minutesDelta * 60000
  );

  ordered[targetIdx] = materializeMediaSlotTimeFields({
    ...target,
    startMs: window.startMs,
    endMs: nextEndMs,
    manuallyModified: true,
  });

  const cascaded = cascadeMediaScheduleSlotsFromIndex(ordered, targetIdx);
  const byId = new Map(cascaded.map((slot) => [String(slot?.id || ""), slot]));
  return {
    slots: slots.map((slot) => byId.get(String(slot?.id || "")) || slot),
    changed: true,
  };
}

const GUEST_CLAIM_SLOT_TIME_KEYS = [
  "startMs",
  "endMs",
  "startsAt",
  "endsAt",
  "meetingDate",
  "meetingEndDate",
  "meetingDay",
  "startTime",
  "endTime",
  "timeLabel",
  "durationMin",
  "durationMinutes",
] as const;

function extractGuestClaimSlotTimeFields(slot: any) {
  const out: Record<string, unknown> = {};
  for (const key of GUEST_CLAIM_SLOT_TIME_KEYS) {
    if (slot?.[key] !== undefined) out[key] = slot[key];
  }
  return out;
}

export function swapGuestClaimSlotTimesWithNeighbor(
  slots: any[],
  slotId: string,
  direction: "up" | "down",
  nowMs = Date.now()
) {
  const ordered = sortSlotsForGuestClaimCenter(slots, nowMs);
  const fromIdx = ordered.findIndex((slot) => String(slot?.id || "") === String(slotId));
  const toIdx = direction === "up" ? fromIdx - 1 : fromIdx + 1;
  if (fromIdx < 0 || toIdx < 0 || toIdx >= ordered.length) {
    return { slots, changed: false, fromIdx, toIdx: -1, neighborSlotId: "" };
  }

  const idA = String(ordered[fromIdx]?.id || "");
  const idB = String(ordered[toIdx]?.id || "");
  const byId = new Map(slots.map((slot) => [String(slot?.id || ""), { ...slot }]));
  const slotA = byId.get(idA);
  const slotB = byId.get(idB);
  if (!slotA || !slotB) {
    return { slots, changed: false, fromIdx, toIdx, neighborSlotId: idB };
  }

  const aTimes = extractGuestClaimSlotTimeFields(slotA);
  const bTimes = extractGuestClaimSlotTimeFields(slotB);

  byId.set(idA, materializeMediaSlotTimeFields({ ...slotA, ...bTimes }));
  byId.set(idB, materializeMediaSlotTimeFields({ ...slotB, ...aTimes }));

  return {
    slots: slots.map((slot) => byId.get(String(slot?.id || "")) || slot),
    changed: true,
    fromIdx,
    toIdx,
    neighborSlotId: idB,
  };
}
