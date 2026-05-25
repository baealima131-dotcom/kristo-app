export type ScheduleSlotPhase = "open" | "claimed" | "live" | "ended" | "upcoming";

export type EnrichedScheduleSlot = {
  id?: string;
  name?: string;
  slotLabel?: string;
  role?: string;
  task?: string;
  script?: string;
  meetingDate?: string;
  meetingDay?: string;
  startTime?: string;
  endTime?: string;
  durationMin?: number;
  startMs: number;
  endMs: number;
  isLiveNow: boolean;
  isUpcoming: boolean;
  isEnded: boolean;
  claimedByUserId?: string;
  claimedByName?: string;
  claimedByAvatar?: string;
  claimedBy?: any;
  claimed?: boolean;
  isClaimed?: boolean;
  status?: string;
  locked?: boolean;
  approved?: boolean;
  queue?: any[];
};

export function parseSlotClockMs(rawDate: string, rawTime: string) {
  if (!rawDate || !rawTime) return 0;

  const base = new Date(rawDate);
  if (!Number.isFinite(base.getTime())) return 0;

  const [timePart = "12:00", meridiemRaw = "AM"] = rawTime.split(" ");
  const [hhRaw = "12", mmRaw = "00"] = timePart.split(":");

  let hh = Number(hhRaw || 0);
  const mm = Number(mmRaw || 0);
  const meridiem = meridiemRaw.toUpperCase();

  if (meridiem === "PM" && hh < 12) hh += 12;
  if (meridiem === "AM" && hh === 12) hh = 0;

  return new Date(base.getFullYear(), base.getMonth(), base.getDate(), hh, mm, 0, 0).getTime();
}

export function parseSlotStartMs(slot: any) {
  const rawDate = String(slot?.meetingDate || slot?.meetingDay || "").trim();
  const rawTime = String(slot?.startTime || slot?.time || "").trim();

  if (!rawDate) return 0;

  const base = new Date(rawDate);
  if (!Number.isFinite(base.getTime())) return 0;
  if (!rawTime) return base.getTime();

  return parseSlotClockMs(rawDate, rawTime);
}

export function enrichScheduleSlot(slot: any, index: number, nowMs: number): EnrichedScheduleSlot {
  const startMs = parseSlotStartMs(slot);
  const endMsFromClock = parseSlotClockMs(String(slot?.meetingDate || ""), String(slot?.endTime || ""));
  const durationMs = Math.max(1, Number(slot?.durationMin || 10)) * 60000;
  const endMs = endMsFromClock > startMs ? endMsFromClock : startMs + durationMs;

  return {
    ...slot,
    startMs,
    endMs,
    isLiveNow: startMs > 0 && endMs > 0 && nowMs >= startMs && nowMs <= endMs,
    isUpcoming: startMs > nowMs,
    isEnded: endMs > 0 && nowMs > endMs,
  };
}

export function resolveSlotPhase(slot: EnrichedScheduleSlot, claimed: boolean): ScheduleSlotPhase {
  if (slot.isEnded) return "ended";
  if (slot.isLiveNow) return "live";
  if (claimed) return "claimed";
  if (slot.isUpcoming) return "upcoming";
  return "open";
}

export function formatSlotDateLabel(iso?: string, fallback?: string) {
  if (!iso) return fallback || "Today";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return fallback || "Today";
  return d.toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

export function resolveAvatarUri(raw: string, apiBase: string) {
  const trimmed = String(raw || "").trim();
  if (!trimmed) return "";
  if (trimmed.startsWith("/uploads/")) return `${apiBase}${trimmed}`;
  return trimmed;
}

export function baseFeedId(input: unknown) {
  const id = String(input || "").trim();
  if (!id) return "";
  return id.split("__slot_")[0];
}

export const SLOT_STATE_THEMES: Record<
  ScheduleSlotPhase,
  { accent: string; border: string; glow: string; label: string; gradient: [string, string, string] }
> = {
  open: {
    accent: "#38BDF8",
    border: "rgba(56,189,248,0.55)",
    glow: "rgba(56,189,248,0.35)",
    label: "OPEN SLOT",
    gradient: ["#07111F", "#0B1A2E", "#050A14"],
  },
  claimed: {
    accent: "#A78BFA",
    border: "rgba(167,139,250,0.58)",
    glow: "rgba(167,139,250,0.32)",
    label: "CLAIMED",
    gradient: ["#120B1F", "#1A1230", "#0A0612"],
  },
  live: {
    accent: "#FF375F",
    border: "rgba(255,55,95,0.72)",
    glow: "rgba(255,55,95,0.42)",
    label: "LIVE NOW",
    gradient: ["#1A0710", "#240812", "#120509"],
  },
  ended: {
    accent: "#64748B",
    border: "rgba(100,116,139,0.45)",
    glow: "rgba(100,116,139,0.18)",
    label: "ENDED",
    gradient: ["#10141C", "#141A24", "#0A0D12"],
  },
  upcoming: {
    accent: "#F7D36A",
    border: "rgba(247,211,106,0.62)",
    glow: "rgba(247,211,106,0.28)",
    label: "UPCOMING",
    gradient: ["#14110A", "#1A160D", "#0C0A06"],
  },
};
