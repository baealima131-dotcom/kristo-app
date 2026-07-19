import { endLiveBridgeForStaleScheduleFeedId } from "@/src/lib/staleBackendZeroSlotGuard";

type LiveKitHostLockListener = () => void;

function liveKitHostLockListeners(): Set<LiveKitHostLockListener> {
  const g = pinStore();
  if (!(g.__KRISTO_LIVEKIT_HOST_LOCK_LISTENERS__ instanceof Set)) {
    g.__KRISTO_LIVEKIT_HOST_LOCK_LISTENERS__ = new Set<LiveKitHostLockListener>();
  }
  return g.__KRISTO_LIVEKIT_HOST_LOCK_LISTENERS__ as Set<LiveKitHostLockListener>;
}

export function subscribeLiveKitHostLock(listener: LiveKitHostLockListener) {
  const listeners = liveKitHostLockListeners();
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function notifyLiveKitHostLock(reason?: string) {
  const snapshot = readLiveKitHostLockSnapshot();
  console.log("KRISTO_LIVEKIT_HOST_LOCK_NOTIFY", {
    reason: reason || "unknown",
    snapshot,
  });
  for (const listener of liveKitHostLockListeners()) {
    try {
      listener();
    } catch {}
  }
}

export function readLiveKitHostLockSnapshot() {
  const pin = readLiveKitPublisherStagePin();
  const sticky = pinStore().__KRISTO_LIVEKIT_STAGE_MOUNT_STICKY__;
  const beforeToken = readLiveKitPublisherHostBeforeTokenPin();
  return JSON.stringify({
    pinLiveBridgeId: pin?.liveBridgeId || "",
    pinAt: pin?.pinnedAt || 0,
    tokenReady: pin?.tokenReady === true,
    stickyRoom: sticky?.roomName || "",
    stickyAt: sticky?.pinnedAt || 0,
    stickyTokenReady: sticky?.tokenReady === true,
    beforeTokenLiveBridgeId: beforeToken?.liveBridgeId || "",
    beforeTokenAt: beforeToken?.pinnedAt || 0,
  });
}

export type LiveKitPublisherHostBeforeTokenPin = {
  liveBridgeId: string;
  stableIdentity?: string;
  pinnedAt: number;
  source?: string;
};

export function pinLiveKitPublisherHostBeforeToken(
  liveBridgeId: string,
  source?: string,
  opts?: { stableIdentity?: string }
) {
  const id = String(liveBridgeId || "").trim();
  if (!id) return;

  const prev = readLiveKitPublisherHostBeforeTokenPin();
  if (prev?.liveBridgeId === id) return;

  pinStore().__KRISTO_LIVEKIT_HOST_PINNED_BEFORE_TOKEN__ = {
    liveBridgeId: id,
    stableIdentity: opts?.stableIdentity,
    pinnedAt: Date.now(),
    source: source || "unknown",
  } satisfies LiveKitPublisherHostBeforeTokenPin;

  console.log("KRISTO_LIVEKIT_HOST_PINNED_BEFORE_TOKEN", {
    liveBridgeId: id,
    stableIdentity: opts?.stableIdentity || "",
    source: source || "unknown",
  });
  notifyLiveKitHostLock(source || "host-pinned-before-token");
}

export function readLiveKitPublisherHostBeforeTokenPin(): LiveKitPublisherHostBeforeTokenPin | null {
  const pin = pinStore().__KRISTO_LIVEKIT_HOST_PINNED_BEFORE_TOKEN__;
  if (!pin || typeof pin !== "object") return null;
  return pin as LiveKitPublisherHostBeforeTokenPin;
}

export function isLiveKitPublisherHostPinnedBeforeToken(liveBridgeId: string): boolean {
  const id = String(liveBridgeId || "").trim();
  if (!id) return false;
  return readLiveKitPublisherHostBeforeTokenPin()?.liveBridgeId === id;
}

export function clearLiveKitPublisherHostBeforeToken(reason?: string) {
  const pin = readLiveKitPublisherHostBeforeTokenPin();
  if (pin) {
    console.log("KRISTO_LIVEKIT_HOST_BEFORE_TOKEN_UNPINNED", {
      reason: reason || "unknown",
      liveBridgeId: pin.liveBridgeId,
    });
  }
  delete pinStore().__KRISTO_LIVEKIT_HOST_PINNED_BEFORE_TOKEN__;
}

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
  const prevLiveBridgeId = String(prev?.liveBridgeId || "").trim();
  const liveIdChanged = !!prevLiveBridgeId && prevLiveBridgeId !== liveBridgeId;
  const sticky = pinStore().__KRISTO_LIVEKIT_STAGE_MOUNT_STICKY__;
  const stickyRoomId = String(sticky?.roomName || "").trim();
  const publisherPin = readLiveKitPublisherStagePin();
  const beforeToken = readLiveKitPublisherHostBeforeTokenPin();
  const publisherStageLiveBridgeId = String(publisherPin?.liveBridgeId || "").trim();
  const beforeTokenLiveBridgeId = String(beforeToken?.liveBridgeId || "").trim();
  const foreignSticky =
    !!stickyRoomId && stickyRoomId !== liveBridgeId;
  const foreignPublisherPin =
    !!publisherStageLiveBridgeId && publisherStageLiveBridgeId !== liveBridgeId;
  const foreignBeforeToken =
    !!beforeTokenLiveBridgeId && beforeTokenLiveBridgeId !== liveBridgeId;
  const shouldClearForeignLocks =
    liveIdChanged || foreignSticky || foreignPublisherPin || foreignBeforeToken;

  if (shouldClearForeignLocks) {
    console.log("KRISTO_LIVE_STALE_ROOM_LOCK_CLEARED", {
      requestedLiveId: liveBridgeId,
      canonicalLiveSessionId: liveBridgeId,
      responseLiveId: "",
      hydratedScheduleId: "",
      stickyRoomId,
      previousLiveBridgeId: prevLiveBridgeId,
      publisherStageLiveBridgeId,
      beforeTokenLiveBridgeId,
      routeSlotCount: Math.max(Number(input.routeSlotCount ?? 0), 0),
      backendSlotCount: 0,
      source: input.source || "unknown",
      reason: liveIdChanged
        ? "canonical-live-id-changed"
        : foreignSticky
          ? "foreign-sticky-room"
          : foreignPublisherPin
            ? "foreign-publisher-stage-pin"
            : "foreign-before-token-pin",
    });
    // Dispose/unpin any publisher/viewer locks belonging to a different live.
    clearLiveKitPublisherStagePin("canonical-live-id-changed");
    clearLiveKitStageMountSticky("canonical-live-id-changed");
    clearLiveKitPublisherHostBeforeToken("canonical-live-id-changed");
  }

  pinStore().__KRISTO_LIVE_ROOM_SESSION_PIN__ = {
    liveBridgeId,
    userId: String(input.userId || (liveIdChanged ? "" : prev?.userId) || "").trim(),
    routeSlotCount: Math.max(
      Number(
        input.routeSlotCount ??
          (liveIdChanged ? 0 : prev?.routeSlotCount ?? 0)
      ),
      0
    ),
    pinnedAt: liveIdChanged ? Date.now() : prev?.pinnedAt || Date.now(),
    liveKitConnected:
      input.liveKitConnected === true ||
      (!liveIdChanged &&
        prev?.liveBridgeId === liveBridgeId &&
        prev?.liveKitConnected === true),
    liveKitConnecting:
      input.liveKitConnecting === true ||
      (!liveIdChanged &&
        prev?.liveBridgeId === liveBridgeId &&
        prev?.liveKitConnecting === true),
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
    liveKitConnecting: false,
    source: "livekit-connected",
  });
}

