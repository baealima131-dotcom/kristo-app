/**
 * Client driver for server-authoritative slot transitions.
 * Shows the shared "Preparing your live room…" UI for EVERY participant,
 * then runs performAutomaticSlotSoftReentry.
 */
import {
  clearSoftReentryCompletion,
  performAutomaticSlotSoftReentry,
  wasSoftReentryCompleted,
} from "@/src/lib/liveSlotSoftReentry";

export { performAutomaticSlotSoftReentry } from "@/src/lib/liveSlotSoftReentry";
import {
  type SlotTransitionPhase,
  type SlotTransitionRecord,
  isSlotTransitionActive,
  readSlotTransition,
  resolveActiveScheduleSlot,
  resolveIncomingSlotAfter,
  normalizeSlotScheduleEntries,
  slotTransitionPhaseRank,
} from "@/src/lib/liveSlotTransitionCore";
import type { ClaimedSlotLike } from "@/src/lib/liveSlotPreflightCore";

// Re-export helpers used by live-room (avoid importing core types twice).
export type { SlotTransitionPhase, SlotTransitionRecord };
export {
  isSlotTransitionActive,
  readSlotTransition,
  normalizeSlotScheduleEntries,
  resolveActiveScheduleSlot,
};

export type SlotTransitionUiStep = {
  id: "schedule" | "token" | "connect" | "mic" | "camera" | "video" | "enter";
  label: string;
  status: "pending" | "active" | "done" | "skipped";
};

export type SlotTransitionClientAdapters = {
  liveBridgeId: string;
  /** Immutable session pin — soft re-entry must never change or fall back from this. */
  canonicalLiveSessionId: string;
  currentUserId: string;
  headers: Record<string, string>;
  /** Shared in-flight guard across transition + Retry. */
  reentryInFlightRef: { current: string };
  pushLiveAction: (action: string, body?: Record<string, any>) => Promise<any>;
  suppressLocalCamera: (room: any, reason: string) => Promise<boolean>;
  suppressLocalMic: (room: any, reason: string) => Promise<boolean>;
  publishLocalCamera: (room: any) => Promise<boolean>;
  publishLocalMic?: (room: any) => Promise<boolean>;
  resetLocalVideoReady: () => void;
  bumpLiveNowMs: (at: number) => void;
  clearStaleLiveSessionState: (input: {
    transitionId: string;
    canonicalLiveSessionId: string;
    incomingSlotId: string;
    incomingOwnerUserId: string;
  }) => Promise<void>;
  refetchExactLiveSession: (input: {
    transitionId: string;
    canonicalLiveSessionId: string;
    incomingSlotId: string;
    incomingOwnerUserId: string;
  }) => Promise<{
    ok: boolean;
    live?: any;
    activeSlotId?: string;
    activeOwnerUserId?: string;
    abortReason?: string;
  }>;
  applyRoleStateFromLive: (input: {
    transitionId: string;
    canonicalLiveSessionId: string;
    incomingSlotId: string;
    incomingOwnerUserId: string;
    live?: any;
  }) => void;
  remountAndReconnectLiveKit: (input: {
    transitionId: string;
    canonicalLiveSessionId: string;
    isIncoming: boolean;
  }) => void;
  waitForRoomConnected: (canonicalLiveSessionId: string, timeoutMs: number) => Promise<boolean>;
  onShowPreparation: (input: {
    transition: SlotTransitionRecord;
    steps: SlotTransitionUiStep[];
    mode: "video-publisher" | "audio-publisher" | "viewer";
  }) => void;
  onUpdatePreparationSteps: (steps: SlotTransitionUiStep[]) => void;
  onHidePreparation: (transition: SlotTransitionRecord) => void;
  onSoftReentryFailed: (input: {
    transition: SlotTransitionRecord;
    reason: string;
  }) => void;
  onBigScreenAssigned: (input: {
    transition: SlotTransitionRecord;
    ownerUserId: string;
    slotId: string;
  }) => void;
  canControlMicForOutgoing: boolean;
  canPublishMicForIncoming: boolean;
};

type LocalRunState = {
  transitionId: string;
  running: boolean;
  screenShown: boolean;
  lastPhaseLogged: string;
  completedLocal: boolean;
};

