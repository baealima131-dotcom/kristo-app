import {
  buildLeanLiveScheduleSlotsJson,
  isScheduleSlotExpired,
  parseSlotEndMs,
  parseSlotStartMs,
  utf8JsonByteLength,
} from "@/src/lib/scheduleSlotUtils";

export type MinistryLiveActivationState = {
  scheduleReady: boolean;
  liveStillActive: boolean;
  liveEnded: boolean;
  firstSlotStart: number | null;
  firstSlotEnd: number | null;
  activeSlotId: string | null;
  /** Room entry during an active live window — claim is not required. */
  canEnterLive: boolean;
  /** Backstage / ready room before the live window opens. */
  canEnterBackstage: boolean;
  /** Mic/camera/broadcast controls for the active slot. */
  canUseMicCamera: boolean;
  /** Host/broadcast start controls (leader, pastor, host, or claimed slot). */
  canHostOrStartBroadcast: boolean;
  /** @deprecated alias for canHostOrStartBroadcast */
  canStartLive: boolean;
  viewerHasClaim: boolean;
  /** Slot-participation hint only — never blocks canEnterLive. */
  requiresClaim: boolean;
  reason: string;
};

export type MinistryLiveActivationLogContext = {
  roomId: string;
  ministryId: string;
  currentTime: number;
  viewerUserId: string;
  ministryRole: string;
  churchRole?: string;
  viewerIsHost: boolean;
  viewerIsLeader: boolean;
  viewerIsPastor: boolean;
  hasSubscription?: boolean | null;
  state: MinistryLiveActivationState;
};

export function extractAssignmentScheduleCards(messages: any[], nowMs = Date.now()) {
  return (Array.isArray(messages) ? messages : [])
    .filter((m) => String(m?.kind || "") === "assignment_card" && m?.card)
    .filter((m) => !isScheduleSlotExpired(m.card, nowMs))
    .map((m) => ({
      messageId: String(m?.id || ""),
      card: m.card as Record<string, unknown>,
    }));
}

export function resolveAssignmentMeetingWindowFromCards(
  cards: Array<{ card: Record<string, unknown> }>,
  nowMs = Date.now()
) {
  const rows = cards
    .map(({ card }) => {
      const startMs = parseSlotStartMs(card);
      const endMs = parseSlotEndMs(card, startMs);
      return startMs > 0 && endMs > startMs ? { startMs, endMs, card } : null;
    })
    .filter(Boolean) as Array<{ startMs: number; endMs: number; card: Record<string, unknown> }>;

  if (!rows.length) {
    return {
      startMs: null as number | null,
      endMs: null as number | null,
      activeSlotId: null as string | null,
    };
  }

  rows.sort((a, b) => a.startMs - b.startMs);
  const active = rows.find((row) => nowMs >= row.startMs && nowMs <= row.endMs) || null;

  return {
    startMs: rows[0]?.startMs ?? null,
    endMs: rows.reduce((max, row) => Math.max(max, row.endMs), rows[0].endMs),
    activeSlotId: active
      ? String(active.card?.cardId || active.card?.id || "")
      : null,
  };
}

export function viewerHasClaimedAssignmentCard(
  card: Record<string, unknown>,
  viewerUserId: string
) {
  const uid = String(viewerUserId || "").trim();
  if (!uid) return false;

  const claimedByUserId = String(
    card?.claimedByUserId ||
      card?.claimedUserId ||
      card?.userId ||
      card?.assigneeUserId ||
      ""
  ).trim();

  return claimedByUserId === uid;
}

export function viewerHasClaimedAnyAssignmentCard(
  cards: Array<{ card: Record<string, unknown> }>,
  viewerUserId: string
) {
  return cards.some(({ card }) => viewerHasClaimedAssignmentCard(card, viewerUserId));
}

export function resolveMinistryLiveCanPublishForEntry(args: {
  viewerHasClaim: boolean;
  viewerIsPastor: boolean;
  viewerIsHost: boolean;
  isSelectedMcHost?: boolean;
}): boolean {
  return (
    resolveMinistryLiveMicForEntry(args) ||
    resolveMinistryLiveCameraForEntry({ viewerHasClaim: args.viewerHasClaim })
  );
}

/** Mic-only entry for Pastor / Host / Leader without claim, or any claimed slot. */
export function resolveMinistryLiveMicForEntry(args: {
  viewerHasClaim: boolean;
  viewerIsPastor: boolean;
  viewerIsHost: boolean;
  viewerIsLeader?: boolean;
  isSelectedMcHost?: boolean;
}): boolean {
  if (args.viewerIsPastor || args.viewerIsHost || args.viewerIsLeader) return true;
  if (args.isSelectedMcHost === true) return true;
  if (args.viewerHasClaim) return true;
  return false;
}