export function isLiveRoomLiveKitConnecting(liveBridgeId?: string): boolean {
  const pin = readLiveRoomSessionPin();
  if (!pin?.liveKitConnecting) return false;
  const id = String(liveBridgeId || "").trim();
  if (id && String(pin.liveBridgeId || "") !== id) return false;
  return true;
}

export function isLiveRoomLiveKitSessionActive(liveBridgeId?: string): boolean {
  const pin = readLiveRoomSessionPin();
  if (!pin) return false;
  const id = String(liveBridgeId || "").trim();
  if (id && String(pin.liveBridgeId || "") !== id) return false;
  return pin.liveKitConnecting === true || pin.liveKitConnected === true;
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
  lockKey?: string;
  stableIdentity?: string;
  pinnedAt: number;
  tokenReady?: boolean;
  source?: string;
};

export type LiveKitStageLockEntry = {
  count: number;
  tokenReady: boolean;
  sticky: boolean;
  primaryInstanceId: string;
};

export function buildLiveKitStageLockKey(roomName: string, stableIdentity: string) {
  return `${String(roomName || "").trim()}|${String(stableIdentity || "").trim()}`;
}

function liveKitStageLocksMap(): Map<string, LiveKitStageLockEntry> {
  const g = pinStore();
  if (!(g.__KRISTO_LIVEKIT_STAGE_LOCKS__ instanceof Map)) {
    const prev = g.__KRISTO_LIVEKIT_STAGE_LOCKS__;
    const next = new Map<string, LiveKitStageLockEntry>();
    if (prev instanceof Set) {
      for (const key of prev) {
        next.set(String(key), {
          count: 1,
          tokenReady: false,
          sticky: false,
          primaryInstanceId: "legacy",
        });
      }
    }
    g.__KRISTO_LIVEKIT_STAGE_LOCKS__ = next;
  }
  return g.__KRISTO_LIVEKIT_STAGE_LOCKS__ as Map<string, LiveKitStageLockEntry>;
}

