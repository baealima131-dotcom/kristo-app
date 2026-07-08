import {
  markClaimEnterLiveKitConnected,
  markLiveRoomLiveKitConnecting,
  markLiveRoomLiveKitConnected,
  readLiveRoomSessionPin,
} from "@/src/lib/liveRoomSessionGuard";
import { msSinceLiveRoomMount } from "@/src/lib/liveKitPerf";

export type LivePreflightStartupPhase =
  | "idle"
  | "connecting"
  | "connected"
  | "mic"
  | "camera"
  | "video"
  | "enter"
  | "complete";

type StartupAttempt = {
  startupAttemptId: string;
  roomName: string;
  identity: string;
  mountAt: number;
  phase: LivePreflightStartupPhase;
  connectStarted: boolean;
  connectAccepted: boolean;
  warmupConsumed: boolean;
  cameraPublishStarted: boolean;
  cameraPublished: boolean;
  duplicateConnectedIgnored: number;
  entryLocked: boolean;
};

type CompletionLock = {
  startupAttemptId: string;
  bridgeId: string;
  userId: string;
  lockedAt: number;
};

type Listener = () => void;

function store() {
  const g = globalThis as any;
  if (!g.__KRISTO_LIVE_PREFLIGHT_STARTUP__) {
    g.__KRISTO_LIVE_PREFLIGHT_STARTUP__ = {
      attempt: null as StartupAttempt | null,
      completionLock: null as CompletionLock | null,
      listeners: new Set<Listener>(),
    };
  }
  return g.__KRISTO_LIVE_PREFLIGHT_STARTUP__ as {
    attempt: StartupAttempt | null;
    completionLock: CompletionLock | null;
    listeners: Set<Listener>;
  };
}

function notifyListeners() {
  for (const listener of store().listeners) {
    try {
      listener();
    } catch {}
  }
}

function diagBase(extra?: Record<string, unknown>) {
  const attempt = store().attempt;
  return {
    startupAttemptId: attempt?.startupAttemptId || "",
    roomName: attempt?.roomName || "",
    identity: attempt?.identity || "",
    msSinceMount: msSinceLiveRoomMount(),
    ...(extra || {}),
  };
}

