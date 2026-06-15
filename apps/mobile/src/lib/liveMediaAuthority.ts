export type LiveMediaAuthorityInput = {
  currentUserId?: string;
  actualChurchPastorUserId?: string;
  churchPastorUserId?: string;
  scheduleCreatedByUserId?: string;
  createdByUserId?: string;
  createdBy?: string;
  mediaHostIds?: string | string[];
  backendLivePastorUserId?: string;
};

export type LiveMediaAuthority = {
  actualChurchPastorUserId: string;
  scheduleCreatedByUserId: string;
  mediaHostIds: string[];
  isActualChurchPastor: boolean;
  isMediaScheduleCreator: boolean;
  isMediaHost: boolean;
  isMediaOwnerHost: boolean;
};

export function parseMediaHostIds(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value.map((x) => String(x || "").trim()).filter(Boolean);
  }

  return String(value || "")
    .split(/[,\s]+/)
    .map((x) => x.trim())
    .filter(Boolean);
}

export function resolveActualChurchPastorUserId(input: LiveMediaAuthorityInput): string {
  return String(
    input.actualChurchPastorUserId ||
    input.churchPastorUserId ||
    input.backendLivePastorUserId ||
    ""
  ).trim();
}

export function resolveScheduleCreatedByUserId(input: LiveMediaAuthorityInput): string {
  return String(
    input.scheduleCreatedByUserId ||
    input.createdByUserId ||
    ""
  ).trim();
}

export function evaluateLiveMediaAuthority(
  input: LiveMediaAuthorityInput
): LiveMediaAuthority {
  const currentUserId = String(input.currentUserId || "").trim();
  const actualChurchPastorUserId = resolveActualChurchPastorUserId(input);
  const scheduleCreatedByUserId = resolveScheduleCreatedByUserId(input);
  const mediaHostIds = parseMediaHostIds(input.mediaHostIds);

  const isActualChurchPastor =
    !!currentUserId && actualChurchPastorUserId === currentUserId;
  const isMediaScheduleCreator =
    !!currentUserId && scheduleCreatedByUserId === currentUserId;
  const isMediaHost =
    !!currentUserId && mediaHostIds.includes(currentUserId);
  const isMediaOwnerHost =
    isActualChurchPastor || isMediaScheduleCreator || isMediaHost;

  return {
    actualChurchPastorUserId,
    scheduleCreatedByUserId,
    mediaHostIds,
    isActualChurchPastor,
    isMediaScheduleCreator,
    isMediaHost,
    isMediaOwnerHost,
  };
}

export type FastLiveSessionAuthority = {
  trustedActualChurchPastorUserId: string;
  trustedIsActualChurchPastor: boolean;
  trustedIsMediaScheduleCreator: boolean;
  trustedOwnsActiveSlot: boolean;
  reasons: string[];
};

/** Trusted session/route authority — does not wait for /api/church/members. */
export function evaluateFastLiveSessionAuthority(input: {
  currentUserId?: string;
  sessionRoleText?: string;
  sessionChurchRole?: string;
  routePastorUserId?: string;
  routeScheduleCreatorUserId?: string;
  routeClaimedByUserId?: string;
  currentSlotOwnerId?: string;
}): FastLiveSessionAuthority {
  const uid = String(input.currentUserId || "").trim();
  const sessionPastor =
    String(input.sessionRoleText || "").includes("pastor") ||
    String(input.sessionChurchRole || "").toLowerCase().includes("pastor");
  const routePastor = String(input.routePastorUserId || "").trim();
  const scheduleCreator = String(input.routeScheduleCreatorUserId || "").trim();
  const routeClaimed = String(input.routeClaimedByUserId || "").trim();
  const slotOwner = String(input.currentSlotOwnerId || routeClaimed || "").trim();
  const reasons: string[] = [];

  let trustedActualChurchPastorUserId = "";
  if (uid && sessionPastor) {
    trustedActualChurchPastorUserId = uid;
    reasons.push("session-pastor-role");
  } else if (uid && routePastor && routePastor === uid) {
    trustedActualChurchPastorUserId = uid;
    reasons.push("route-pastor-user-id");
  }

  const trustedIsMediaScheduleCreator = !!uid && scheduleCreator === uid;
  if (trustedIsMediaScheduleCreator) reasons.push("schedule-creator");

  const trustedOwnsActiveSlot = !!uid && slotOwner === uid;
  if (trustedOwnsActiveSlot) reasons.push("active-slot-owner");

  return {
    trustedActualChurchPastorUserId,
    trustedIsActualChurchPastor:
      !!uid && trustedActualChurchPastorUserId === uid,
    trustedIsMediaScheduleCreator,
    trustedOwnsActiveSlot,
    reasons,
  };
}