function runStore(): { byBridge: Record<string, LocalRunState>; lastObservedId: string } {
  const g = globalThis as any;
  if (!g.__KRISTO_SLOT_TRANSITION_CLIENT__) {
    g.__KRISTO_SLOT_TRANSITION_CLIENT__ = { byBridge: {}, lastObservedId: "" };
  }
  return g.__KRISTO_SLOT_TRANSITION_CLIENT__;
}

function norm(v: unknown) {
  return String(v || "").trim();
}

function pinnedCanonicalId(adapters: SlotTransitionClientAdapters): string {
  return norm(adapters.canonicalLiveSessionId || adapters.liveBridgeId);
}

function assertPinnedCanonical(
  adapters: SlotTransitionClientAdapters,
  transitionId: string
): string {
  const pinned = pinnedCanonicalId(adapters);
  const bridge = norm(adapters.liveBridgeId);
  if (!pinned) {
    throw new Error("missing_canonical_live_session_id");
  }
  if (bridge && bridge !== pinned) {
    console.log("KRISTO_LIVE_SESSION_ID_MISMATCH_BLOCKED", {
      requestedLiveId: pinned,
      canonicalLiveSessionId: pinned,
      responseLiveId: bridge,
      source: "slot-soft-reentry",
      transitionId,
      reason: "adapter_liveBridgeId_diverged_from_canonical",
    });
    throw new Error("canonical_live_id_mismatch");
  }
  return pinned;
}

const VIDEO_PUBLISHER_DEFS = [
  { id: "schedule" as const, label: "Loading schedule" },
  { id: "token" as const, label: "Getting token" },
  { id: "connect" as const, label: "Connecting room" },
  { id: "mic" as const, label: "Preparing mic" },
  { id: "camera" as const, label: "Preparing camera" },
  { id: "video" as const, label: "Publishing video" },
  { id: "enter" as const, label: "Entering live" },
];

const VIEWER_DEFS = [
  { id: "schedule" as const, label: "Loading schedule" },
  { id: "token" as const, label: "Getting token" },
  { id: "connect" as const, label: "Connecting room" },
  { id: "mic" as const, label: "Preparing mic" },
  { id: "camera" as const, label: "Preparing camera" },
  { id: "video" as const, label: "Publishing video" },
  { id: "enter" as const, label: "Entering live" },
];

/** Minimal sequential builder (mirrors live-room preflight step UX). */
export function buildSequentialPreflightStepsFromDefs(
  stepDefs: Array<{ id: SlotTransitionUiStep["id"]; label: string }>,
  stepReady: Partial<Record<SlotTransitionUiStep["id"], boolean>>,
  stepSkipped: Partial<Record<SlotTransitionUiStep["id"], boolean>> = {}
): SlotTransitionUiStep[] {
  let pastActive = false;
  return stepDefs.map((def) => {
    if (stepSkipped[def.id]) {
      return { ...def, status: "skipped" as const };
    }
    if (pastActive) {
      return { ...def, status: "pending" as const };
    }
    if (stepReady[def.id]) {
      return { ...def, status: "done" as const };
    }
    pastActive = true;
    return { ...def, status: "active" as const };
  });
}

function phaseToStepReady(phase: SlotTransitionPhase): Partial<Record<SlotTransitionUiStep["id"], boolean>> {
  const rank = slotTransitionPhaseRank(phase);
  return {
    schedule: rank > slotTransitionPhaseRank("loading_schedule"),
    token: rank > slotTransitionPhaseRank("getting_token"),
    connect: rank > slotTransitionPhaseRank("confirming_room"),
    mic: rank > slotTransitionPhaseRank("preparing_mic"),
    camera: rank > slotTransitionPhaseRank("preparing_camera"),
    video: rank > slotTransitionPhaseRank("publishing_video"),
    enter: rank >= slotTransitionPhaseRank("entering_live"),
  };
}

function localRole(
  transition: SlotTransitionRecord,
  currentUserId: string
): "incoming" | "outgoing" | "remote" {
  const uid = norm(currentUserId);
  if (uid && uid === norm(transition.incomingUserId)) return "incoming";
  if (uid && uid === norm(transition.outgoingUserId)) return "outgoing";
  return "remote";
}

