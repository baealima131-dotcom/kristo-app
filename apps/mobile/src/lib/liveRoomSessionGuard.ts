import { endLiveBridgeForStaleScheduleFeedId } from "@/src/lib/staleBackendZeroSlotGuard";

export type LiveRoomSessionPin = {
  liveBridgeId: string;
  userId: string;
  routeSlotCount: number;
  pinnedAt: number;
  liveKitConnected?: boolean;
  liveKitConnecting?: boolean;
  source?: string;
};

function pinStore() {
  return globalThis as any;
}

export function pinLiveRoomSession(input: {
  liveBridgeId: string;
  userId?: string;
  routeSlotCount?: number;
  source?: string;
  liveKitConnected?: boolean;
  liveKitConnecting?: boolean;
}) {
  const liveBridgeId = String(input.liveBridgeId || "").trim();
  if (!liveBridgeId) return;

  const prev = readLiveRoomSessionPin();
  pinStore().__KRISTO_LIVE_ROOM_SESSION_PIN__ = {
    liveBridgeId,
    userId: String(input.userId || prev?.userId || "").trim(),
    routeSlotCount: Math.max(
      Number(input.routeSlotCount ?? prev?.routeSlotCount ?? 0),
      0
    ),
    pinnedAt: prev?.pinnedAt || Date.now(),
    liveKitConnected: input.liveKitConnected === true || prev?.liveKitConnected === true,
    liveKitConnecting: input.liveKitConnecting === true || prev?.liveKitConnecting === true,
    source: input.source || prev?.source || "unknown",
  } satisfies LiveRoomSessionPin;

  console.log("KRISTO_LIVE_ROOM_SESSION_PINNED", {
    liveBridgeId,
    routeSlotCount: pinStore().__KRISTO_LIVE_ROOM_SESSION_PIN__.routeSlotCount,
    liveKitConnected: pinStore().__KRISTO_LIVE_ROOM_SESSION_PIN__.liveKitConnected,
    source: input.source || "unknown",
  });
}

export function markLiveRoomLiveKitConnecting(liveBridgeId: string) {
  const id = String(liveBridgeId || "").trim();
  if (!id) return;
  const pin = readLiveRoomSessionPin();
  pinLiveRoomSession({
    liveBridgeId: id,
    userId: pin?.liveBridgeId === id ? pin.userId : undefined,
    routeSlotCount: pin?.liveBridgeId === id ? pin.routeSlotCount : undefined,
    liveKitConnecting: true,
    source: "livekit-connecting",
  });
}

export function markLiveRoomLiveKitConnected(liveBridgeId: string) {
  const id = String(liveBridgeId || "").trim();
  if (!id) return;
  const pin = readLiveRoomSessionPin();
  pinLiveRoomSession({
    liveBridgeId: id,
    userId: pin?.liveBridgeId === id ? pin.userId : undefined,
    routeSlotCount: pin?.liveBridgeId === id ? pin.routeSlotCount : undefined,
    liveKitConnected: true,
    liveKitConnecting: true,
    source: "livekit-connected",
  });
}

export function readLiveRoomSessionPin(): LiveRoomSessionPin | null {
  const pin = pinStore().__KRISTO_LIVE_ROOM_SESSION_PIN__;
  if (!pin || typeof pin !== "object") return null;
  return pin as LiveRoomSessionPin;
}

export function clearLiveRoomSessionPin(reason?: string) {
  if (pinStore().__KRISTO_LIVE_ROOM_SESSION_PIN__) {
    console.log("KRISTO_LIVE_ROOM_SESSION_UNPINNED", {
      reason: reason || "unknown",
      liveBridgeId: pinStore().__KRISTO_LIVE_ROOM_SESSION_PIN__?.liveBridgeId || "",
    });
  }
  delete pinStore().__KRISTO_LIVE_ROOM_SESSION_PIN__;
}

export function clearStaleLiveEndedFlag(liveBridgeId: string, reason?: string) {
  const id = String(liveBridgeId || "").trim();
  if (!id) return false;
  try {
    const bridge = (globalThis as any).__kristoLiveJoinBridge;
    if (bridge?.endedByLiveId?.[id]) {
      delete bridge.endedByLiveId[id];
      console.log("KRISTO_LIVE_ROOM_ENDED_FLAG_CLEARED", {
        liveBridgeId: id,
        reason: reason || "session-pin",
      });
      return true;
    }
  } catch {}
  return false;
}

const MANUAL_NAV_REASONS = new Set([
  "leave-live-room",
  "user-back",
  "user-close",
  "end-live-now",
  "account-switch",
  "account-logout",
]);