export function resolveFastActiveSlotWindow(input: {
  currentUserId?: string;
  currentSlotOwnerId?: string;
  currentSlotStartMs?: number;
  currentSlotEndMs?: number;
  routeClaimedByUserId?: string;
  routeScheduleStartMs?: number;
  routeScheduleEndMs?: number;
  nowMs?: number;
}) {
  const uid = String(input.currentUserId || "").trim();
  let ownerId = String(input.currentSlotOwnerId || "").trim();
  let startMs = Number(input.currentSlotStartMs || 0);
  let endMs = Number(input.currentSlotEndMs || 0);
  const routeClaimed = String(input.routeClaimedByUserId || "").trim();

  if (!ownerId && routeClaimed) ownerId = routeClaimed;
  if (uid && routeClaimed === uid) {
    if (!startMs) startMs = Number(input.routeScheduleStartMs || 0);
    if (!endMs) endMs = Number(input.routeScheduleEndMs || 0);
  }

  const nowMs = Number(input.nowMs || Date.now());
  const ownsActiveSlot = !!uid && ownerId === uid;
  const windowOpen =
    ownsActiveSlot &&
    isScheduleSlotCameraWindowOpen(
      { claimedByUserId: ownerId, startMs, endMs },
      uid,
      nowMs
    );

  return { ownerId, startMs, endMs, windowOpen, ownsActiveSlot };
}

export function applyFastLiveStageAuthorityBoost(
  stage: LiveStageAuthority,
  input: {
    isMediaInstantLive: boolean;
    fastSession: FastLiveSessionAuthority;
    fastSlotWindowOpen: boolean;
    churchSubscriptionActive: boolean | null;
    routePublisherEligible: boolean;
  }
): LiveStageAuthority {
  if (input.isMediaInstantLive || stage.canPublishLiveVideoNow) return stage;

  const subscriptionOk =
    input.churchSubscriptionActive !== false ||
    input.routePublisherEligible;

  if (!subscriptionOk || !input.fastSlotWindowOpen || !input.fastSession.trustedOwnsActiveSlot) {
    return stage;
  }

  return {
    ...stage,
    userOwnsCurrentActiveSlot: true,
    canPublishClaimedCameraNow: true,
    canPublishLiveVideoNow: true,
    canPublishClaimedMicNow:
      stage.canPublishClaimedMicNow ||
      input.fastSession.trustedIsActualChurchPastor ||
      input.fastSession.trustedIsMediaScheduleCreator ||
      stage.userHasClaimedScheduleSlot,
    pastorPermanentMicNow:
      stage.pastorPermanentMicNow || input.fastSession.trustedIsActualChurchPastor,
    mediaHostPermanentMicNow:
      stage.mediaHostPermanentMicNow ||
      input.fastSession.trustedIsMediaScheduleCreator,
  };
}

export function logLiveMediaAuthority(
  context: string,
  authority: LiveMediaAuthority,
  extra?: Record<string, unknown>
) {
  console.log("KRISTO_LIVE_AUTHORITY_SPLIT", {
    context,
    actualChurchPastorUserId: authority.actualChurchPastorUserId,
    scheduleCreatedByUserId: authority.scheduleCreatedByUserId,
    mediaHostIds: authority.mediaHostIds,
    isActualChurchPastor: authority.isActualChurchPastor,
    isMediaScheduleCreator: authority.isMediaScheduleCreator,
    isMediaHost: authority.isMediaHost,
    isMediaOwnerHost: authority.isMediaOwnerHost,
    ...extra,
  });

  if (authority.isActualChurchPastor) {
    console.log("KRISTO_ACTUAL_PASTOR_HOST", { context, ...extra });
  }
  if (authority.isMediaScheduleCreator) {
    console.log("KRISTO_MEDIA_SCHEDULE_CREATOR", { context, ...extra });
  }
  if (authority.isMediaHost) {
    console.log("KRISTO_MEDIA_HOST_AUTHORITY", { context, ...extra });
  }
}