async function reportProgress(
  adapters: SlotTransitionClientAdapters,
  transitionId: string,
  phase: SlotTransitionPhase,
  extra?: { videoReady?: boolean; avatarFallback?: boolean; role?: string }
) {
  try {
    await adapters.pushLiveAction("slot-transition-progress", {
      transitionId,
      phase,
      videoReady: extra?.videoReady === true,
      avatarFallback: extra?.avatarFallback === true,
      role: extra?.role,
    });
  } catch {}
}

function logStep(event: string, payload: Record<string, unknown>) {
  console.log(event, payload);
}

function phaseReadyFromOrchestrator(
  phase: SlotTransitionPhase
): Partial<Record<SlotTransitionUiStep["id"], boolean>> {
  return phaseToStepReady(phase);
}

async function runLocalTransitionSteps(
  transition: SlotTransitionRecord,
  adapters: SlotTransitionClientAdapters
) {
  const store = runStore();
  const bridge = pinnedCanonicalId(adapters);
  const local = store.byBridge[bridge] || store.byBridge[norm(adapters.liveBridgeId)];
  if (!local || local.transitionId !== transition.transitionId) return;
  if (local.running || local.completedLocal) {
    logStep("KRISTO_SLOT_SOFT_REENTRY_DEDUPED", {
      liveBridgeId: bridge,
      canonicalLiveSessionId: bridge,
      transitionId: transition.transitionId,
      running: local.running,
      completedLocal: local.completedLocal,
    });
    return;
  }
  if (wasSoftReentryCompleted(bridge, transition.transitionId)) {
    local.completedLocal = true;
    return;
  }

  local.running = true;
  const role = localRole(transition, adapters.currentUserId);
  const isIncoming = role === "incoming";
  const defs = isIncoming ? VIDEO_PUBLISHER_DEFS : VIEWER_DEFS;

  const publishStepsForPhase = (phase: SlotTransitionPhase) => {
    adapters.onUpdatePreparationSteps(
      buildSequentialPreflightStepsFromDefs(defs, phaseReadyFromOrchestrator(phase))
    );
  };

  try {
    assertPinnedCanonical(adapters, transition.transitionId);
    logStep("INCOMING_OWNER", {
      transitionId: transition.transitionId,
      canonicalLiveSessionId: bridge,
      newSlotId: transition.incomingSlotId,
      newOwnerId: transition.incomingUserId,
      role,
    });

    const result = await performAutomaticSlotSoftReentry(
      {
        transitionId: transition.transitionId,
        canonicalLiveSessionId: bridge,
        incomingSlotId: transition.incomingSlotId,
        incomingOwnerUserId: transition.incomingUserId,
        outgoingSlotId: transition.outgoingSlotId,
        outgoingOwnerUserId: transition.outgoingUserId,
        scheduleVersion: transition.scheduleVersion,
        currentUserId: adapters.currentUserId,
      },
      {
        canonicalLiveSessionId: bridge,
        currentUserId: adapters.currentUserId,
        headers: adapters.headers,
        reentryInFlightRef: adapters.reentryInFlightRef,
        pushLiveAction: adapters.pushLiveAction,
        suppressLocalCamera: adapters.suppressLocalCamera,
        suppressLocalMic: adapters.suppressLocalMic,
        publishLocalCamera: adapters.publishLocalCamera,
        publishLocalMic: adapters.publishLocalMic,
        resetLocalVideoReady: adapters.resetLocalVideoReady,
        bumpLiveNowMs: adapters.bumpLiveNowMs,
        clearStaleLiveSessionState: adapters.clearStaleLiveSessionState,
        refetchExactLiveSession: adapters.refetchExactLiveSession,
        applyRoleStateFromLive: adapters.applyRoleStateFromLive,
        remountAndReconnectLiveKit: adapters.remountAndReconnectLiveKit,
        waitForRoomConnected: adapters.waitForRoomConnected,
        canPublishMicForIncoming: adapters.canPublishMicForIncoming,
        onProgress: (phase) => {
          void reportProgress(adapters, transition.transitionId, phase, { role });
          publishStepsForPhase(phase);
        },
        onCompleted: (completed) => {
          local.completedLocal = true;
          adapters.onBigScreenAssigned({
            transition,
            ownerUserId: completed.incomingOwnerUserId,
            slotId: completed.incomingSlotId,
          });
          adapters.onHidePreparation(transition);
        },
        onFailed: (failed) => {
          adapters.onSoftReentryFailed({
            transition,
            reason: failed.reason,
          });
        },
      }
    );

    if (result.ok) {
      local.completedLocal = true;
    } else if (!result.deduped) {
      logStep("KRISTO_SLOT_TRANSITION_FAILED", {
        transitionId: transition.transitionId,
        canonicalLiveSessionId: bridge,
        reason: result.reason || "soft_reentry_failed",
      });
    }
  } catch (error) {
    logStep("KRISTO_SLOT_SOFT_REENTRY_FAILED", {
      transitionId: transition.transitionId,
      canonicalLiveSessionId: bridge,
      reason: String((error as any)?.message || error),
    });
    adapters.onSoftReentryFailed({
      transition,
      reason: String((error as any)?.message || error),
    });
  } finally {
    local.running = false;
  }
}

