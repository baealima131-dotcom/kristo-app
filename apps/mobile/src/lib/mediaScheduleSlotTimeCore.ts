import { parseSlotEndMs, parseSlotStartMs } from "@/lib/scheduleSlotUtils";

export type MediaSlotTimeWindow = {
  startMs: number;
  endMs: number;
};

function parseIsoMs(value: unknown) {
  const raw = String(value || "").trim();
  if (!raw) return 0;
  const parsed = Date.parse(raw);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 0;
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

function formatMeetingDayLabel(ms: number) {
  if (!ms) return "";
  return new Date(ms).toLocaleDateString("en-US", {
    month: "long",
    day: "numeric",
    year: "numeric",
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