export function extractLiveMediaAuthorityFromRecord(record: Record<string, any> | null | undefined) {
  const item = record || {};
  return {
    actualChurchPastorUserId: String(
      item.actualChurchPastorUserId || item.churchPastorUserId || ""
    ).trim(),
    scheduleCreatedByUserId: String(
      item.scheduleCreatedByUserId || item.createdByUserId || ""
    ).trim(),
    mediaHostIds: String(item.mediaHostIds || item.hostIds || "").trim(),
  };
}

export function buildLiveRoomAuthorityParams(record: Record<string, any> | null | undefined) {
  const fields = extractLiveMediaAuthorityFromRecord(record);
  return {
    actualChurchPastorUserId: fields.actualChurchPastorUserId,
    churchPastorUserId: fields.actualChurchPastorUserId,
    scheduleCreatedByUserId: fields.scheduleCreatedByUserId,
    mediaHostIds: fields.mediaHostIds,
    pastorUserId: fields.actualChurchPastorUserId,
  };
}

export function buildMediaScheduleAuthorityFields(options: {
  churchPastorUserId?: string;
  creatorUserId?: string;
  mediaHosts?: any[];
  sourceField?: string;
}) {
  const actualChurchPastorUserId = String(options.churchPastorUserId || "").trim();
  const scheduleCreatedByUserId = String(options.creatorUserId || "").trim();
  const mediaHostIds = (Array.isArray(options.mediaHosts) ? options.mediaHosts : [])
    .map((host: any) => String(host?.userId || host?.id || "").trim())
    .filter(Boolean)
    .join(",");

  return {
    actualChurchPastorUserId,
    churchPastorUserId: actualChurchPastorUserId,
    scheduleCreatedByUserId,
    mediaHostIds,
    mediaOwnerPastorUserId: actualChurchPastorUserId,
    pastorAuthoritySourceField: String(options.sourceField || ""),
  };
}

export type ScheduleSlotCameraWindow = {
  claimedByUserId?: string;
  startMs?: number;
  endMs?: number;
};

/** Camera requires slot ownership plus an open [startMs, endMs) window — not claim alone. */
export function isScheduleSlotCameraWindowOpen(
  slot: ScheduleSlotCameraWindow | null | undefined,
  currentUserId: string,
  nowMs: number
): boolean {
  const uid = String(currentUserId || "").trim();
  const owner = String(slot?.claimedByUserId || "").trim();
  if (!uid || !owner || owner !== uid) return false;

  const startMs = Number(slot?.startMs || 0);
  const endMs = Number(slot?.endMs || 0);
  if (!Number.isFinite(startMs) || !Number.isFinite(endMs) || startMs <= 0 || endMs <= startMs) {
    return false;
  }

  return nowMs >= startMs && nowMs < endMs;
}

export type LiveStageAuthorityInput = {
  isMediaInstantLive: boolean;
  currentUserId: string;
  currentSlotNumber: number;
  currentSlotOwnerId: string;
  currentSlotStartMs?: number;
  currentSlotEndMs?: number;
  nowMs?: number;
  authority: LiveMediaAuthority;
  isDeclaredMediaHostForThisLive: boolean;
  claimedMicSlotNumbers: number[];
  approvedViewerCanMic: boolean;
  approvedViewerIsCurrentCameraTurn: boolean;
  isPastorLiveOwner: boolean;
  roleLooksLikeHost: boolean;
  approvedViewerSeatType: string;
  /** When false, all publish/management media ops are blocked (view-only). */
  churchSubscriptionActive?: boolean | null;
};

export type LiveStageAuthority = {
  pastorPermanentMicNow: boolean;
  mediaHostPermanentMicNow: boolean;
  userOwnsCurrentActiveSlot: boolean;
  /** V1: user claimed one or more schedule slots (no per-user slot cap). */
  userHasClaimedScheduleSlot: boolean;
  /** @deprecated Use userHasClaimedScheduleSlot — kept for existing logs/callers. */
  userIsAmongFirstNineClaimedSlots: boolean;
  canPublishClaimedMicNow: boolean;
  canPublishClaimedCameraNow: boolean;
  canPublishLiveVideoNow: boolean;
};