/** Retry soft re-entry for the active transition (after timeout). */
export function retryAutomaticSlotSoftReentry(
  transition: SlotTransitionRecord,
  adapters: SlotTransitionClientAdapters
) {
  const bridge = pinnedCanonicalId(adapters);
  if (!bridge || !transition.transitionId) return;
  clearSoftReentryCompletion(bridge, transition.transitionId);
  const store = runStore();
  const local = store.byBridge[bridge];
  if (local && local.transitionId === transition.transitionId) {
    local.running = false;
    local.completedLocal = false;
    local.screenShown = true;
  }
  adapters.reentryInFlightRef.current = "";
  void runLocalTransitionSteps(transition, adapters);
}

/** Apply server slotClock to non-React globals — clients must render this authority. */
export function applyServerSlotClock(live: any): {
  activeSlotId: string;
  activeOwnerUserId: string;
} {
  const clock = live?.slotClock || null;
  const activeSlotId = norm(clock?.activeSlotId);
  const activeOwnerUserId = norm(
    clock?.activeOwnerUserId || live?.bigScreenOwnerUserId
  );
  if (!activeSlotId && !activeOwnerUserId) {
    return { activeSlotId: "", activeOwnerUserId: "" };
  }
  try {
    const g = globalThis as any;
    const prevSlotId = norm(g.__KRISTO_SERVER_ACTIVE_SLOT_ID__);
    const prevOwnerId = norm(g.__KRISTO_SERVER_ACTIVE_OWNER_ID__);
    if (activeSlotId) g.__KRISTO_SERVER_ACTIVE_SLOT_ID__ = activeSlotId;
    if (activeOwnerUserId) {
      g.__KRISTO_SERVER_ACTIVE_OWNER_ID__ = activeOwnerUserId;
      g.__KRISTO_SLOT_HANDOFF_BIG_SCREEN_OWNER__ = activeOwnerUserId;
    }
    if (activeSlotId) g.__KRISTO_SLOT_HANDOFF_BIG_SCREEN_SLOT_ID__ = activeSlotId;
    if (prevSlotId !== activeSlotId || prevOwnerId !== activeOwnerUserId) {
      console.log("ACTIVE_SLOT_UPDATED", {
        source: "client_apply_server_slot_clock",
        oldSlotId: prevSlotId,
        newSlotId: activeSlotId,
        oldOwnerId: prevOwnerId,
        newOwnerId: activeOwnerUserId,
        scheduleVersion: norm(clock?.scheduleVersion),
        serverNow: Number(clock?.serverNow || Date.now()),
        slotStart: Number(clock?.activeSlotStartMs || 0) || undefined,
        slotEnd: Number(clock?.activeSlotEndMs || 0) || undefined,
        remainingMs:
          Number(clock?.activeSlotEndMs || 0) > 0
            ? Math.max(0, Number(clock.activeSlotEndMs) - Date.now())
            : undefined,
      });
    }
  } catch {}
  return { activeSlotId, activeOwnerUserId };
}