export function readLiveKitStageLockEntry(lockKey: string): LiveKitStageLockEntry | null {
  const key = String(lockKey || "").trim();
  if (!key) return null;
  return liveKitStageLocksMap().get(key) || null;
}

export function logLiveKitStageMountAllowedTransition(input: {
  prev: boolean;
  next: boolean;
  source: string;
  lockKey?: string;
  roomName?: string;
  stableIdentity?: string;
  detail?: Record<string, unknown>;
}) {
  if (input.prev === input.next) return;
  console.log("KRISTO_LIVEKIT_STAGE_MOUNT_ALLOWED_TRANSITION", {
    prev: input.prev,
    next: input.next,
    source: input.source,
    lockKey: input.lockKey || "",
    roomName: input.roomName || "",
    stableIdentity: input.stableIdentity || "",
    publisherStagePin: readLiveKitPublisherStagePin(),
    lockEntry: input.lockKey ? readLiveKitStageLockEntry(input.lockKey) : null,
    ...(input.detail || {}),
  });
}

export function logShouldMountLiveKitPublisherStageTransition(input: {
  prev: boolean;
  next: boolean;
  source: string;
  detail?: Record<string, unknown>;
}) {
  if (input.prev === input.next) return;
  console.log("KRISTO_SHOULD_MOUNT_LIVEKIT_PUBLISHER_STAGE_TRANSITION", {
    prev: input.prev,
    next: input.next,
    source: input.source,
    publisherStagePin: readLiveKitPublisherStagePin(),
    ...(input.detail || {}),
  });
}

export function acquireLiveKitStageLock(input: {
  lockKey: string;
  instanceId: string;
  roomName?: string;
  stableIdentity?: string;
}): { allowed: boolean; reason: string; isPrimary: boolean } {
  const lockKey = String(input.lockKey || "").trim();
  const instanceId = String(input.instanceId || "").trim();
  if (!lockKey) {
    return { allowed: false, reason: "empty-lock-key", isPrimary: false };
  }

  const locks = liveKitStageLocksMap();
  const sticky = isLiveKitStageMountSticky(input.roomName || "", input.stableIdentity || "");
  const existing = locks.get(lockKey);

  if (!existing) {
    locks.set(lockKey, {
      count: 1,
      tokenReady: sticky,
      sticky,
      primaryInstanceId: instanceId,
    });
    return { allowed: true, reason: "lock-acquired-first", isPrimary: true };
  }

  if (sticky || existing.sticky || existing.tokenReady) {
    existing.sticky = existing.sticky || sticky;
    existing.tokenReady = existing.tokenReady || sticky;

    const primaryVacant =
      !existing.primaryInstanceId ||
      existing.primaryInstanceId === instanceId;

    if (primaryVacant) {
      existing.count = Math.max(1, existing.count);
      existing.primaryInstanceId = instanceId;
      return {
        allowed: true,
        reason: sticky ? "sticky-primary-reclaim" : "token-ready-primary-reclaim",
        isPrimary: true,
      };
    }

    if (existing.primaryInstanceId === instanceId) {
      existing.count += 1;
      return { allowed: true, reason: "sticky-primary-refcount", isPrimary: true };
    }

    return { allowed: false, reason: "duplicate-blocked-sticky-primary-active", isPrimary: false };
  }

  if (existing.primaryInstanceId !== instanceId) {
    return { allowed: false, reason: "duplicate-blocked", isPrimary: false };
  }

  existing.count += 1;
  return { allowed: true, reason: "lock-refcount-inc", isPrimary: true };
}