/** Camera/video publish — claimed slot only (no auto-grant to pastor/host/leader). */
export function resolveMinistryLiveCameraForEntry(args: {
  viewerHasClaim: boolean;
}): boolean {
  return args.viewerHasClaim === true;
}

export function resolveMinistryLiveViewerOnlyFromRouteParams(
  params: Record<string, unknown> | null | undefined
): boolean {
  const p = params || {};
  const isMinistry =
    String(p.room || "").toLowerCase() === "ministry" ||
    String(p.mediaScope || "").toLowerCase() === "ministry" ||
    String(p.roomKind || "").toLowerCase().includes("ministry") ||
    String(p.source || "").toLowerCase().includes("ministry-live");
  if (!isMinistry) return false;
  if (String(p.canPublishMic || "") === "1") return false;
  if (String(p.canPublishCamera || "") === "1") return false;
  return (
    String(p.enteredAsViewer || "") === "1" ||
    String(p.canPublish || "") !== "1"
  );
}

export function assignmentCardsToLiveScheduleSlots(
  cards: Array<{ messageId: string; card: Record<string, unknown> }>
) {
  return cards
    .map(({ card, messageId }, index) => {
      const startMs = parseSlotStartMs(card);
      const endMs = parseSlotEndMs(card, startMs);
      const slotNumber = Math.max(
        1,
        Number(card?.slotNumber || card?.order || card?.slotLabel || index + 1)
      );
      const slotId = String(card?.cardId || card?.id || messageId || `slot-${slotNumber}`);
      return {
        ...card,
        id: slotId,
        cardId: slotId,
        slotNumber,
        startMs,
        endMs,
        name: String(card?.title || card?.task || card?.slotLabel || `Slot ${slotNumber}`),
        title: String(card?.title || card?.task || card?.slotLabel || `Slot ${slotNumber}`),
      };
    })
    .filter((slot) => Number(slot.startMs) > 0 && Number(slot.endMs) > Number(slot.startMs))
    .sort(
      (a, b) =>
        Number(a.startMs) - Number(b.startMs) ||
        Number(a.slotNumber || 0) - Number(b.slotNumber || 0)
    );
}

export function buildMinistryLiveRoomRouteParams(args: {
  messages: any[];
  roomId: string;
  ministryId: string;
  threadId: string;
  headerTitle: string;
  subtitle?: string;
  viewerUserId: string;
  resolvedLiveRole: string;
  resolvedCanPublish: boolean;
  resolvedCanPublishMic?: boolean;
  resolvedCanPublishCamera?: boolean;
  entryMode: string;
  preview?: boolean;
  ministryActivation: MinistryLiveActivationState;
  meetingTopic?: string;
  churchId?: string;
  actualChurchPastorUserId?: string;
  enteredAsViewer?: boolean;
  ministryAvatarUrl?: string;
}): Record<string, string> {
  const cards = extractAssignmentScheduleCards(args.messages);
  const slots = assignmentCardsToLiveScheduleSlots(cards);
  const leanSlotsJson = buildLeanLiveScheduleSlotsJson(slots);
  const sourceScheduleId = `ministry_${String(args.roomId || args.threadId || "").trim()}`;
  const activeSlot =
    slots.find((slot) => String(slot.id) === String(args.ministryActivation.activeSlotId || "")) ||
    slots.find(
      (slot) =>
        args.ministryActivation.firstSlotStart &&
        Number(slot.startMs) === Number(args.ministryActivation.firstSlotStart)
    ) ||
    slots[0] ||
    null;
  const routeSlotNumber = Math.max(1, Number(activeSlot?.slotNumber || 1));
  const layout = slots.length > 0 ? "grid6" : "focus";
  const pastorUserId = String(args.actualChurchPastorUserId || "").trim();
  const ministryAvatarUrl = String(args.ministryAvatarUrl || "").trim();

  const canPublishMic =
    args.resolvedCanPublishMic ??
    (args.resolvedCanPublish ? true : false);
  const canPublishCamera =
    args.resolvedCanPublishCamera ??
    (args.resolvedCanPublish ? true : false);

  console.log("KRISTO_MINISTRY_LIVE_ROUTE_BUILD", {
    roomId: args.roomId,
    ministryId: args.ministryId,
    slotCount: slots.length,
    routeSlotNumber,
    layout,
    leanSlotsByteLen: utf8JsonByteLength(leanSlotsJson),
    sourceScheduleId,
    enteredAsViewer: args.enteredAsViewer === true,
    canPublish: canPublishMic || canPublishCamera,
    canPublishMic,
    canPublishCamera,
  });

  return {
    source: "ministry-live",
    liveMode: "scheduled",
    layout,
    entryMode: args.entryMode,
    preview: args.preview ? "1" : "0",
    role: args.resolvedLiveRole,
    mode: args.resolvedCanPublish ? "host" : "viewer",
    room: "ministry",
    roomKind: "ministry-live",
    mediaScope: "ministry",
    scheduleType: "ministry-live-slots",
    assignmentId: args.threadId,
    roomId: args.roomId,
    sourceRoomId: args.roomId,
    ministryId: args.ministryId,
    churchId: String(args.churchId || ""),
    sourceScheduleId,
    localScheduleId: sourceScheduleId,
    feedId: sourceScheduleId,
    liveId: String(args.ministryActivation.activeSlotId || activeSlot?.id || sourceScheduleId),
    liveAllScheduleSlotsJson: leanSlotsJson,
    currentSlotNumber: String(routeSlotNumber),
    preferredSlotNumber: String(routeSlotNumber),
    claimedSlotNumber: String(routeSlotNumber),
    scheduleStartMs: String(args.ministryActivation.firstSlotStart || activeSlot?.startMs || ""),
    scheduleEndMs: String(args.ministryActivation.firstSlotEnd || activeSlot?.endMs || ""),
    liveStartMs: String(args.ministryActivation.firstSlotStart || activeSlot?.startMs || ""),
    liveEndMs: String(args.ministryActivation.firstSlotEnd || activeSlot?.endMs || ""),
    title: String(args.headerTitle || "Ministry Live").slice(0, 120),
    subtitle: String(args.subtitle || activeSlot?.title || "Ministry Live").slice(0, 120),
    ...(ministryAvatarUrl
      ? {
          ministryAvatarUrl,
          avatar: ministryAvatarUrl,
          avatarUri: ministryAvatarUrl,
        }
      : {}),
    meetingTopic: String(args.meetingTopic || args.headerTitle || "").slice(0, 120),
    canPublish: canPublishMic || canPublishCamera ? "1" : "0",
    canPublishMic: canPublishMic ? "1" : "0",
    canPublishCamera: canPublishCamera ? "1" : "0",
    mediaSlotPublisher: canPublishCamera ? "1" : "0",
    pastorUserId,
    mediaOwnerPastorUserId: pastorUserId,
    enteredAsViewer: args.enteredAsViewer === true ? "1" : "0",
    membersCount: "26",
    leadersCount: "4",
  };
}