/**
 * Apply authoritative transition from backend live payload.
 * Idempotent per transitionId.
 */
export function applyServerSlotTransition(
  liveOrTransition: any,
  adapters: SlotTransitionClientAdapters
): void {
  // Always honor server activeSlotId first — independent of transition UI.
  if (liveOrTransition && !liveOrTransition.transitionId) {
    applyServerSlotClock(liveOrTransition);
  }

  const transition =
    liveOrTransition?.transitionId
      ? (liveOrTransition as SlotTransitionRecord)
      : readSlotTransition(liveOrTransition);
  const bridge = pinnedCanonicalId(adapters);
  if (!bridge) return;

  // Even without an active transition record, server clock may have advanced.
  if (!transition.transitionId) return;

  const store = runStore();
  const active = isSlotTransitionActive(transition);
  const terminalReady =
    transition.phase === "ready" ||
    (transition.event === "SLOT_TRANSITION_READY" && Boolean(transition.readyAt));

  let local = store.byBridge[bridge];
  if (!local || local.transitionId !== transition.transitionId) {
    local = {
      transitionId: transition.transitionId,
      running: false,
      screenShown: false,
      lastPhaseLogged: "",
      completedLocal: false,
    };
    store.byBridge[bridge] = local;
  } else if (
    local.transitionId === transition.transitionId &&
    (local.running || local.completedLocal) &&
    active
  ) {
    // transitionId dedupe — do not restart soft re-entry for the same START.
    if (local.lastPhaseLogged !== transition.phase) {
      local.lastPhaseLogged = transition.phase;
      console.log("KRISTO_SLOT_SOFT_REENTRY_DEDUPED", {
        liveBridgeId: bridge,
        canonicalLiveSessionId: bridge,
        transitionId: transition.transitionId,
        phase: transition.phase,
        running: local.running,
        completedLocal: local.completedLocal,
      });
    }
  }

  if (active && !local.screenShown && !local.completedLocal) {
    local.screenShown = true;
    const role = localRole(transition, adapters.currentUserId);
    const mode = role === "incoming" ? "video-publisher" : "viewer";
    const defs = role === "incoming" ? VIDEO_PUBLISHER_DEFS : VIEWER_DEFS;
    const steps = buildSequentialPreflightStepsFromDefs(
      defs,
      phaseToStepReady(transition.phase)
    );
    adapters.onShowPreparation({ transition, steps, mode });
    console.log("KRISTO_SLOT_TRANSITION_SCREEN_SHOWN", {
      liveBridgeId: bridge,
      canonicalLiveSessionId: bridge,
      transitionId: transition.transitionId,
      role,
      phase: transition.phase,
      scheduleVersion: transition.scheduleVersion,
      softReentry: true,
    });
    void runLocalTransitionSteps(transition, adapters);
  } else if (active && local.screenShown && !local.completedLocal) {
    // Keep UI in sync with server phase for late joiners / catch-up.
    const role = localRole(transition, adapters.currentUserId);
    const defs = role === "incoming" ? VIDEO_PUBLISHER_DEFS : VIEWER_DEFS;
    if (!local.running) {
      adapters.onUpdatePreparationSteps(
        buildSequentialPreflightStepsFromDefs(defs, phaseToStepReady(transition.phase))
      );
    }
  }

  if (terminalReady) {
    const ownerUserId = norm(transition.bigScreenOwnerUserId || transition.incomingUserId);
    try {
      const g = globalThis as any;
      g.__KRISTO_SLOT_HANDOFF_BIG_SCREEN_OWNER__ = ownerUserId;
      g.__KRISTO_SLOT_HANDOFF_BIG_SCREEN_SLOT_ID__ = transition.incomingSlotId;
      g.__KRISTO_SERVER_ACTIVE_SLOT_ID__ = transition.incomingSlotId;
      g.__KRISTO_SERVER_ACTIVE_OWNER_ID__ = ownerUserId;
    } catch {}
    adapters.bumpLiveNowMs(Date.now());
    adapters.onBigScreenAssigned({
      transition,
      ownerUserId,
      slotId: transition.incomingSlotId,
    });
    console.log("BIG_SCREEN_UPDATED", {
      liveBridgeId: bridge,
      transitionId: transition.transitionId,
      scheduleVersion: transition.scheduleVersion,
      oldSlotId: transition.outgoingSlotId,
      newSlotId: transition.incomingSlotId,
      oldOwnerId: transition.outgoingUserId,
      newOwnerId: ownerUserId,
      serverNow: Date.now(),
    });
    console.log("KRISTO_SLOT_TRANSITION_BIG_SCREEN_ASSIGNED", {
      liveBridgeId: bridge,
      transitionId: transition.transitionId,
      ownerUserId,
      slotId: transition.incomingSlotId,
    });

    // Late joiners who arrive after READY: apply new authority directly (no soft exit).
    // Participants still in soft re-entry keep prep until orchestrator COMPLETED.
    const softReentryStillRunning =
      local.running ||
      adapters.reentryInFlightRef.current === transition.transitionId;
    if (!softReentryStillRunning) {
      adapters.onHidePreparation(transition);
      local.screenShown = false;
      local.completedLocal = true;
      console.log("TRANSITION_FINISHED", {
        liveBridgeId: bridge,
        transitionId: transition.transitionId,
        scheduleVersion: transition.scheduleVersion,
        oldSlotId: transition.outgoingSlotId,
        newSlotId: transition.incomingSlotId,
        oldOwnerId: transition.outgoingUserId,
        newOwnerId: ownerUserId,
        serverNow: Date.now(),
        lateJoinerDirect: !local.screenShown,
      });
      console.log("KRISTO_SLOT_TRANSITION_COMPLETED", {
        liveBridgeId: bridge,
        transitionId: transition.transitionId,
        incomingSlotId: transition.incomingSlotId,
        incomingUserId: transition.incomingUserId,
      });
    }
  }

  if (transition.phase === "failed" && transition.event === "SLOT_TRANSITION_CANCELLED") {
    adapters.onHidePreparation(transition);
    console.log("KRISTO_SLOT_TRANSITION_CANCELLED", {
      liveBridgeId: bridge,
      transitionId: transition.transitionId,
      reason: transition.failedReason,
    });
    local.screenShown = false;
  }
}

