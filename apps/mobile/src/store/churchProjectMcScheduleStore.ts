import AsyncStorage from "@react-native-async-storage/async-storage";
export type McScheduleItem = {
  id: string;
  mcId: string;
  name: string;
  role: string;
  startTime: string;
  endTime: string;
  meetingDate?: string;
  durationMin: number;
  task: string;
  script: string;
  chat: string[];
  sourceSlotName?: string;
  isDurationLocked?: boolean;
};

export type MeetingPlanDraft = {
  day: string;
  time: string;
  type: string;
  topic: string;
  target: string;
  sentToSchedule: boolean;
};

export type ScheduleSlotDraft = {
  id: string;
  name: string;
  minutes: number;
  startTime?: string;
  endTime?: string;
  timeLabel?: string;
  meetingDate?: string;
  meetingDay?: string;
  role?: string;
  task?: string;
  script?: string;
  slotTopic?: string;
  assignmentTopic?: string;
  topic?: string;
  chat?: string[];
  sourceSlotName?: string;
  isDurationLocked?: boolean;
  scheduleBatchId?: string;
};

export type ChurchProjectMcScheduleState = {
  assignmentId: string;
  eventTitle: string;
  eventDateLabel: string;
  liveStartsAt: string;
  sentToMc: boolean;
  meetingPlan: MeetingPlanDraft;
  guestCount: number;
  scheduleSlots: ScheduleSlotDraft[];
  items: McScheduleItem[];
  participantPools: {
    mc: string[];
    prayer: string[];
    choir: string[];
    testimony: string[];
    announcements: string[];
    offering: string[];
    guests: string[];
  };
};

const listeners = new Set<() => void>();
const store = new Map<string, ChurchProjectMcScheduleState>();
const hydratedKeys = new Set<string>();

const STORAGE_PREFIX = "kristo.mcSchedule.";

function storageKey(key: string) {
  return `${STORAGE_PREFIX}${key}`;
}

function persistState(key: string, state: ChurchProjectMcScheduleState) {
  AsyncStorage.setItem(storageKey(key), JSON.stringify(state)).catch(() => {});
}

async function hydrateState(key: string) {
  if (hydratedKeys.has(key)) return;
  hydratedKeys.add(key);

  try {
    const raw = await AsyncStorage.getItem(storageKey(key));
    if (!raw) return;

    const parsed = JSON.parse(raw);
    const current = store.get(key) || seedState(key);

    store.set(key, {
      ...current,
      ...parsed,
      meetingPlan: {
        ...current.meetingPlan,
        ...(parsed?.meetingPlan || {}),
      },
      participantPools: {
        ...current.participantPools,
        ...(parsed?.participantPools || {}),
      },
      scheduleSlots: Array.isArray(parsed?.scheduleSlots) ? parsed.scheduleSlots : current.scheduleSlots,
      items: Array.isArray(parsed?.items) ? parsed.items : current.items,
    });

    emit();
  } catch {}
}

function emit() {
  listeners.forEach((fn) => fn());
}