export function resolveMinistryLiveActivationState(args: {
  messages: any[];
  nowMs: number;
  viewerUserId: string;
  viewerIsLeader: boolean;
  viewerIsHost: boolean;
  viewerIsPastor: boolean;
  preliveTeamOpenMs?: number;
}): MinistryLiveActivationState {
  const nowMs = Number(args.nowMs || Date.now());
  const preliveTeamOpenMs = args.preliveTeamOpenMs ?? 30 * 60 * 1000;
  const cards = extractAssignmentScheduleCards(args.messages, nowMs);
  const scheduleReady = cards.length > 0;
  const window = resolveAssignmentMeetingWindowFromCards(cards, nowMs);
  const startMs = window.startMs;
  const endMs = window.endMs;

  if (!scheduleReady || !startMs || !endMs) {
    return {
      scheduleReady,
      liveStillActive: false,
      liveEnded: false,
      firstSlotStart: startMs,
      firstSlotEnd: endMs,
      activeSlotId: window.activeSlotId,
      canEnterLive: false,
      canStartLive: false,
      canEnterBackstage: false,
      canUseMicCamera: false,
      canHostOrStartBroadcast: false,
      viewerHasClaim: false,
      requiresClaim: false,
      reason: scheduleReady ? "missing_slot_times" : "no_schedule",
    };
  }

  const liveStillActive = nowMs >= startMs && nowMs <= endMs;
  const liveEnded = nowMs > endMs;
  const viewerCanManageLive =
    args.viewerIsPastor || args.viewerIsLeader || args.viewerIsHost;
  const viewerHasClaim = viewerHasClaimedAnyAssignmentCard(cards, args.viewerUserId);
  const canHostOrStartBroadcast =
    args.viewerIsPastor || args.viewerIsHost || viewerHasClaim;
  const canUseMicCamera = resolveMinistryLiveCanPublishForEntry({
    viewerHasClaim,
    viewerIsPastor: args.viewerIsPastor,
    viewerIsHost: args.viewerIsHost,
  });
  const canEnterBackstage =
    !!viewerCanManageLive &&
    nowMs < startMs &&
    nowMs >= startMs - preliveTeamOpenMs;

  if (liveStillActive) {
    return {
      scheduleReady: true,
      liveStillActive: true,
      liveEnded: false,
      firstSlotStart: startMs,
      firstSlotEnd: endMs,
      activeSlotId: window.activeSlotId,
      canEnterLive: true,
      canHostOrStartBroadcast,
      canUseMicCamera,
      canStartLive: canHostOrStartBroadcast,
      canEnterBackstage: false,
      viewerHasClaim,
      requiresClaim: !canHostOrStartBroadcast,
      reason: canHostOrStartBroadcast
        ? args.viewerIsPastor || args.viewerIsHost
          ? "leader_or_host_live_window"
          : "claimed_slot_live_window"
        : "viewer_live_window",
    };
  }

  if (liveEnded) {
    return {
      scheduleReady: true,
      liveStillActive: false,
      liveEnded: true,
      firstSlotStart: startMs,
      firstSlotEnd: endMs,
      activeSlotId: null,
      canEnterLive: false,
      canStartLive: false,
      canEnterBackstage: false,
      canUseMicCamera: false,
      canHostOrStartBroadcast: false,
      viewerHasClaim,
      requiresClaim: false,
      reason: "window_ended",
    };
  }

  if (canEnterBackstage) {
    return {
      scheduleReady: true,
      liveStillActive: false,
      liveEnded: false,
      firstSlotStart: startMs,
      firstSlotEnd: endMs,
      activeSlotId: null,
      canEnterLive: false,
      canHostOrStartBroadcast: true,
      canUseMicCamera: true,
      canStartLive: true,
      canEnterBackstage: true,
      viewerHasClaim,
      requiresClaim: false,
      reason: "backstage_open",
    };
  }

  return {
    scheduleReady: true,
    liveStillActive: false,
    liveEnded: false,
    firstSlotStart: startMs,
    firstSlotEnd: endMs,
    activeSlotId: null,
    canEnterLive: false,
    canStartLive: false,
    canEnterBackstage: false,
    canUseMicCamera: false,
    canHostOrStartBroadcast: false,
    viewerHasClaim,
    requiresClaim: false,
    reason: "schedule_ready_waiting_for_window",
  };
}