export function subscribeLivePreflightStartup(listener: Listener) {
  const listeners = store().listeners;
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function readLivePreflightStartupAttempt(): StartupAttempt | null {
  return store().attempt;
}

export function beginLivePreflightStartupAttempt(input: {
  roomName: string;
  identity: string;
  source: string;
}): string {
  const roomName = String(input.roomName || "").trim();
  const identity = String(input.identity || "").trim();
  const startupAttemptId = `pf-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const attempt: StartupAttempt = {
    startupAttemptId,
    roomName,
    identity,
    mountAt: Date.now(),
    phase: "idle",
    connectStarted: false,
    connectAccepted: false,
    warmupConsumed: false,
    cameraPublishStarted: false,
    cameraPublished: false,
    duplicateConnectedIgnored: 0,
    entryLocked: false,
  };
  store().attempt = attempt;
  console.log("KRISTO_LIVE_PREFLIGHT_STARTUP_ATTEMPT", diagBase({ source: input.source }));
  return startupAttemptId;
}

export function resetLivePreflightStartupAttempt(reason: string) {
  const prev = store().attempt;
  if (prev) {
    transitionLivePreflightStartupState("idle", "reset", { reason });
  }
  store().attempt = null;
  store().completionLock = null;
  notifyListeners();
}

export function isLivePreflightEntryLocked(liveBridgeId?: string): boolean {
  const lock = store().completionLock;
  if (!lock) return false;
  const bridge = String(liveBridgeId || "").trim();
  if (bridge && lock.bridgeId !== bridge) return false;
  return true;
}

export function lockLivePreflightCompleted(input: {
  bridgeId: string;
  userId: string;
  startupAttemptId?: string;
  source?: string;
}) {
  const bridgeId = String(input.bridgeId || "").trim();
  const userId = String(input.userId || "").trim();
  if (!bridgeId || !userId) return;
  const attempt = store().attempt;
  const startupAttemptId =
    String(input.startupAttemptId || attempt?.startupAttemptId || "").trim();
  store().completionLock = {
    startupAttemptId,
    bridgeId,
    userId,
    lockedAt: Date.now(),
  };
  if (attempt) {
    attempt.entryLocked = true;
    transitionLivePreflightStartupState("complete", input.source || "enter-allowed");
  }
  console.log("KRISTO_LIVE_PREFLIGHT_COMPLETED_LOCKED", {
    startupAttemptId,
    bridgeId,
    userId,
    source: input.source || "enter-allowed",
    msSinceMount: msSinceLiveRoomMount(),
  });
  notifyListeners();
}

export function clearLivePreflightCompletedLock(reason?: string) {
  if (store().completionLock) {
    console.log("KRISTO_LIVE_PREFLIGHT_COMPLETED_UNLOCKED", {
      reason: reason || "unknown",
      bridgeId: store().completionLock?.bridgeId || "",
      msSinceMount: msSinceLiveRoomMount(),
    });
  }
  store().completionLock = null;
  notifyListeners();
}

export function logLivePreflightReopenBlockedAfterEntry(reason: string, extra?: Record<string, unknown>) {
  const lock = store().completionLock;
  console.log("KRISTO_LIVE_PREFLIGHT_REOPEN_BLOCKED_AFTER_ENTRY", {
    reason,
    startupAttemptId: lock?.startupAttemptId || readLivePreflightStartupAttempt()?.startupAttemptId || "",
    bridgeId: lock?.bridgeId || "",
    userId: lock?.userId || "",
    msSinceMount: msSinceLiveRoomMount(),
    ...(extra || {}),
  });
}

export function logLiveCameraPausedInRoom(input: {
  bridgeId: string;
  userId: string;
}) {
  const lock = store().completionLock;
  console.log("KRISTO_LIVE_CAMERA_PAUSED_IN_ROOM", {
    startupAttemptId: lock?.startupAttemptId || readLivePreflightStartupAttempt()?.startupAttemptId || "",
    bridgeId: String(input.bridgeId || "").trim(),
    userId: String(input.userId || "").trim(),
    stayedInRoom: true,
    msSinceMount: msSinceLiveRoomMount(),
  });
}

export function transitionLivePreflightStartupState(
  toState: LivePreflightStartupPhase,
  source: string,
  extra?: Record<string, unknown>
) {
  const attempt = store().attempt;
  if (!attempt) return;
  const fromState = attempt.phase;
  if (fromState === toState) return;
  attempt.phase = toState;
  console.log("KRISTO_LIVE_PREFLIGHT_STATE_TRANSITION", diagBase({
    fromState,
    toState,
    source,
    ...(extra || {}),
  }));
  notifyListeners();
}

export function isLiveKitRoomActuallyConnected(liveBridgeId: string): boolean {
  const bridge = String(liveBridgeId || "").trim();
  if (!bridge) return false;
  const activeRoom = String((globalThis as any).__KRISTO_LIVEKIT_ACTIVE_ROOM__ || "").trim();
  if (activeRoom !== bridge) return false;
  const held = (globalThis as any).__KRISTO_HELD_LIVEKIT_ROOM__;
  if (!held) return false;
  const state = String((held as any)?.state || (held as any)?.connectionState || "").toLowerCase();
  return state === "connected";
}

export function isLivePreflightConnectAccepted(liveBridgeId: string): boolean {
  const bridge = String(liveBridgeId || "").trim();
  if (!bridge) return false;
  const attempt = store().attempt;
  if (attempt?.roomName === bridge && attempt.connectAccepted) return true;
  const pin = readLiveRoomSessionPin();
  return pin?.liveBridgeId === bridge && pin.liveKitConnected === true;
}

export function tryBeginLiveKitConnectOnce(input: {
  roomName: string;
  identity: string;
  source: string;
}): boolean {
  const roomName = String(input.roomName || "").trim();
  const identity = String(input.identity || "").trim();
  let attempt = store().attempt;
  if (!attempt || attempt.roomName !== roomName) {
    beginLivePreflightStartupAttempt({
      roomName,
      identity,
      source: `${input.source}-implicit`,
    });
    attempt = store().attempt;
  }
  if (!attempt) return false;
  if (attempt.connectStarted) {
    return false;
  }
  attempt.connectStarted = true;
  markLiveRoomLiveKitConnecting(roomName);
  transitionLivePreflightStartupState("connecting", input.source);
  console.log("KRISTO_LIVE_PREFLIGHT_CONNECT_ONCE", diagBase({ source: input.source }));
  return true;
}

export function tryAcceptLiveKitConnectedOnce(input: {
  roomName: string;
  identity: string;
  source: string;
}): boolean {
  const roomName = String(input.roomName || "").trim();
  const identity = String(input.identity || "").trim();
  const attempt = store().attempt;

  if (attempt?.connectAccepted && attempt.roomName === roomName) {
    attempt.duplicateConnectedIgnored += 1;
    console.log("KRISTO_LIVE_PREFLIGHT_DUPLICATE_CONNECTED_IGNORED", diagBase({
      source: input.source,
      duplicateCount: attempt.duplicateConnectedIgnored,
    }));
    return false;
  }

  if (attempt && attempt.roomName === roomName && !attempt.connectAccepted) {
    attempt.connectAccepted = true;
    if (!attempt.connectStarted) {
      attempt.connectStarted = true;
    }
    markLiveRoomLiveKitConnected(roomName);
    markClaimEnterLiveKitConnected(roomName);
    transitionLivePreflightStartupState("connected", input.source);
    console.log("KRISTO_LIVE_PREFLIGHT_CONNECTED_ACCEPTED", diagBase({ source: input.source }));
    notifyListeners();
    return true;
  }

  // Fallback when startup attempt was not initialized yet (e.g. silent token path).
  const pin = readLiveRoomSessionPin();
  if (pin?.liveBridgeId === roomName && pin.liveKitConnected) {
    console.log("KRISTO_LIVE_PREFLIGHT_DUPLICATE_CONNECTED_IGNORED", diagBase({
      source: input.source,
      duplicateCount: 1,
      reason: "session-pin-already-connected",
    }));
    return false;
  }

  markLiveRoomLiveKitConnected(roomName);
  markClaimEnterLiveKitConnected(roomName);
  if (attempt) {
    attempt.connectAccepted = true;
    attempt.connectStarted = true;
    transitionLivePreflightStartupState("connected", input.source);
  }
  console.log("KRISTO_LIVE_PREFLIGHT_CONNECTED_ACCEPTED", diagBase({
    source: input.source,
    fallback: true,
  }));
  notifyListeners();
  return true;
}

export function tryMarkWarmupConsumedOnce(input: {
  roomName: string;
  identity: string;
  source: string;
}): boolean {
  const attempt = store().attempt;
  if (!attempt || attempt.roomName !== String(input.roomName || "").trim()) {
    console.log("KRISTO_LIVE_PREFLIGHT_WARMUP_CONSUME_ONCE", diagBase({
      source: input.source,
      allowed: true,
      reason: "no-attempt-guard",
    }));
    return true;
  }
  if (attempt.warmupConsumed) {
    return false;
  }
  attempt.warmupConsumed = true;
  console.log("KRISTO_LIVE_PREFLIGHT_WARMUP_CONSUME_ONCE", diagBase({
    source: input.source,
    allowed: true,
  }));
  return true;
}

export function tryBeginCameraPublishOnce(input: {
  roomName: string;
  identity: string;
  source: string;
}): boolean {
  const roomName = String(input.roomName || "").trim();
  const attempt = store().attempt;
  if (attempt && attempt.roomName === roomName) {
    if (attempt.cameraPublished) {
      console.log("KRISTO_LIVE_PREFLIGHT_CAMERA_PUBLISH_ONCE", diagBase({
        source: input.source,
        allowed: false,
        reason: "camera-already-published",
      }));
      return false;
    }
    if (attempt.cameraPublishStarted) {
      console.log("KRISTO_LIVE_PREFLIGHT_CAMERA_PUBLISH_ONCE", diagBase({
        source: input.source,
        allowed: false,
        reason: "publish-already-started",
      }));
      return false;
    }
    attempt.cameraPublishStarted = true;
    transitionLivePreflightStartupState("video", input.source);
    console.log("KRISTO_LIVE_PREFLIGHT_CAMERA_PUBLISH_ONCE", diagBase({
      source: input.source,
      allowed: true,
    }));
    return true;
  }
  console.log("KRISTO_LIVE_PREFLIGHT_CAMERA_PUBLISH_ONCE", diagBase({
    source: input.source,
    allowed: true,
    reason: "no-attempt-guard",
  }));
  return true;
}

export function markLivePreflightCameraPublished(input: {
  roomName: string;
  source: string;
}) {
  const attempt = store().attempt;
  if (attempt && attempt.roomName === String(input.roomName || "").trim()) {
    attempt.cameraPublished = true;
    transitionLivePreflightStartupState("enter", input.source);
  }
  notifyListeners();
}

export function resetLivePreflightCameraPublishForRetry(reason: string) {
  const attempt = store().attempt;
  if (!attempt) return;
  attempt.cameraPublishStarted = false;
  attempt.cameraPublished = false;
  console.log("KRISTO_LIVE_PREFLIGHT_CAMERA_PUBLISH_RETRY_RESET", diagBase({ reason }));
  notifyListeners();
}
