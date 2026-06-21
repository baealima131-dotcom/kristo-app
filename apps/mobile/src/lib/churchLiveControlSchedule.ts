/**
 * V1: Church live schedules live in Church Live Control (`church-media-room`),
 * not on the Live Slots feed screen.
 */

import { apiGet } from "@/src/lib/kristoApi";
import { isScheduleSlotExpired } from "@/src/lib/scheduleSlotUtils";

export const CHURCH_LIVE_CONTROL_SCHEDULE_ROOM_ID = "church-media-room";

export function isChurchLiveControlScheduleScope(input: {
  roomId?: string;
  sourceRoomId?: string;
  assignmentId?: string;
  source?: string;
  mediaScope?: string;
  roomKind?: string;
}): boolean {
  const roomId = String(
    input.roomId || input.sourceRoomId || input.assignmentId || ""
  ).trim();
  const source = String(input.source || "").trim().toLowerCase();
  const mediaScope = String(input.mediaScope || "").trim().toLowerCase();
  const roomKind = String(input.roomKind || "").trim().toLowerCase();

  return (
    roomId === CHURCH_LIVE_CONTROL_SCHEDULE_ROOM_ID ||
    source === "church-live-control" ||
    mediaScope === "church" ||
    roomKind.includes("church-live-control")
  );
}

/** Feed/catalog rows that belong in Church Live Control room — exclude from Live Slots. */
export function isChurchLiveControlScheduleFeedRow(row: any): boolean {
  if (!row || typeof row !== "object") return false;

  const roomId = String(
    row?.roomId || row?.sourceRoomId || row?.assignmentId || ""
  ).trim();
  if (roomId === CHURCH_LIVE_CONTROL_SCHEDULE_ROOM_ID) return true;

  const roomKind = String(row?.roomKind || "").toLowerCase();
  if (roomKind.includes("church-live-control")) return true;

  const source = String(row?.source || "").toLowerCase();
  const scheduleType = String(row?.scheduleType || "").toLowerCase();

  if (source.includes("ministry") || scheduleType.includes("ministry")) {
    return false;
  }

  if (source.includes("media-schedule") && scheduleType.includes("media-live-slots")) {
    if (row?.isGlobalMediaSlot === true && String(row?.audience || "").includes("global")) {
      return false;
    }
    return true;
  }

  return false;
}

export function shouldShowScheduleRowInLiveSlots(row: any): boolean {
  return !isChurchLiveControlScheduleFeedRow(row);
}

/** Block new church schedule POSTs to /api/church/feed — use Church Live Control room instead. */
export function isIncomingChurchLiveControlScheduleFeedCreate(body: any): boolean {
  if (!body || typeof body !== "object") return false;

  const source = String(body?.source || "").toLowerCase();
  const scheduleType = String(body?.scheduleType || "").toLowerCase();
  const isMediaScheduleCreate =
    source === "media-schedule" || scheduleType === "media-live-slots";
  if (!isMediaScheduleCreate) return false;

  if (body?.isGlobalMediaSlot === true) return false;
  if (String(body?.audience || "").toLowerCase().includes("global")) return false;

  const ministryId = String(body?.ministryId || "").trim();
  if (ministryId) return false;

  const roomId = String(body?.roomId || body?.sourceRoomId || "").trim();
  if (roomId && roomId !== CHURCH_LIVE_CONTROL_SCHEDULE_ROOM_ID) return false;

  return true;
}

export function resolveChurchLiveControlSchedulePublishRoomId(
  input: {
    isMinistryLiveSchedule?: boolean;
    targetRoomId?: string;
    isChurchLiveControlScope?: boolean;
    isMediaSchedule?: boolean;
  } = {}
): string {
  if (input.isMinistryLiveSchedule) {
    return String(input.targetRoomId || "").trim();
  }

  if (
    input.isChurchLiveControlScope ||
    (input.isMediaSchedule && !input.isMinistryLiveSchedule)
  ) {
    return CHURCH_LIVE_CONTROL_SCHEDULE_ROOM_ID;
  }

  return String(input.targetRoomId || "").trim();
}

export function resolveChurchLiveControlScheduleRoomKind(input: {
  isMinistryLiveSchedule?: boolean;
  schedulePublishRoomId?: string;
  sourceParam?: string;
}): string {
  if (input.isMinistryLiveSchedule) return "ministry-live";
  if (input.schedulePublishRoomId === CHURCH_LIVE_CONTROL_SCHEDULE_ROOM_ID) {
    return "church-live-control";
  }
  return String(input.sourceParam || "my_ministries").trim() || "my_ministries";
}