export function logMinistryLiveActivationCheck(ctx: MinistryLiveActivationLogContext) {
  console.log("KRISTO_MINISTRY_LIVE_ACTIVATION_CHECK", {
    roomId: ctx.roomId,
    ministryId: ctx.ministryId,
    currentTime: ctx.currentTime,
    firstSlotStart: ctx.state.firstSlotStart,
    firstSlotEnd: ctx.state.firstSlotEnd,
    activeSlotId: ctx.state.activeSlotId,
    scheduleReady: ctx.state.scheduleReady,
    canEnterLive: ctx.state.canEnterLive,
    canStartLive: ctx.state.canStartLive,
    canHostOrStartBroadcast: ctx.state.canHostOrStartBroadcast,
    canUseMicCamera: ctx.state.canUseMicCamera,
    viewerHasClaim: ctx.state.viewerHasClaim,
    viewerUserId: ctx.viewerUserId,
    ministryRole: ctx.ministryRole,
    churchRole: ctx.churchRole ?? null,
    viewerIsHost: ctx.viewerIsHost,
    hasSubscription: ctx.hasSubscription ?? null,
    reason: ctx.state.reason,
  });
}

export function logMinistryLiveEnterRolePreserved(args: {
  userId: string;
  ministryRole: string;
  churchRole?: string;
  enteredAsViewer: boolean;
  claimedByMe: boolean;
  canEnterLive: boolean;
  canUseMicCamera: boolean;
  canHostOrStartBroadcast: boolean;
}) {
  console.log("KRISTO_MINISTRY_LIVE_ENTER_ROLE_PRESERVED", {
    userId: args.userId,
    ministryRole: args.ministryRole,
    churchRole: args.churchRole ?? null,
    enteredAsViewer: args.enteredAsViewer,
    claimedByMe: args.claimedByMe,
    canEnterLive: args.canEnterLive,
    canUseMicCamera: args.canUseMicCamera,
    canHostOrStartBroadcast: args.canHostOrStartBroadcast,
    roleMutated: false,
  });
}

export function logMinistryLiveStartAttempt(args: {
  roomId: string;
  ministryId: string;
  activeSlotId?: string | null;
  viewerUserId: string;
  allowed: boolean;
  endpoint?: string;
  status?: number | null;
  reason: string;
}) {
  console.log("KRISTO_MINISTRY_LIVE_START_ATTEMPT", {
    roomId: args.roomId,
    ministryId: args.ministryId,
    activeSlotId: args.activeSlotId || null,
    viewerUserId: args.viewerUserId,
    allowed: args.allowed,
    endpoint: args.endpoint || "/(tabs)/more/my-church-room/messages/live-room",
    status: args.status ?? null,
    reason: args.reason,
  });
}