export function releaseLiveKitStageLock(input: {
  lockKey: string;
  instanceId: string;
  reason?: string;
}): void {
  const lockKey = String(input.lockKey || "").trim();
  const instanceId = String(input.instanceId || "").trim();
  if (!lockKey) return;

  const locks = liveKitStageLocksMap();
  const existing = locks.get(lockKey);
  if (!existing) return;

  if (existing.sticky || existing.tokenReady) {
    if (existing.primaryInstanceId === instanceId) {
      existing.primaryInstanceId = "";
    }
    existing.count = Math.max(0, existing.count - 1);
    if (existing.count <= 0) {
      existing.count = 0;
    }
    console.log("KRISTO_LIVEKIT_STAGE_LOCK_RETAINED", {
      lockKey,
      reason: input.reason || "sticky-or-token-ready",
      count: existing.count,
      tokenReady: existing.tokenReady,
      sticky: existing.sticky,
      primaryInstanceId: existing.primaryInstanceId || null,
    });
    return;
  }

  existing.count = Math.max(0, existing.count - 1);
  if (existing.count <= 0) {
    locks.delete(lockKey);
    console.log("KRISTO_LIVEKIT_STAGE_LOCK_RELEASED", {
      lockKey,
      reason: input.reason || "refcount-zero",
    });
  }
}

export function markLiveKitStageLockTokenReady(lockKey: string) {
  const key = String(lockKey || "").trim();
  if (!key) return;
  const locks = liveKitStageLocksMap();
  const existing = locks.get(key);
  if (existing) {
    existing.tokenReady = true;
    existing.sticky = true;
  } else {
    locks.set(key, {
      count: 1,
      tokenReady: true,
      sticky: true,
      primaryInstanceId: "token-ready",
    });
  }
}

export function pinLiveKitPublisherStage(
  liveBridgeId: string,
  source?: string,
  opts?: { lockKey?: string; stableIdentity?: string }
) {
  const id = String(liveBridgeId || "").trim();
  if (!id) return;
  const lockKey = String(opts?.lockKey || buildLiveKitStageLockKey(id, opts?.stableIdentity || "")).trim();
  if (lockKey.includes("|")) {
    markLiveKitStageLockTokenReady(lockKey);
  }
  pinStore().__KRISTO_LIVEKIT_PUBLISHER_STAGE_PIN__ = {
    liveBridgeId: id,
    lockKey: lockKey || undefined,
    stableIdentity: opts?.stableIdentity,
    pinnedAt: Date.now(),
    tokenReady: true,
    source: source || "unknown",
  } satisfies LiveKitPublisherStagePin;
  pinLiveKitStageMountSticky(id, opts?.stableIdentity || "", source || "publisher-stage-pin", lockKey);
  notifyLiveKitHostLock(source || "publisher-stage-pin");
  console.log("KRISTO_LIVEKIT_PUBLISHER_STAGE_PINNED", {
    liveBridgeId: id,
    lockKey,
    source: source || "unknown",
  });
}

export function pinLiveKitStageMountSticky(
  roomName: string,
  stableIdentity: string,
  source?: string,
  lockKey?: string
) {
  const room = String(roomName || "").trim();
  const identity = String(stableIdentity || "").trim();
  const key = String(lockKey || buildLiveKitStageLockKey(room, identity)).trim();
  if (!room || !key) return;

  markLiveKitStageLockTokenReady(key);
  pinStore().__KRISTO_LIVEKIT_STAGE_MOUNT_STICKY__ = {
    roomName: room,
    stableIdentity: identity,
    lockKey: key,
    pinnedAt: Date.now(),
    tokenReady: true,
    source: source || "unknown",
  };
  console.log("KRISTO_LIVEKIT_STAGE_MOUNT_STICKY", {
    roomName: room,
    stableIdentity: identity,
    lockKey: key,
    source: source || "unknown",
  });
  notifyLiveKitHostLock(source || "stage-mount-sticky");
}