/**
 * V1 Media Live (scheduled) authority:
 * - Mic: every claimed slot owner + pastor/trusted media host (even without a claim).
 * - Camera: current active slot owner only, and only while startMs <= now < endMs.
 * - Pastor/host without a claim: mic-only (never camera-by-role).
 * - Viewers without a claim: watch only.
 */
export function evaluateLiveStageAuthority(input: LiveStageAuthorityInput): LiveStageAuthority {
  const nowMs = Number(input.nowMs || Date.now());

  const userOwnsCurrentActiveSlot =
    !input.isMediaInstantLive &&
    !!input.currentSlotNumber &&
    !!input.currentSlotOwnerId &&
    !!input.currentUserId &&
    input.currentSlotOwnerId === input.currentUserId;

  const activeSlotCameraWindowOpen = isScheduleSlotCameraWindowOpen(
    {
      claimedByUserId: input.currentSlotOwnerId,
      startMs: input.currentSlotStartMs,
      endMs: input.currentSlotEndMs,
    },
    input.currentUserId,
    nowMs
  );

  const userHasClaimedScheduleSlot = input.claimedMicSlotNumbers.length > 0;

  const pastorPermanentMicNow =
    !input.isMediaInstantLive && input.authority.isActualChurchPastor;

  const mediaHostPermanentMicNow =
    !input.isMediaInstantLive &&
    (input.authority.isMediaHost ||
      input.authority.isMediaScheduleCreator ||
      input.isDeclaredMediaHostForThisLive);

  const canPublishClaimedMicNow = input.isMediaInstantLive
    ? input.isPastorLiveOwner || input.roleLooksLikeHost || input.approvedViewerCanMic
    : pastorPermanentMicNow ||
      mediaHostPermanentMicNow ||
      userHasClaimedScheduleSlot;

  const canPublishClaimedCameraNow = input.isMediaInstantLive
    ? input.isPastorLiveOwner ||
      input.roleLooksLikeHost ||
      input.approvedViewerSeatType === "big-screen" ||
      input.approvedViewerSeatType === "camera-mic"
    : userOwnsCurrentActiveSlot && activeSlotCameraWindowOpen;

  const canPublishLiveVideoNow = input.isMediaInstantLive
    ? canPublishClaimedCameraNow
    : canPublishClaimedCameraNow;

  const result: LiveStageAuthority = {
    pastorPermanentMicNow,
    mediaHostPermanentMicNow,
    userOwnsCurrentActiveSlot,
    userHasClaimedScheduleSlot,
    userIsAmongFirstNineClaimedSlots: userHasClaimedScheduleSlot,
    canPublishClaimedMicNow,
    canPublishClaimedCameraNow,
    canPublishLiveVideoNow,
  };

  // Church subscription gates Media Studio tools (pastor/host). Claimed schedule slot
  // speakers may publish their slot without target-church media-tool entitlement.
  if (input.churchSubscriptionActive === false) {
    const claimedSlotMic = userHasClaimedScheduleSlot;
    const claimedSlotCamera = userOwnsCurrentActiveSlot && activeSlotCameraWindowOpen;
    return {
      ...result,
      pastorPermanentMicNow: false,
      mediaHostPermanentMicNow: false,
      canPublishClaimedMicNow: claimedSlotMic,
      canPublishClaimedCameraNow: claimedSlotCamera,
      canPublishLiveVideoNow: input.isMediaInstantLive ? false : claimedSlotCamera,
    };
  }

  return result;
}

export function logMediaLiveV1StageAuthority(
  context: string,
  stage: LiveStageAuthority,
  extra?: Record<string, unknown>
) {
  console.log("KRISTO_MEDIA_LIVE_V1_AUTHORITY", {
    context,
    userOwnsCurrentActiveSlot: stage.userOwnsCurrentActiveSlot,
    userHasClaimedScheduleSlot: stage.userHasClaimedScheduleSlot,
    pastorPermanentMicNow: stage.pastorPermanentMicNow,
    mediaHostPermanentMicNow: stage.mediaHostPermanentMicNow,
    canPublishClaimedMicNow: stage.canPublishClaimedMicNow,
    canPublishClaimedCameraNow: stage.canPublishClaimedCameraNow,
    canPublishLiveVideoNow: stage.canPublishLiveVideoNow,
    rules: "mic=claimed+pastor/host; camera=active-slot-owner+time-window",
    ...extra,
  });
}