export function shouldBlockLiveRoomAutoNavigation(input: {
  reason: string;
  liveBridgeId?: string;
  backendScheduleExplicitlyEnded?: boolean;
  explicitScheduleDeleted?: boolean;
}) {
  const reason = String(input.reason || "").trim();
  if (MANUAL_NAV_REASONS.has(reason)) return false;

  const pin = readLiveRoomSessionPin();
  if (!pin) return false;

  const liveBridgeId = String(input.liveBridgeId || pin.liveBridgeId || "").trim();
  if (liveBridgeId && pin.liveBridgeId !== liveBridgeId) return false;

  if (input.explicitScheduleDeleted === true || input.backendScheduleExplicitlyEnded === true) {
    return false;
  }

  return (
    pin.routeSlotCount > 0 ||
    pin.liveKitConnected === true ||
    pin.liveKitConnecting === true
  );
}

export function tryEndLiveBridgeForSchedule(feedId: string, reason: string): boolean {
  const id = String(feedId || "").trim();
  if (!id) return false;

  if (
    shouldBlockLiveRoomAutoNavigation({
      reason: `end-bridge:${reason}`,
      liveBridgeId: id,
    })
  ) {
    logLiveRoomGuardRedirect({
      blocked: true,
      reason: `end-bridge:${reason}`,
      liveBridgeId: id,
    });
    logLiveRoomShowEndedOverlay({
      feedId: id,
      preservedRoute: true,
      source: reason,
    });
    return false;
  }

  endLiveBridgeForStaleScheduleFeedId(id);
  return true;
}

export type LiveKitPublisherStagePin = {
  liveBridgeId: string;
  pinnedAt: number;
  source?: string;
};

export function pinLiveKitPublisherStage(liveBridgeId: string, source?: string) {
  const id = String(liveBridgeId || "").trim();
  if (!id) return;
  pinStore().__KRISTO_LIVEKIT_PUBLISHER_STAGE_PIN__ = {
    liveBridgeId: id,
    pinnedAt: Date.now(),
    source: source || "unknown",
  } satisfies LiveKitPublisherStagePin;
  console.log("KRISTO_LIVEKIT_PUBLISHER_STAGE_PINNED", {
    liveBridgeId: id,
    source: source || "unknown",
  });
}

export function readLiveKitPublisherStagePin(): LiveKitPublisherStagePin | null {
  const pin = pinStore().__KRISTO_LIVEKIT_PUBLISHER_STAGE_PIN__;
  if (!pin || typeof pin !== "object") return null;
  return pin as LiveKitPublisherStagePin;
}

export function isLiveKitPublisherStagePinned(liveBridgeId: string): boolean {
  const pin = readLiveKitPublisherStagePin();
  const id = String(liveBridgeId || "").trim();
  return !!id && pin?.liveBridgeId === id;
}

export function clearLiveKitPublisherStagePin(reason?: string) {
  const pin = readLiveKitPublisherStagePin();
  if (pin) {
    console.log("KRISTO_LIVEKIT_PUBLISHER_STAGE_UNPINNED", {
      reason: reason || "unknown",
      liveBridgeId: pin.liveBridgeId,
    });
  }
  delete pinStore().__KRISTO_LIVEKIT_PUBLISHER_STAGE_PIN__;
}

export function logLiveRoomGuardRedirect(input: {
  blocked: boolean;
  reason: string;
  guardName?: string;
  target?: string;
  liveBridgeId?: string;
  detail?: Record<string, unknown>;
}) {
  console.log("KRISTO_LIVE_ROOM_GUARD_REDIRECT", {
    blocked: input.blocked,
    guardName: input.guardName || input.reason,
    reason: input.reason,
    blockedReason: input.blocked ? input.reason : "",
    target: input.target || "",
    liveBridgeId: input.liveBridgeId || "",
    pin: readLiveRoomSessionPin(),
    publisherStagePin: readLiveKitPublisherStagePin(),
    ...(input.detail || {}),
  });
}

export function logLiveRoomNavAway(input: {
  reason: string;
  caller?: string;
  target: string;
  liveBridgeId?: string;
  detail?: Record<string, unknown>;
}) {
  console.log("KRISTO_LIVE_ROOM_NAV_AWAY", {
    reason: input.reason,
    caller: input.caller || input.reason,
    effectName: input.caller || input.reason,
    target: input.target,
    liveBridgeId: input.liveBridgeId || "",
    pin: readLiveRoomSessionPin(),
    publisherStagePin: readLiveKitPublisherStagePin(),
    ...(input.detail || {}),
  });
}

export function logLiveRoomUnmountReason(reason: string, extra?: Record<string, unknown>) {
  console.log("KRISTO_LIVE_ROOM_UNMOUNT_REASON", {
    reason,
    pathname: extra?.pathname ?? "",
    routeParams: extra?.routeParams ?? null,
    lastGuardState: extra?.lastGuardState ?? null,
    ...(extra || {}),
    pin: readLiveRoomSessionPin(),
    publisherStagePin: readLiveKitPublisherStagePin(),
  });
}

export function logLiveRoomShowEndedOverlay(input: {
  feedId: string;
  preservedRoute: boolean;
  source?: string;
}) {
  console.log("KRISTO_LIVE_ROOM_SHOW_ENDED_OVERLAY", input);
}