export function isLiveKitStageMountSticky(roomName: string, stableIdentity?: string): boolean {
  const sticky = pinStore().__KRISTO_LIVEKIT_STAGE_MOUNT_STICKY__;
  if (!sticky || typeof sticky !== "object") return false;
  const room = String(roomName || "").trim();
  if (!room) return false;
  if (String(sticky.roomName || "") !== room) return false;
  if (stableIdentity && String(sticky.stableIdentity || "") !== String(stableIdentity || "")) {
    return false;
  }
  return sticky.tokenReady === true;
}

export function clearLiveKitStageMountSticky(reason?: string) {
  const sticky = pinStore().__KRISTO_LIVEKIT_STAGE_MOUNT_STICKY__;
  if (sticky) {
    console.log("KRISTO_LIVEKIT_STAGE_MOUNT_UNSTICKY", {
      reason: reason || "unknown",
      lockKey: sticky.lockKey || "",
      roomName: sticky.roomName || "",
    });
  }
  delete pinStore().__KRISTO_LIVEKIT_STAGE_MOUNT_STICKY__;
  if (sticky?.lockKey) {
    const locks = liveKitStageLocksMap();
    locks.delete(String(sticky.lockKey));
  }
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
  clearLiveKitStageMountSticky(reason || "publisher-stage-unpin");
  clearLiveKitPublisherHostBeforeToken(reason || "publisher-stage-unpin");
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

export type ClaimEnterSessionLock = {
  liveBridgeId: string;
  lockedUserId: string;
  routeClaimedByUserId: string;
  routeSlotNumber: number;
  canPublishCamera: boolean;
  canPublishMic: boolean;
  pinnedAt: number;
  source?: string;
  liveKitConnected?: boolean;
  cameraPublished?: boolean;
};

export function readClaimEnterSessionLock(liveBridgeId?: string): ClaimEnterSessionLock | null {
  const lock = pinStore().__KRISTO_CLAIM_ENTER_SESSION_LOCK__;
  if (!lock || typeof lock !== "object") return null;
  const id = String(liveBridgeId || "").trim();
  if (id && String(lock.liveBridgeId || "") !== id) return null;
  return lock as ClaimEnterSessionLock;
}

export function pinClaimEnterSessionLock(input: {
  liveBridgeId: string;
  lockedUserId: string;
  routeClaimedByUserId: string;
  routeSlotNumber?: number;
  canPublishCamera?: boolean;
  canPublishMic?: boolean;
  source?: string;
}) {
  const liveBridgeId = String(input.liveBridgeId || "").trim();
  const lockedUserId = String(input.lockedUserId || "").trim();
  const routeClaimedByUserId = String(input.routeClaimedByUserId || "").trim();
  if (!liveBridgeId || !lockedUserId || !routeClaimedByUserId) return false;

  const prev = readClaimEnterSessionLock(liveBridgeId);
  if (
    prev &&
    prev.lockedUserId === lockedUserId &&
    prev.routeClaimedByUserId === routeClaimedByUserId
  ) {
    return true;
  }

  pinStore().__KRISTO_CLAIM_ENTER_SESSION_LOCK__ = {
    liveBridgeId,
    lockedUserId,
    routeClaimedByUserId,
    routeSlotNumber: Math.max(1, Number(input.routeSlotNumber || prev?.routeSlotNumber || 1)),
    canPublishCamera: input.canPublishCamera === true,
    canPublishMic: input.canPublishMic === true,
    pinnedAt: Date.now(),
    source: input.source || "unknown",
    liveKitConnected: false,
    cameraPublished: false,
  } satisfies ClaimEnterSessionLock;

  console.log("KRISTO_CLAIM_ENTER_SESSION_LOCK_PINNED", {
    liveBridgeId,
    lockedUserId,
    routeClaimedByUserId,
    routeSlotNumber: pinStore().__KRISTO_CLAIM_ENTER_SESSION_LOCK__.routeSlotNumber,
    canPublishCamera: input.canPublishCamera === true,
    canPublishMic: input.canPublishMic === true,
    source: input.source || "unknown",
  });
  notifyLiveKitHostLock("claim-enter-lock-pinned");
  return true;
}

export function pinClaimEnterSessionLockFromRoute(input: {
  liveBridgeId: string;
  routeParams: Record<string, unknown>;
  source: string;
}): boolean {
  const liveBridgeId = String(input.liveBridgeId || "").trim();
  const routeClaimedByUserId = String(input.routeParams?.claimedByUserId || "").trim();
  const canPublishCamera = String(input.routeParams?.canPublishCamera || "") === "1";
  const canPublishMic = String(input.routeParams?.canPublishMic || "") === "1";
  const mediaSlotPublisher = String(input.routeParams?.mediaSlotPublisher || "") === "1";
  const wantsPublish = canPublishCamera || canPublishMic || mediaSlotPublisher;

  if (!liveBridgeId || !routeClaimedByUserId || !wantsPublish) return false;

  return pinClaimEnterSessionLock({
    liveBridgeId,
    lockedUserId: routeClaimedByUserId,
    routeClaimedByUserId,
    routeSlotNumber: Number(
      input.routeParams?.currentSlotNumber ||
        input.routeParams?.claimedSlotNumber ||
        input.routeParams?.preferredSlotNumber ||
        1
    ),
    canPublishCamera,
    canPublishMic,
    source: input.source,
  });
}

export function shouldHoldClaimEnterSessionLock(liveBridgeId?: string): boolean {
  const lock = readClaimEnterSessionLock(liveBridgeId);
  if (!lock) return false;
  if (lock.liveKitConnected && lock.cameraPublished) return false;
  return true;
}

export function markClaimEnterLiveKitConnected(liveBridgeId: string) {
  const lock = readClaimEnterSessionLock(liveBridgeId);
  if (!lock) return;
  lock.liveKitConnected = true;
  console.log("KRISTO_CLAIM_ENTER_SESSION_LOCK_LIVEKIT_CONNECTED", {
    liveBridgeId,
    lockedUserId: lock.lockedUserId,
    cameraPublished: lock.cameraPublished === true,
  });
  tryReleaseClaimEnterSessionLock(liveBridgeId, "livekit-connected");
}

export function markClaimEnterCameraPublished(liveBridgeId: string) {
  const lock = readClaimEnterSessionLock(liveBridgeId);
  if (!lock) return;
  lock.cameraPublished = true;
  console.log("KRISTO_CLAIM_ENTER_SESSION_LOCK_CAMERA_PUBLISHED", {
    liveBridgeId,
    lockedUserId: lock.lockedUserId,
    liveKitConnected: lock.liveKitConnected === true,
  });
  tryReleaseClaimEnterSessionLock(liveBridgeId, "camera-published");
}

export function tryReleaseClaimEnterSessionLock(liveBridgeId: string, reason: string) {
  const lock = readClaimEnterSessionLock(liveBridgeId);
  if (!lock) return;
  if (!lock.liveKitConnected || !lock.cameraPublished) return;
  clearClaimEnterSessionLock(reason);
}

export function clearClaimEnterSessionLock(reason?: string) {
  const lock = readClaimEnterSessionLock();
  if (lock) {
    console.log("KRISTO_CLAIM_ENTER_SESSION_LOCK_RELEASED", {
      reason: reason || "unknown",
      liveBridgeId: lock.liveBridgeId,
      lockedUserId: lock.lockedUserId,
      liveKitConnected: lock.liveKitConnected === true,
      cameraPublished: lock.cameraPublished === true,
    });
  }
  delete pinStore().__KRISTO_CLAIM_ENTER_SESSION_LOCK__;
  notifyLiveKitHostLock(reason || "claim-enter-lock-released");
}

export function readClaimEnterSessionLockSnapshot(): string {
  const lock = readClaimEnterSessionLock();
  if (!lock) return "";
  return JSON.stringify({
    liveBridgeId: lock.liveBridgeId,
    lockedUserId: lock.lockedUserId,
    routeClaimedByUserId: lock.routeClaimedByUserId,
    liveKitConnected: lock.liveKitConnected === true,
    cameraPublished: lock.cameraPublished === true,
    pinnedAt: lock.pinnedAt,
  });
}