export function subscribeChurchProjectMcSchedule(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

type WeightedRange = {
  min: number;
  max: number;
  weight: number;
};

function pickWeightedRange(ranges: WeightedRange[]) {
  const total = ranges.reduce((sum, r) => sum + r.weight, 0);
  let roll = Math.random() * total;

  for (const range of ranges) {
    if (roll < range.weight) return range;
    roll -= range.weight;
  }

  return ranges[0];
}

function randomInt(min: number, max: number) {
  const safeMin = Math.ceil(Math.min(min, max));
  const safeMax = Math.floor(Math.max(min, max));
  return Math.floor(Math.random() * (safeMax - safeMin + 1)) + safeMin;
}

function pickMinutesByProgram(slotName: string, fallbackMinutes: number) {
  const key = String(slotName || "").trim().toLowerCase();

  const choose = (ranges: WeightedRange[]) => {
    const picked = pickWeightedRange(ranges);
    return randomInt(picked.min, picked.max);
  };

  if (key.includes("sermon") || key.includes("mahubiri") || key.includes("main direction")) {
    return choose([
      { min: 30, max: 35, weight: 50 },
      { min: 15, max: 30, weight: 25 },
      { min: 35, max: 45, weight: 12.5 },
      { min: 45, max: 60, weight: 6 },
      { min: 60, max: 90, weight: 3 },
    ]);
  }

  if (key.includes("opening prayer") || key.includes("closing prayer") || key === "prayer") {
    return choose([
      { min: 3, max: 5, weight: 45 },
      { min: 5, max: 8, weight: 30 },
      { min: 8, max: 12, weight: 15 },
      { min: 12, max: 18, weight: 7 },
      { min: 18, max: 25, weight: 3 },
    ]);
  }

  if (key.includes("mc")) {
    return choose([
      { min: 3, max: 6, weight: 45 },
      { min: 6, max: 10, weight: 30 },
      { min: 10, max: 15, weight: 15 },
      { min: 15, max: 20, weight: 7 },
      { min: 20, max: 30, weight: 3 },
    ]);
  }

  if (key.includes("choir") || key.includes("worship") || key.includes("song")) {
    return choose([
      { min: 8, max: 12, weight: 40 },
      { min: 12, max: 18, weight: 30 },
      { min: 18, max: 25, weight: 18 },
      { min: 25, max: 35, weight: 8 },
      { min: 35, max: 45, weight: 4 },
    ]);
  }

  if (key.includes("testimony") || key.includes("ushuhuda")) {
    return choose([
      { min: 4, max: 7, weight: 45 },
      { min: 7, max: 10, weight: 30 },
      { min: 10, max: 15, weight: 15 },
      { min: 15, max: 20, weight: 7 },
      { min: 20, max: 30, weight: 3 },
    ]);
  }

  if (key.includes("announcement")) {
    return choose([
      { min: 3, max: 5, weight: 50 },
      { min: 5, max: 8, weight: 28 },
      { min: 8, max: 12, weight: 14 },
      { min: 12, max: 18, weight: 6 },
      { min: 18, max: 25, weight: 2 },
    ]);
  }

  if (key.includes("offering")) {
    return choose([
      { min: 4, max: 7, weight: 45 },
      { min: 7, max: 10, weight: 30 },
      { min: 10, max: 15, weight: 15 },
      { min: 15, max: 20, weight: 7 },
      { min: 20, max: 30, weight: 3 },
    ]);
  }

  if (key.includes("guest") || key.includes("protocol")) {
    return choose([
      { min: 3, max: 6, weight: 50 },
      { min: 6, max: 10, weight: 28 },
      { min: 10, max: 15, weight: 14 },
      { min: 15, max: 20, weight: 6 },
      { min: 20, max: 30, weight: 2 },
    ]);
  }

  return Math.max(1, Number(fallbackMinutes || 5));
}

function parseTimeToMinutes(label: string) {
  const safe = String(label || "").trim();
  const match = safe.match(/^(\d{1,2}):(\d{2})\s*(AM|PM)$/i);

  if (!match) return 19 * 60;

  let hour = Number(match[1]);
  const minute = Number(match[2]);
  const period = match[3].toUpperCase();

  if (period === "AM") {
    if (hour === 12) hour = 0;
  } else {
    if (hour !== 12) hour += 12;
  }

  return hour * 60 + minute;
}

function formatMinutesToTime(totalMinutes: number) {
  const dayMinutes = 24 * 60;
  const safe = ((Math.round(totalMinutes) % dayMinutes) + dayMinutes) % dayMinutes;
  const hour24 = Math.floor(safe / 60);
  const minute = safe % 60;
  const period = hour24 >= 12 ? "PM" : "AM";

  let hour12 = hour24 % 12;
  if (hour12 === 0) hour12 = 12;

  return `${hour12}:${String(minute).padStart(2, "0")} ${period}`;
}

function getProgramName(slotName: string) {
  const key = String(slotName || "").trim().toLowerCase();

  if (key.includes("opening prayer")) return "Prayer";
  if (key.includes("closing prayer")) return "Prayer";
  if (key.includes("prayer")) return "Prayer";
  if (key.includes("mc")) return "MC";
  if (key.includes("choir") || key.includes("worship") || key.includes("song")) return "Choir";
  if (key.includes("testimony") || key.includes("ushuhuda")) return "Testimony";
  if (key.includes("announcement")) return "Announcements";
  if (key.includes("offering")) return "Offering";
  if (key.includes("guest") || key.includes("protocol")) return "Guests";
  if (key.includes("sermon") || key.includes("mahubiri") || key.includes("main direction")) {
    return "Sermon";
  }

  return String(slotName || "Program").trim() || "Program";
}

function getRoleForProgram(programName: string) {
  const key = String(programName || "").trim().toLowerCase();

  if (key === "mc") return "Main MC";
  if (key === "prayer") return "Leader";
  if (key === "choir") return "Choir group";
  if (key === "testimony") return "Selected people";
  if (key === "announcements") return "Church admin";
  if (key === "offering") return "Treasury team";
  if (key === "guests") return "Protocol team";
  if (key === "sermon") return "Pastor / preacher";

  return "Assigned team";
}

function getTaskForProgram(programName: string, slotName: string) {
  const key = String(programName || "").trim().toLowerCase();
  const label = String(slotName || "").trim();

  if (key === "mc") return `${label} lead`;
  if (key === "prayer") return `${label} lead prayer`;
  if (key === "choir") return `${label} presentation`;
  if (key === "testimony") return `${label} sharing`;
  if (key === "announcements") return `${label} updates`;
  if (key === "offering") return `${label} collection flow`;
  if (key === "guests") return `${label} reception flow`;
  if (key === "sermon") return `${label} preaching`;

  return label || "Program flow";
}

function getScriptForProgram(programName: string, slotName: string, durationMin: number) {
  const key = String(programName || "").trim().toLowerCase();
  const label = String(slotName || "").trim() || "Program";

  if (key === "sermon") {
    return `Deliver the main message clearly within ${durationMin} minutes and keep the spiritual focus strong.`;
  }
  if (key === "mc") {
    return `Guide ${label.toLowerCase()} smoothly, keep energy stable, and preserve clean transitions.`;
  }
  if (key === "prayer") {
    return `Lead ${label.toLowerCase()} with calm direction and stay within ${durationMin} minutes.`;
  }
  if (key === "choir") {
    return `Present ${label.toLowerCase()} with clean setup, strong timing, and smooth exit.`;
  }

  return `Handle ${label.toLowerCase()} clearly and finish within ${durationMin} minutes.`;
}

function buildItemsFromSlots(
  slots: ScheduleSlotDraft[],
  liveStartsAt: string
): McScheduleItem[] {
  let cursor = parseTimeToMinutes(liveStartsAt);

  return slots.map((slot, index) => {
    const hasRealClock =
      !!String(slot.startTime || "").trim() &&
      !!String(slot.endTime || "").trim();

    const durationMin = Math.max(
      1,
      Number(
        hasRealClock
          ? (slot.minutes || 0)
          : pickMinutesByProgram(slot.name, slot.minutes)
      ) || 1
    );

    const startTime = hasRealClock
      ? String(slot.startTime || "").trim()
      : formatMinutesToTime(cursor);

    const endTime = hasRealClock
      ? String(slot.endTime || "").trim()
      : formatMinutesToTime(cursor + durationMin);

    const programName = String(slot.name || "").trim() || `Program ${index + 1}`;

    const item: McScheduleItem = {
      id: slot.id || `slot-${index + 1}`,
      mcId: `mc-${index + 1}`,
      name: programName,
      role: String(slot.role || "").trim() || getRoleForProgram(programName),
      startTime,
      endTime,
      meetingDate: String(slot.meetingDate || slot.meetingDay || "").trim(),
      durationMin,
      task: String(slot.task || "").trim() || getTaskForProgram(programName, slot.name),
      script: String(slot.script || "").trim() || getScriptForProgram(programName, slot.name, durationMin),
      chat:
        Array.isArray(slot.chat) && slot.chat.length
          ? slot.chat
          : [`Start at ${startTime}`, `End by ${endTime}`, `Keep ${durationMin} min flow`],
      sourceSlotName: String(slot.sourceSlotName || slot.name || "").trim() || slot.name,
      isDurationLocked:
        typeof slot.isDurationLocked === "boolean" ? slot.isDurationLocked : hasRealClock,
    };

    if (!hasRealClock) {
      cursor += durationMin;
    } else {
      const parsedEnd = parseClockLabelToMinutes(endTime);
      if (parsedEnd != null) {
        cursor = parsedEnd;
      } else {
        cursor += durationMin;
      }
    }

    return item;
  });
}

export function rebuildScheduleTimeline(
  items: McScheduleItem[],
  liveStartsAt: string,
  slots?: ScheduleSlotDraft[]
): McScheduleItem[] {
  let cursor = parseTimeToMinutes(liveStartsAt);

  return items.map((item, index) => {
    const slotMatch = slots?.find((slot) => slot.id === item.id);
    const sourceSlotName =
      String(item.sourceSlotName || slotMatch?.name || item.name || "Program").trim();

    const nextDuration =
      item.isDurationLocked
        ? Math.max(1, Number(item.durationMin || 1))
        : pickMinutesByProgram(sourceSlotName, slotMatch?.minutes || item.durationMin || 5);

    const startTime = formatMinutesToTime(cursor);
    const endTime = formatMinutesToTime(cursor + nextDuration);

    const nextItem: McScheduleItem = {
      ...item,
      durationMin: nextDuration,
      startTime,
      endTime,
      meetingDate: String(
        slotMatch?.meetingDate || slotMatch?.meetingDay || item.meetingDate || ""
      ).trim(),
      sourceSlotName,
      chat: [`Start at ${startTime}`, `End by ${endTime}`, `Keep ${nextDuration} min flow`],
    };

    cursor += nextDuration;
    return nextItem;
  });
}

function seedState(assignmentId: string): ChurchProjectMcScheduleState {
  const liveStartsAt = "7:00 PM";
  const scheduleSlots: ScheduleSlotDraft[] = [
    { id: "slot-1", name: "Opening prayer", minutes: 5 },
    { id: "slot-2", name: "MC Opening", minutes: 6 },
    { id: "slot-3", name: "Choir", minutes: 12 },
    { id: "slot-4", name: "Main direction", minutes: 15 },
    { id: "slot-5", name: "Testimony", minutes: 7 },
    { id: "slot-6", name: "Announcements", minutes: 5 },
    { id: "slot-7", name: "Closing prayer", minutes: 5 },
  ];

  return {
    assignmentId,
    eventTitle: "Election Live Event",
    eventDateLabel: "Tonight",
    liveStartsAt,
    sentToMc: false,
    meetingPlan: {
      day: "Today",
      time: "7:30 PM",
      type: "Leaders meeting",
      topic: "Weekly alignment",
      target: "Leaders",
      sentToSchedule: false,
    },
    participantPools: {
      mc: ["MC 1", "MC 2", "MC 3", "Main MC", "Assistant MC", "Youth MC"],
      prayer: ["Pastor 1", "Pastor 2", "Leader 1", "Leader 2", "Intercessor team"],
      choir: ["Choir A", "Choir B", "Youth Choir", "Mass Choir"],
      testimony: ["Member 1", "Member 2", "Member 3", "Selected members"],
      announcements: ["Secretary", "MC", "Church admin", "Media desk"],
      offering: ["Usher team A", "Usher team B", "Treasury team"],
      guests: ["Protocol 1", "Protocol 2", "Reception team"],
    } as ChurchProjectMcScheduleState["participantPools"],
    guestCount: 1,
    scheduleSlots,
    items: buildItemsFromSlots(scheduleSlots, liveStartsAt),
  };
}

export function getChurchProjectMcScheduleState(assignmentId: string) {
  const key = String(assignmentId || "default");
  if (!store.has(key)) {
    store.set(key, seedState(key));
  }

  hydrateState(key);

  return store.get(key)!;
}

export function saveChurchProjectMcSchedule(
  assignmentId: string,
  payload: Partial<ChurchProjectMcScheduleState>
) {
  const current = getChurchProjectMcScheduleState(assignmentId);

  const key = String(assignmentId || "default");
  const next = {
    ...current,
    ...payload,
    items: payload.items || current.items,
    sentToMc:
      typeof payload.sentToMc === "boolean" ? payload.sentToMc : current.sentToMc,
  };

  store.set(key, next);
  persistState(key, next);
  emit();
}

export function markChurchProjectMcScheduleSent(assignmentId: string, value = true) {
  const current = getChurchProjectMcScheduleState(assignmentId);
  const key = String(assignmentId || "default");
  const next = {
    ...current,
    sentToMc: value,
  };

  store.set(key, next);
  persistState(key, next);
  emit();
}

export function getChurchProjectMcRuntime(assignmentId: string) {
  const state = getChurchProjectMcScheduleState(assignmentId);
  const current =
    state.items[0] || {
      id: "slot-x",
      mcId: "mc-x",
      name: "MC",
      role: "MC",
      startTime: "--",
      endTime: "--",
      durationMin: 0,
      task: "Waiting",
      script: "",
      chat: [],
      sourceSlotName: "MC",
      isDurationLocked: false,
    };
  const next = state.items[1] || current;

  return {
    current,
    next,
    items: state.items,
    scheduleSlots: state.scheduleSlots,
    eventTitle: state.eventTitle,
    eventDateLabel: state.eventDateLabel,
    liveStartsAt: state.liveStartsAt,
    sentToMc: state.sentToMc,
  };
}

export function getChurchProjectMcRuntimeView(assignmentId: string) {
  return getChurchProjectMcRuntime(assignmentId);
}

export function saveChurchProjectMeetingPlan(
  assignmentId: string,
  payload: Partial<MeetingPlanDraft>
) {
  const current = getChurchProjectMcScheduleState(assignmentId);
  const key = String(assignmentId || "default");
  const next = {
    ...current,
    meetingPlan: {
      ...current.meetingPlan,
      ...payload,
    },
  };

  store.set(key, next);
  persistState(key, next);
  emit();
}

export function saveChurchProjectScheduleSlots(
  assignmentId: string,
  slots: ScheduleSlotDraft[]
) {
  const current = getChurchProjectMcScheduleState(assignmentId);
  const nextItems = buildItemsFromSlots(slots, current.liveStartsAt);

  const key = String(assignmentId || "default");
  const next = {
    ...current,
    scheduleSlots: slots,
    items: nextItems,
  };

  store.set(key, next);
  persistState(key, next);
  emit();
}

export function saveChurchProjectGuestCount(
  assignmentId: string,
  guestCount: number
) {
  const current = getChurchProjectMcScheduleState(assignmentId);
  const key = String(assignmentId || "default");
  const next = {
    ...current,
    guestCount,
  };

  store.set(key, next);
  persistState(key, next);
  emit();
}

export function getParticipantPoolForProgram(
  assignmentId: string,
  programName: string
) {
  const state = getChurchProjectMcScheduleState(assignmentId);
  const key = String(programName || "").trim().toLowerCase();

  if (key === "mc") return state.participantPools.mc;
  if (key === "prayer") return state.participantPools.prayer;
  if (key === "choir") return state.participantPools.choir;
  if (key === "testimony") return state.participantPools.testimony;
  if (key === "announcements") return state.participantPools.announcements;
  if (key === "offering") return state.participantPools.offering;
  if (key === "guests") return state.participantPools.guests;
  if (key === "sermon") return state.participantPools.prayer;

  return [];
}


function parseClockLabelToMinutes(label: string) {
  const safe = String(label || "").trim();
  const match = safe.match(/^(\d{1,2}):(\d{2})\s*(AM|PM)$/i);
  if (!match) return null;

  let hour = Number(match[1]);
  const minute = Number(match[2]);
  const period = match[3].toUpperCase();

  if (period === "AM") {
    if (hour === 12) hour = 0;
  } else {
    if (hour !== 12) hour += 12;
  }

  return hour * 60 + minute;
}

function getNowMinutes() {
  const now = new Date();
  return now.getHours() * 60 + now.getMinutes();
}

export function getChurchProjectMcLiveSlotState(
  assignmentId: string,
  nowMinutes?: number
) {
  const state = getChurchProjectMcScheduleState(assignmentId);
  const items = Array.isArray(state.items) ? state.items : [];
  const nowMin = typeof nowMinutes === "number" ? nowMinutes : getNowMinutes();

  let current = items[0] || null;
  let next = items[1] || items[0] || null;

  for (let i = 0; i < items.length; i += 1) {
    const item = items[i];
    const start = parseClockLabelToMinutes(item.startTime);
    const end = parseClockLabelToMinutes(item.endTime);

    if (start == null || end == null) continue;

    if (nowMin >= start && nowMin < end) {
      current = item;
      next = items[i + 1] || item;
      return {
        current,
        next,
        nowMinutes: nowMin,
        items,
      };
    }

    if (nowMin < start) {
      current = i > 0 ? items[i - 1] : item;
      next = item;
      return {
        current,
        next,
        nowMinutes: nowMin,
        items,
      };
    }
  }

  return {
    current,
    next,
    nowMinutes: nowMin,
    items,
  };
}


export function isStaleMediaBatchSpeakerSlot(slot: any) {
  const slotId = String(slot?.id || slot?.cardId || "").trim();
  const batchId = String(slot?.scheduleBatchId || "").trim();
  return slotId.startsWith("batch_") || batchId.startsWith("batch_");
}

export function listStaleMediaBatchIds(slots: ScheduleSlotDraft[]) {
  const batchIds = new Set<string>();
  for (const slot of slots) {
    const batchId = String(slot?.scheduleBatchId || "").trim();
    if (batchId.startsWith("batch_")) batchIds.add(batchId);
    const slotId = String(slot?.id || "").trim();
    if (slotId.startsWith("batch_")) {
      const prefix = slotId.split("-slot-")[0];
      if (prefix.startsWith("batch_")) batchIds.add(prefix);
    }
  }
  return Array.from(batchIds);
}

export function clearChurchProjectScheduleSlots(assignmentId: string) {
  const key = String(assignmentId || "default");
  const state = getChurchProjectMcScheduleState(key);
  const next = {
    ...state,
    scheduleSlots: [],
    items: [],
    guestCount: 0,
    sentToMc: false,
    meetingPlan: {
      ...state.meetingPlan,
      sentToSchedule: false,
    },
  };

  store.set(key, next);
  persistState(key, next);
  emit();
}

export function hasStaleMediaBatchSpeakerSlots(assignmentId: string) {
  const key = String(assignmentId || "media-schedule").trim() || "media-schedule";
  const state = getChurchProjectMcScheduleState(key);
  const slots = Array.isArray(state.scheduleSlots) ? state.scheduleSlots : [];
  return slots.some((slot) => isStaleMediaBatchSpeakerSlot(slot));
}

export function shouldClearMediaScheduleSpeakerSlots(assignmentId: string) {
  const key = String(assignmentId || "media-schedule").trim() || "media-schedule";
  const state = getChurchProjectMcScheduleState(key);
  const slots = Array.isArray(state.scheduleSlots) ? state.scheduleSlots : [];
  if (!slots.length) return false;
  return (
    Boolean(state.meetingPlan?.sentToSchedule) ||
    slots.some((slot) => isStaleMediaBatchSpeakerSlot(slot))
  );
}

export function clearMediaScheduleSpeakerSlots(
  assignmentId: string,
  reason: string
) {
  const key = String(assignmentId || "media-schedule").trim() || "media-schedule";
  const state = getChurchProjectMcScheduleState(key);
  const previousSlots = Array.isArray(state.scheduleSlots) ? state.scheduleSlots : [];
  const previousBatchIds = listStaleMediaBatchIds(previousSlots);

  clearChurchProjectScheduleSlots(key);

  const afterState = getChurchProjectMcScheduleState(key);

  console.log("KRISTO_MEDIA_SPEAKER_SLOTS_STALE_CLEARED", {
    assignmentId: key,
    reason,
    previousSlotCount: previousSlots.length,
    previousBatchIds,
    meetingSentToSchedule: Boolean(state.meetingPlan?.sentToSchedule),
  });
  console.log("KRISTO_MEDIA_SPEAKER_SLOTS_AFTER_CLEAR", {
    assignmentId: key,
    reason,
    slotCount: afterState.scheduleSlots.length,
    meetingSentToSchedule: afterState.meetingPlan.sentToSchedule,
  });
}