export function buildChurchLiveControlScheduleRoomCard(
  slot: any,
  opts: { slotNumber: number; parentTopic?: string; assignmentId?: string; publishedAt?: number }
) {
  const now = opts.publishedAt ?? Date.now();
  const parentTopic = String(opts.parentTopic || slot?.role || slot?.task || "").trim();
  const assignmentId = String(opts.assignmentId || CHURCH_LIVE_CONTROL_SCHEDULE_ROOM_ID).trim();
  const slotId = String(slot?.id || slot?.cardId || `media-slot-${now}-${opts.slotNumber}`).trim();

  return {
    cardId: slotId,
    slotLabel: String(opts.slotNumber),
    slotNumber: opts.slotNumber,
    order: opts.slotNumber,
    title: String(slot?.name || slot?.title || `Slot ${opts.slotNumber}`),
    subtitle: parentTopic || "Schedule",
    roleKey: String(slot?.role || "").toLowerCase(),
    roleLabel: String(slot?.role || ""),
    durationMin: Number(slot?.durationMin || slot?.minutes || 0),
    startTime: String(slot?.startTime || ""),
    endTime: String(slot?.endTime || ""),
    meetingDate: String(slot?.meetingDate || slot?.meetingDay || ""),
    meetingDay: String(slot?.meetingDay || slot?.meetingDate || ""),
    timeLabel: String(
      slot?.timeLabel ||
        `${String(slot?.startTime || "").trim()} - ${String(slot?.endTime || "").trim()}`.trim()
    ),
    task: String(slot?.task || slot?.name || ""),
    slotTopic: parentTopic,
    assignmentTopic: parentTopic,
    topic: parentTopic,
    script: parentTopic,
    scheduleTopic: parentTopic,
    meetingTopic: parentTopic,
    parentTopic,
    notes: Array.isArray(slot?.chat) ? slot.chat : [],
    musicItems: Array.isArray(slot?.musicItems) ? slot.musicItems : [],
    status: "open" as const,
    visibility: "published" as const,
    claimedByUserId: String(slot?.claimedByUserId || ""),
    claimedByName: String(slot?.claimedByName || ""),
    claimedByRole: String(slot?.claimedByRole || ""),
    claimedByAvatar: String(slot?.claimedByAvatar || ""),
    claimedAt: String(slot?.claimedAt || ""),
    likeCount: Number(slot?.likeCount || 0),
    commentCount: Number(slot?.commentCount || 0),
    publishedAt: now,
    sourceFeedId: String(slot?.sourceFeedId || slot?.sourceScheduleId || ""),
    source: "church-live-control",
    roomKind: "church-live-control",
    liveLayout: "grid6",
    liveId: `live_${assignmentId}_${now}`,
    meetingId: `meeting_${assignmentId}_${now}`,
  };
}

export const CHURCH_LIVE_CONTROL_ROOM_NAV_PARAMS = {
  id: CHURCH_LIVE_CONTROL_SCHEDULE_ROOM_ID,
  title: "Church Live Control",
  sub: "Whole church assignment room",
  tab: "ministries",
  source: "church-live-control",
  roomKind: "assignment",
  assignmentId: CHURCH_LIVE_CONTROL_SCHEDULE_ROOM_ID,
  assignmentTitle: "Church Live Control",
  assignmentSubtitle: "Whole church assignment room",
  assignmentInitials: "C",
} as const;

export type ChurchLiveControlRoomScheduleSnapshot = {
  slotCount: number;
  openSlotCount: number;
  cards: any[];
};

/** Returns open (non-expired) assignment cards in Church Live Control room. */
export async function findActiveChurchLiveControlScheduleFromRoom(
  headers?: Record<string, string>,
  nowMs = Date.now()
): Promise<ChurchLiveControlRoomScheduleSnapshot | null> {
  try {
    const res: any = await apiGet(
      `/api/church/room-messages?roomId=${encodeURIComponent(CHURCH_LIVE_CONTROL_SCHEDULE_ROOM_ID)}`,
      { headers: headers as any }
    );
    const rows = Array.isArray(res?.data) ? res.data : [];
    const cards = rows.filter(
      (row: any) => String(row?.kind || "") === "assignment_card" && row?.card
    );
    if (!cards.length) return null;

    const openCards = cards.filter(
      (row: any) => !isScheduleSlotExpired(row.card, nowMs)
    );
    if (!openCards.length) return null;

    return {
      slotCount: cards.length,
      openSlotCount: openCards.length,
      cards: openCards,
    };
  } catch {
    return null;
  }
}