export function buildScheduleSyncPayload(slots: ClaimedSlotLike[] | null | undefined, scheduleVersion: string) {
  const normalized = normalizeSlotScheduleEntries(
    (Array.isArray(slots) ? slots : []).map((slot: any, index: number) => ({
      slotId: slot?.id || slot?.slotId,
      id: slot?.id || slot?.slotId,
      slot: slot?.slot ?? slot?.slotNumber ?? index + 1,
      slotNumber: slot?.slotNumber ?? slot?.slot ?? index + 1,
      ownerUserId: slot?.claimedByUserId || slot?.claimedBy?.userId,
      claimedByUserId: slot?.claimedByUserId || slot?.claimedBy?.userId,
      ownerName: slot?.claimedByName || slot?.claimedBy?.name,
      startMs: slot?.startMs,
      endMs: slot?.endMs,
    }))
  );
  return {
    scheduleVersion: String(scheduleVersion || "").trim(),
    slots: normalized,
  };
}

/**
 * Local boundary detector that asks the server to begin a transition.
 * Does NOT perform hidden media handoff — server broadcasts START to everyone.
 */
export function noteSlotTransitionClock(
  lastActiveSlotIdRef: { current: string },
  lastActiveOwnerRef: { current: string },
  slotId: string,
  ownerUserId: string
) {
  if (slotId) {
    lastActiveSlotIdRef.current = slotId;
    lastActiveOwnerRef.current = ownerUserId;
  }
}

