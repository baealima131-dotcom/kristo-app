/**
 * V1: Church live schedules live in Church Live Control (`church-media-room`),
 * not on the Live Slots feed screen.
 */

import { apiGet } from "@/src/lib/kristoApi";
import {
  buildPersistedMediaSlotTimeFields,
  materializeMediaSlotTimeFields,
} from "@/src/lib/mediaScheduleSlotTimes";
import {
  isScheduleSlotExpired,
  resolveScheduleSlotVisualState,
} from "@/src/lib/scheduleSlotUtils";

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
  const persisted = buildPersistedMediaSlotTimeFields(slot);

  return {
    cardId: slotId,
    slotLabel: String(opts.slotNumber),
    slotNumber: opts.slotNumber,
    order: opts.slotNumber,
    title: String(slot?.name || slot?.title || `Slot ${opts.slotNumber}`),
    subtitle: parentTopic || "Schedule",
    roleKey: String(slot?.role || "").toLowerCase(),
    roleLabel: String(slot?.role || ""),
    durationMin: Number(slot?.durationMin || slot?.minutes || persisted.durationMin || 0),
    startTime: persisted.startTime || String(slot?.startTime || ""),
    endTime: persisted.endTime || String(slot?.endTime || ""),
    meetingDate: persisted.meetingDate,
    meetingEndDate: persisted.meetingEndDate,
    meetingDay: persisted.meetingDay || String(slot?.meetingDay || ""),
    startMs: persisted.startMs > 0 ? persisted.startMs : undefined,
    endMs: persisted.endMs > persisted.startMs ? persisted.endMs : undefined,
    startsAt: persisted.startsAt,
    endsAt: persisted.endsAt,
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
    liveId: `live_${assignmentId}_${persisted.startMs > 0 ? persisted.startMs : now}`,
    meetingId: `meeting_${assignmentId}_${persisted.startMs > 0 ? persisted.startMs : now}`,
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
export function isChurchLiveControlScheduleRoomMessage(
  message: { kind?: string; card?: any },
  roomId?: string
): boolean {
  if (String(message?.kind || "") !== "assignment_card") return false;
  if (!message?.card || typeof message.card !== "object") return false;

  const rid = String(roomId || "").trim();
  if (rid && rid !== CHURCH_LIVE_CONTROL_SCHEDULE_ROOM_ID) return false;

  if (rid === CHURCH_LIVE_CONTROL_SCHEDULE_ROOM_ID) return true;

  const source = String(message.card?.source || "").toLowerCase();
  const roomKind = String(message.card?.roomKind || "").toLowerCase();
  return source === "church-live-control" || roomKind === "church-live-control";
}

export type ChurchLiveControlHomeFeedScheduleModel = {
  item: any;
  activeSlot: any;
  slotFeedIndex: number;
  slotFeedTotal: number;
};

function normalizeChurchLiveControlRoomScheduleSlot(
  card: any,
  message: { id?: string },
  slotNumber: number
) {
  const scheduleId = String(
    card?.sourceScheduleId || card?.sourceFeedId || message.id || ""
  ).trim();
  const slotId = String(
    card?.cardId || card?.id || message.id || `slot-${slotNumber}`
  ).trim();
  const durationMin = Math.max(1, Number(card?.durationMin || card?.minutes || 10));

  const rawSlot = {
    id: slotId,
    cardId: slotId,
    name: String(card?.title || card?.task || `Slot ${slotNumber}`),
    title: String(card?.title || ""),
    slotLabel: String(card?.slotLabel || `Slot ${slotNumber}`),
    slotNumber,
    slot: slotNumber,
    order: slotNumber,
    role: String(card?.roleLabel || card?.roleKey || card?.subtitle || ""),
    task: String(card?.task || card?.title || ""),
    parentTopic: String(card?.parentTopic || card?.topic || card?.subtitle || ""),
    slotTopic: String(card?.slotTopic || card?.topic || ""),
    scheduleTopic: String(card?.scheduleTopic || card?.topic || ""),
    meetingDate: String(card?.meetingDate || ""),
    meetingDay: String(card?.meetingDay || card?.meetingDate || ""),
    meetingEndDate: String(card?.meetingEndDate || ""),
    startTime: String(card?.startTime || ""),
    endTime: String(card?.endTime || ""),
    timeLabel: String(card?.timeLabel || ""),
    durationMin,
    durationMinutes: durationMin,
    startMs: Number(card?.startMs || 0) || undefined,
    endMs: Number(card?.endMs || 0) || undefined,
    startsAt: String(card?.startsAt || ""),
    endsAt: String(card?.endsAt || ""),
    claimedByUserId: String(card?.claimedByUserId || ""),
    claimedByName: String(card?.claimedByName || ""),
    claimedByAvatar: String(card?.claimedByAvatar || ""),
    claimedByRole: String(card?.claimedByRole || ""),
    claimedAt: String(card?.claimedAt || ""),
    status: String(card?.status || "open"),
    source: "church-live-control",
    roomKind: "church-live-control",
    sourceFeedId: scheduleId,
    sourceScheduleId: scheduleId,
    liveLayout: String(card?.liveLayout || "grid6"),
    roomMessageId: String(message.id || ""),
  };

  return materializeMediaSlotTimeFields(rawSlot);
}

/** Maps a Church Live Control room assignment_card to Live Slots feed-row shape. */
export function buildHomeFeedRowFromChurchLiveControlRoomMessage(
  message: { id?: string; card?: any },
  opts: {
    churchId?: string;
    churchName?: string;
    mediaName?: string;
    slotFeedTotal: number;
    slotFeedIndex: number;
    nowMs?: number;
  }
): ChurchLiveControlHomeFeedScheduleModel | null {
  const card = message?.card;
  if (!card || typeof card !== "object") return null;

  const scheduleId = String(
    card.sourceScheduleId || card.sourceFeedId || message.id || ""
  ).trim();
  const slotId = String(card.cardId || card.id || message.id || "").trim();
  if (!slotId) return null;

  const slotNumber = Math.max(
    1,
    Number(card.slotNumber || card.order || opts.slotFeedIndex + 1)
  );

  const activeSlot = normalizeChurchLiveControlRoomScheduleSlot(card, message, slotNumber);

  const rowId = scheduleId ? `${scheduleId}:slot:${slotId}` : `church-live-control:slot:${slotId}`;
  const mediaName = String(opts.mediaName || card?.mediaName || "Church Media").trim();

  const item = {
    id: rowId,
    feedOriginId: rowId,
    parentScheduleId: scheduleId,
    sourceScheduleId: scheduleId,
    scheduleSlots: [activeSlot],
    slotNumber,
    homeFeedSlotExpanded: true,
    parentScheduleSlotCount: Math.max(1, opts.slotFeedTotal),
    slotFeedIndex: opts.slotFeedIndex,
    source: "church-live-control",
    scheduleType: "media-live-slots",
    roomId: CHURCH_LIVE_CONTROL_SCHEDULE_ROOM_ID,
    roomKind: "church-live-control",
    assignmentId: CHURCH_LIVE_CONTROL_SCHEDULE_ROOM_ID,
    churchId: String(opts.churchId || "").trim(),
    churchName: String(opts.churchName || "").trim(),
    mediaName,
    actorLabel: mediaName,
    authorName: mediaName,
    topic: String(card.parentTopic || card.topic || card.subtitle || ""),
    scheduleTopic: String(card.scheduleTopic || card.parentTopic || ""),
    roomMessageId: String(message.id || ""),
  };

  const nowMs = Number(opts.nowMs || Date.now());
  const slotVisual = resolveScheduleSlotVisualState(activeSlot, opts.slotFeedIndex, nowMs, {
    slotId,
  });

  logChurchLiveControlScheduleCardDiagnostics({
    roomMessageId: String(message.id || ""),
    slotId,
    scheduleId,
    slotNumber,
    slotFeedIndex: opts.slotFeedIndex,
    slotFeedTotal: opts.slotFeedTotal,
    cardStartMs: Number(card?.startMs || 0) || null,
    cardEndMs: Number(card?.endMs || 0) || null,
    mappedStartMs: Number(activeSlot?.startMs || 0) || null,
    mappedEndMs: Number(activeSlot?.endMs || 0) || null,
    slotVisualPhase: slotVisual?.phase || null,
    slotVisualExpired: slotVisual?.expired ?? null,
    renderPayload: {
      itemId: item.id,
      slotTitle: String(activeSlot?.name || activeSlot?.title || ""),
      churchName: item.churchName,
      mediaName: item.mediaName,
      startTime: String(activeSlot?.startTime || ""),
      endTime: String(activeSlot?.endTime || ""),
      meetingDate: String(activeSlot?.meetingDate || ""),
      durationMin: Number(activeSlot?.durationMin || 0),
    },
  });

  return {
    item,
    activeSlot,
    slotFeedIndex: opts.slotFeedIndex,
    slotFeedTotal: Math.max(1, opts.slotFeedTotal),
  };
}

export function logChurchLiveControlScheduleCardDiagnostics(input: {
  roomMessageId?: string;
  slotId?: string;
  scheduleId?: string;
  slotNumber?: number;
  slotFeedIndex?: number;
  slotFeedTotal?: number;
  mappedSlotCount?: number;
  cardStartMs?: number | null;
  cardEndMs?: number | null;
  mappedStartMs?: number | null;
  mappedEndMs?: number | null;
  slotVisualPhase?: string | null;
  slotVisualExpired?: boolean | null;
  renderPayload?: Record<string, unknown>;
  guestClaimCenterSlotCount?: number;
}) {
  console.log("KRISTO_CHURCH_LIVE_CONTROL_SCHEDULE_DIAG", input);
}

/** Build a feed-shaped schedule row from Church Live Control room messages (Guest Claim Center). */
export function buildChurchLiveControlGuestCenterScheduleRow(
  roomMessages: Array<{ id?: string; kind?: string; card?: any; createdAt?: number }>,
  opts: {
    churchId?: string;
    churchName?: string;
    mediaName?: string;
    nowMs?: number;
  } = {}
): any | null {
  const scheduleMessages = (Array.isArray(roomMessages) ? roomMessages : []).filter((message) =>
    isChurchLiveControlScheduleRoomMessage(message, CHURCH_LIVE_CONTROL_SCHEDULE_ROOM_ID)
  );
  if (!scheduleMessages.length) return null;

  const groups = new Map<string, typeof scheduleMessages>();
  for (const message of scheduleMessages) {
    const scheduleId = String(
      message.card?.sourceScheduleId ||
        message.card?.sourceFeedId ||
        message.card?.scheduleBatchId ||
        message.id ||
        "default"
    ).trim();
    if (!groups.has(scheduleId)) groups.set(scheduleId, []);
    groups.get(scheduleId)!.push(message);
  }

  let bestScheduleId = "";
  let bestGroup: typeof scheduleMessages = [];
  for (const [scheduleId, group] of groups.entries()) {
    if (group.length > bestGroup.length) {
      bestGroup = group;
      bestScheduleId = scheduleId;
    }
  }
  if (!bestGroup.length) return null;

  const sorted = [...bestGroup].sort(
    (a, b) =>
      Number(a.card?.slotNumber || a.card?.order || 0) -
      Number(b.card?.slotNumber || b.card?.order || 0)
  );
  const slotFeedTotal = sorted.length;
  const scheduleSlots = sorted
    .map((message, slotFeedIndex) =>
      buildHomeFeedRowFromChurchLiveControlRoomMessage(message, {
        churchId: opts.churchId,
        churchName: opts.churchName,
        mediaName: opts.mediaName,
        slotFeedTotal,
        slotFeedIndex,
        nowMs: opts.nowMs,
      })?.activeSlot
    )
    .filter(Boolean);

  if (!scheduleSlots.length) return null;

  const scheduleId =
    bestScheduleId ||
    String(sorted[0]?.card?.sourceScheduleId || sorted[0]?.card?.sourceFeedId || "").trim();
  const mediaName = String(opts.mediaName || "Church Media").trim();

  const row = {
    id: scheduleId || `church-live-control-${Date.now()}`,
    sourceScheduleId: scheduleId,
    scheduleSlots,
    source: "church-live-control",
    scheduleType: "media-live-slots",
    roomId: CHURCH_LIVE_CONTROL_SCHEDULE_ROOM_ID,
    roomKind: "church-live-control",
    assignmentId: CHURCH_LIVE_CONTROL_SCHEDULE_ROOM_ID,
    churchId: String(opts.churchId || "").trim(),
    churchName: String(opts.churchName || "").trim(),
    mediaName,
    actorLabel: mediaName,
    authorName: mediaName,
  };

  logChurchLiveControlScheduleCardDiagnostics({
    scheduleId: row.sourceScheduleId,
    mappedSlotCount: scheduleSlots.length,
    guestClaimCenterSlotCount: scheduleSlots.length,
    renderPayload: {
      scheduleId: row.sourceScheduleId,
      slotIds: scheduleSlots.map((slot: any) => String(slot?.id || "")),
      slotNumbers: scheduleSlots.map((slot: any) => Number(slot?.slotNumber || 0)),
    },
  });

  return row;
}

export async function loadChurchLiveControlGuestCenterScheduleRow(
  headers?: Record<string, string>,
  opts: {
    churchId?: string;
    churchName?: string;
    mediaName?: string;
    nowMs?: number;
  } = {}
): Promise<any | null> {
  try {
    const res: any = await apiGet(
      `/api/church/room-messages?roomId=${encodeURIComponent(CHURCH_LIVE_CONTROL_SCHEDULE_ROOM_ID)}`,
      { headers: headers as any }
    );
    const rows = Array.isArray(res?.data) ? res.data : [];
    return buildChurchLiveControlGuestCenterScheduleRow(rows, opts);
  } catch {
    return null;
  }
}

/** Live Room runtime slots from Church Live Control room assignment_card messages. */
export function buildChurchLiveControlLiveRoomScheduleSlots(
  roomMessages: Array<{ id?: string; kind?: string; card?: any; createdAt?: number }>,
  opts: {
    churchId?: string;
    churchName?: string;
    mediaName?: string;
    nowMs?: number;
  } = {}
): { slots: any[]; scheduleId: string } | null {
  const row = buildChurchLiveControlGuestCenterScheduleRow(roomMessages, opts);
  if (!row) return null;

  const slots = Array.isArray(row.scheduleSlots) ? row.scheduleSlots : [];
  if (!slots.length) return null;

  return {
    slots,
    scheduleId: String(row.sourceScheduleId || row.id || "").trim(),
  };
}

export function buildChurchLiveControlScheduleRenderMap(
  messages: Array<{ id?: string; kind?: string; card?: any }>,
  opts: {
    roomId?: string;
    churchId?: string;
    churchName?: string;
    mediaName?: string;
    nowMs?: number;
  } = {}
): Record<string, ChurchLiveControlHomeFeedScheduleModel> {
  const roomId = String(opts.roomId || CHURCH_LIVE_CONTROL_SCHEDULE_ROOM_ID).trim();
  const scheduleMessages = (Array.isArray(messages) ? messages : []).filter((m) =>
    isChurchLiveControlScheduleRoomMessage(m, roomId)
  );

  const groups = new Map<string, typeof scheduleMessages>();
  for (const message of scheduleMessages) {
    const scheduleId = String(
      message.card?.sourceScheduleId ||
        message.card?.sourceFeedId ||
        message.card?.scheduleBatchId ||
        message.id ||
        "default"
    ).trim();
    if (!groups.has(scheduleId)) groups.set(scheduleId, []);
    groups.get(scheduleId)!.push(message);
  }

  const map: Record<string, ChurchLiveControlHomeFeedScheduleModel> = {};
  for (const group of groups.values()) {
    const sorted = [...group].sort(
      (a, b) =>
        Number(a.card?.slotNumber || a.card?.order || 0) -
        Number(b.card?.slotNumber || b.card?.order || 0)
    );
    const slotFeedTotal = sorted.length;
    sorted.forEach((message, slotFeedIndex) => {
      const built = buildHomeFeedRowFromChurchLiveControlRoomMessage(message, {
        churchId: opts.churchId,
        churchName: opts.churchName,
        mediaName: opts.mediaName,
        slotFeedTotal,
        slotFeedIndex,
        nowMs: opts.nowMs,
      });
      if (built && message.id) map[String(message.id)] = built;
    });
  }

  logChurchLiveControlScheduleCardDiagnostics({
    mappedSlotCount: Object.keys(map).length,
    slotFeedTotal: scheduleMessages.length,
    renderPayload: {
      roomMessageIds: Object.keys(map),
      slotIds: Object.values(map).map((entry) => String(entry.activeSlot?.id || "")),
    },
  });

  return map;
}

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