export function tickSlotTransitionWatcher(args: {
  slots: ClaimedSlotLike[] | null | undefined;
  scheduleVersion: string;
  adapters: SlotTransitionClientAdapters;
  lastActiveSlotIdRef: { current: string };
  lastActiveOwnerRef: { current: string };
  /** When true, force begin even if we only have an expired previous + resolved next. */
  forceBoundary?: boolean;
}): void {
  const now = Date.now();
  const normalized = normalizeSlotScheduleEntries(
    (Array.isArray(args.slots) ? args.slots : []).map((slot: any, index: number) => ({
      slotId: slot?.id || slot?.slotId,
      id: slot?.id || slot?.slotId,
      slot: slot?.slot ?? slot?.slotNumber ?? index + 1,
      ownerUserId: slot?.claimedByUserId || slot?.claimedBy?.userId,
      claimedByUserId: slot?.claimedByUserId,
      startMs: slot?.startMs,
      endMs: slot?.endMs,
    }))
  );
  if (!normalized.length) {
    if (args.forceBoundary) {
      console.log("KRISTO_SLOT_TRANSITION_WATCHER_SKIP", {
        reason: "empty_normalized_schedule",
        rawSlotCount: Array.isArray(args.slots) ? args.slots.length : 0,
        forceBoundary: true,
      });
    }
    return;
  }

  const active = resolveActiveScheduleSlot(normalized, now);
  const previousId = String(args.lastActiveSlotIdRef.current || "").trim();
  const previous =
    (previousId && normalized.find((s) => s.slotId === previousId)) || null;

  if (!previousId) {
    const seed = active || normalized[0];
    if (!seed?.slotId) return;
    args.lastActiveSlotIdRef.current = seed.slotId;
    args.lastActiveOwnerRef.current = seed.ownerUserId;
    void args.adapters.pushLiveAction("sync-slot-schedule", {
      ...buildScheduleSyncPayload(args.slots, args.scheduleVersion),
    });
    return;
  }

  if (active?.slotId && active.slotId === previousId && !args.forceBoundary) {
    return;
  }

  const previousEnded = previous ? now >= previous.endMs : true;
  if (!previousEnded && active?.slotId === previousId) {
    return;
  }

  // At slot A expiry (or when slot B is already active), resolve the incoming owner.
  // Do not require an active window mid-gap — soft re-entry starts at the boundary.
  const incoming =
    (active && active.slotId !== previousId ? active : null) ||
    resolveIncomingSlotAfter(normalized, previous, now);

  if (!incoming?.slotId || incoming.slotId === previousId) {
    if (args.forceBoundary) {
      console.log("KRISTO_SLOT_TRANSITION_WATCHER_SKIP", {
        reason: "no_incoming_after_boundary",
        previousId,
        previousEnded,
        activeSlotId: active?.slotId || "",
        forceBoundary: true,
      });
    }
    return;
  }

  if (!previousEnded && !args.forceBoundary && active?.slotId !== incoming.slotId) {
    return;
  }

  const outgoingSlotId = previousId;
  const outgoingUserId = args.lastActiveOwnerRef.current || previous?.ownerUserId || "";

  console.log("KRISTO_SLOT_TRANSITION_START", {
    liveBridgeId: args.adapters.liveBridgeId,
    source: args.forceBoundary ? "client_boundary_timer" : "client_boundary_detect",
    outgoingSlotId,
    outgoingUserId,
    incomingSlotId: incoming.slotId,
    incomingUserId: incoming.ownerUserId,
    scheduleVersion: args.scheduleVersion,
    boundaryTimestamp: now,
    previousEnded,
    forceBoundary: !!args.forceBoundary,
  });

  void args.adapters
    .pushLiveAction("slot-transition-begin", {
      ...buildScheduleSyncPayload(args.slots, args.scheduleVersion),
      outgoingSlotId,
      outgoingUserId,
      incomingSlotId: incoming.slotId,
      incomingUserId: incoming.ownerUserId,
      boundaryTimestamp: now,
    })
    .then((res) => {
      const live = res?.live;
      if (!live) {
        console.log("KRISTO_SLOT_TRANSITION_BEGIN_NO_LIVE", {
          liveBridgeId: args.adapters.liveBridgeId,
          incomingSlotId: incoming.slotId,
        });
        return;
      }
      const transition = readSlotTransition(live);
      if (isSlotTransitionActive(transition) || transition.phase === "ready") {
        args.lastActiveSlotIdRef.current = incoming.slotId;
        args.lastActiveOwnerRef.current = incoming.ownerUserId;
      }
      applyServerSlotTransition(live, args.adapters);
    });
}
