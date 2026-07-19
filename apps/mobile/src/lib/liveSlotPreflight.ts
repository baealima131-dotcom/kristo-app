/**
 * Rolling next-slot Big Screen preflight.
 *
 * While slot N is active, prepare only slot N+1 (avatar, profile, token,
 * optional publisher warmup, layout context). On boundary handoff the next
 * participant can promote instantly. Never warms all future slots.
 */
import { fetchLiveKitToken } from "@/src/lib/liveKitTokenPrefetch";
import {
  clearPublisherVideoTrackWarmup,
  ensurePublisherVideoTrackWarmup,
} from "@/src/lib/livePreflightPublisherWarmup";
import {
  preloadLiveImages,
  resolveCachedLiveAvatar,
} from "@/src/lib/liveRealtime";
import {
  liveSlotPreflightKey,
  liveSlotPublisherIdentity,
  resolveNextClaimedSlotForPreflight,
  type ClaimedSlotLike,
} from "@/src/lib/liveSlotPreflightCore";

export {
  liveSlotPreflightKey,
  liveSlotPublisherIdentity,
  resolveNextClaimedSlotForPreflight,
  type ClaimedSlotLike,
} from "@/src/lib/liveSlotPreflightCore";

export type LiveSlotPreflightTarget = {
  liveBridgeId: string;
  roomName: string;
  slotId: string;
  slotNumber: number;
  ownerUserId: string;
  ownerName: string;
  avatarUri: string;
  startMs: number;
  endMs: number;
  identity: string;
  isLocalUserNext: boolean;
};

export type LiveSlotPreflightStatus =
  | "idle"
  | "running"
  | "ready"
  | "failed"
  | "cancelled";

export type LiveSlotPreflightSnapshot = {
  key: string;
  status: LiveSlotPreflightStatus;
  target: LiveSlotPreflightTarget;
  avatarReady: boolean;
  profileReady: boolean;
  tokenReady: boolean;
  publisherWarmupStarted: boolean;
  layoutReady: boolean;
  startedAt: number;
  readyAt?: number;
  error?: string;
  generation: number;
};

function store(): {
  byBridge: Record<string, LiveSlotPreflightSnapshot>;
} {
  const g = globalThis as any;
  if (!g.__KRISTO_LIVE_SLOT_PREFLIGHT__) {
    g.__KRISTO_LIVE_SLOT_PREFLIGHT__ = { byBridge: {} };
  }
  return g.__KRISTO_LIVE_SLOT_PREFLIGHT__;
}

function norm(value: unknown) {
  return String(value || "").trim();
}

export function readLiveSlotPreflight(
  liveBridgeId: string
): LiveSlotPreflightSnapshot | null {
  const id = norm(liveBridgeId);
  if (!id) return null;
  return store().byBridge[id] || null;
}

export function cancelLiveSlotPreflight(args: {
  liveBridgeId: string;
  reason: string;
  clearPublisherWarmup?: boolean;
}) {
  const liveBridgeId = norm(args.liveBridgeId);
  if (!liveBridgeId) return;
  const cur = store().byBridge[liveBridgeId];
  if (!cur || cur.status === "cancelled" || cur.status === "idle") {
    delete store().byBridge[liveBridgeId];
    return;
  }

  console.log("KRISTO_SLOT_PREFLIGHT_CANCELLED", {
    liveBridgeId,
    reason: args.reason,
    slotId: cur.target.slotId,
    slotNumber: cur.target.slotNumber,
    ownerUserId: cur.target.ownerUserId,
    previousStatus: cur.status,
  });

  if (args.clearPublisherWarmup && cur.target.isLocalUserNext) {
    clearPublisherVideoTrackWarmup();
  }

  delete store().byBridge[liveBridgeId];
}

function markReadyIfComplete(
  snap: LiveSlotPreflightSnapshot
): LiveSlotPreflightSnapshot {
  if (snap.status !== "running") return snap;
  const tokenOk = snap.target.isLocalUserNext ? snap.tokenReady : true;
  if (
    snap.avatarReady &&
    snap.profileReady &&
    snap.layoutReady &&
    tokenOk
  ) {
    const ready: LiveSlotPreflightSnapshot = {
      ...snap,
      status: "ready",
      readyAt: Date.now(),
    };
    console.log("KRISTO_SLOT_PREFLIGHT_READY", {
      liveBridgeId: ready.target.liveBridgeId,
      slotId: ready.target.slotId,
      slotNumber: ready.target.slotNumber,
      ownerUserId: ready.target.ownerUserId,
      avatarReady: ready.avatarReady,
      profileReady: ready.profileReady,
      tokenReady: ready.tokenReady,
      publisherWarmupStarted: ready.publisherWarmupStarted,
      layoutReady: ready.layoutReady,
      elapsedMs: Date.now() - ready.startedAt,
    });
    return ready;
  }
  return snap;
}

async function runPreflightWork(
  generation: number,
  target: LiveSlotPreflightTarget,
  headers: Record<string, string>,
  localUserIsActiveSpeaker: boolean
) {
  const liveBridgeId = target.liveBridgeId;
  const write = (patch: Partial<LiveSlotPreflightSnapshot>) => {
    const cur = store().byBridge[liveBridgeId];
    if (!cur || cur.generation !== generation) return null;
    const next = markReadyIfComplete({ ...cur, ...patch });
    store().byBridge[liveBridgeId] = next;
    return next;
  };

  try {
    if (target.avatarUri) {
      preloadLiveImages([target.avatarUri], 1);
    }
    write({ avatarReady: true, layoutReady: true });

    let profileAvatar = target.avatarUri;
    if (target.ownerUserId) {
      const cached = await resolveCachedLiveAvatar(target.ownerUserId);
      if (cached) {
        profileAvatar = cached;
        preloadLiveImages([cached], 1);
      }
    }
    const curAfterProfile = write({
      profileReady: true,
      target: { ...target, avatarUri: profileAvatar || target.avatarUri },
    });
    if (!curAfterProfile) return;

    if (target.isLocalUserNext) {
      const token = await fetchLiveKitToken({
        roomName: target.roomName || target.liveBridgeId,
        identity: target.identity,
        canPublish: true,
        headers,
        source: "slot-preflight-next",
      });
      if (!token?.token) {
        throw new Error("next_slot_token_unavailable");
      }
      const afterToken = write({ tokenReady: true });
      if (!afterToken) return;

      // Never steal the camera from the current active speaker.
      if (!localUserIsActiveSpeaker) {
        ensurePublisherVideoTrackWarmup({
          liveBridgeId: target.liveBridgeId,
          userId: target.ownerUserId,
          cameraFacing: "front",
          source: "slot-preflight-next",
        });
        write({ publisherWarmupStarted: true });
      }
    } else {
      write({ tokenReady: true });
    }
  } catch (error) {
    const cur = store().byBridge[liveBridgeId];
    if (!cur || cur.generation !== generation) return;
    const failed: LiveSlotPreflightSnapshot = {
      ...cur,
      status: "failed",
      error: String((error as any)?.message || error || "preflight_failed"),
    };
    store().byBridge[liveBridgeId] = failed;
    console.log("KRISTO_SLOT_PREFLIGHT_FAILED", {
      liveBridgeId,
      slotId: target.slotId,
      slotNumber: target.slotNumber,
      ownerUserId: target.ownerUserId,
      error: failed.error,
    });
  }
}

/**
 * Keep exactly one rolling next-slot preflight for the live room.
 * Call whenever schedule / clock / next claimed owner changes.
 */
export function syncLiveSlotPreflight(args: {
  liveBridgeId: string;
  roomName?: string;
  currentUserId: string;
  headers: Record<string, string>;
  nextSlot: {
    id: string;
    slotNumber: number;
    ownerUserId: string;
    ownerName: string;
    avatarUri: string;
    startMs: number;
    endMs: number;
  } | null;
  localUserIsActiveSpeaker: boolean;
}): LiveSlotPreflightSnapshot | null {
  const liveBridgeId = norm(args.liveBridgeId);
  const currentUserId = norm(args.currentUserId);
  if (!liveBridgeId) return null;

  if (!args.nextSlot) {
    cancelLiveSlotPreflight({
      liveBridgeId,
      reason: "no_next_claimed_slot",
      clearPublisherWarmup: false,
    });
    return null;
  }

  const ownerUserId = norm(args.nextSlot.ownerUserId);
  const slotNumber = Math.max(
    1,
    Math.floor(Number(args.nextSlot.slotNumber) || 1)
  );
  const startMs = Math.max(0, Math.floor(Number(args.nextSlot.startMs) || 0));
  const slotId = norm(args.nextSlot.id) || `slot_${slotNumber}`;
  const isLocalUserNext =
    Boolean(ownerUserId) && ownerUserId === currentUserId;

  const target: LiveSlotPreflightTarget = {
    liveBridgeId,
    roomName: norm(args.roomName) || liveBridgeId,
    slotId,
    slotNumber,
    ownerUserId,
    ownerName: norm(args.nextSlot.ownerName) || "Speaker",
    avatarUri: norm(args.nextSlot.avatarUri),
    startMs,
    endMs: Math.max(0, Math.floor(Number(args.nextSlot.endMs) || 0)),
    identity: liveSlotPublisherIdentity(
      ownerUserId || currentUserId,
      slotNumber
    ),
    isLocalUserNext,
  };

  const key = liveSlotPreflightKey(target);
  const existing = store().byBridge[liveBridgeId];

  if (
    existing &&
    existing.key === key &&
    (existing.status === "running" || existing.status === "ready")
  ) {
    return existing;
  }

  if (existing && existing.key !== key) {
    cancelLiveSlotPreflight({
      liveBridgeId,
      reason: "next_slot_changed",
      clearPublisherWarmup: existing.target.isLocalUserNext,
    });
  }

  const generation = (existing?.generation || 0) + 1;
  const startedAt = Date.now();
  const snapshot: LiveSlotPreflightSnapshot = {
    key,
    status: "running",
    target,
    avatarReady: false,
    profileReady: false,
    tokenReady: !isLocalUserNext,
    publisherWarmupStarted: false,
    layoutReady: false,
    startedAt,
    generation,
  };
  store().byBridge[liveBridgeId] = snapshot;

  console.log("KRISTO_SLOT_PREFLIGHT_START", {
    liveBridgeId,
    slotId: target.slotId,
    slotNumber: target.slotNumber,
    ownerUserId: target.ownerUserId,
    ownerName: target.ownerName,
    startMs: target.startMs,
    endMs: target.endMs,
    identity: target.identity,
    isLocalUserNext: target.isLocalUserNext,
    localUserIsActiveSpeaker: args.localUserIsActiveSpeaker,
  });

  void runPreflightWork(
    generation,
    target,
    args.headers || {},
    args.localUserIsActiveSpeaker === true
  );

  return snapshot;
}

export function noteLiveSlotPromotedToBigScreen(args: {
  liveBridgeId: string;
  slotId: string;
  slotNumber: number;
  ownerUserId: string;
  previousSlotNumber?: number | null;
  fromBoundaryHandoff?: boolean;
  trackReady?: boolean;
}) {
  const liveBridgeId = norm(args.liveBridgeId);
  const slotId = norm(args.slotId);
  const ownerUserId = norm(args.ownerUserId);
  const slotNumber = Math.max(1, Math.floor(Number(args.slotNumber) || 1));
  const preflight = readLiveSlotPreflight(liveBridgeId);
  const fromPreflight =
    preflight?.status === "ready" &&
    (norm(preflight.target.slotId) === slotId ||
      preflight.target.slotNumber === slotNumber) &&
    (!ownerUserId ||
      !preflight.target.ownerUserId ||
      preflight.target.ownerUserId === ownerUserId);

  console.log("KRISTO_SLOT_PROMOTED_TO_BIG_SCREEN", {
    liveBridgeId,
    slotId,
    slotNumber,
    ownerUserId,
    previousSlotNumber: args.previousSlotNumber ?? null,
    fromPreflight,
    fromBoundaryHandoff: args.fromBoundaryHandoff === true,
    trackReady: args.trackReady !== false,
    preflightStatus: preflight?.status || "none",
    avatarReady: preflight?.avatarReady === true,
    tokenReady: preflight?.tokenReady === true,
    publisherWarmupStarted: preflight?.publisherWarmupStarted === true,
  });

  if (fromPreflight || preflight || args.fromBoundaryHandoff) {
    cancelLiveSlotPreflight({
      liveBridgeId,
      reason: "promoted_to_big_screen",
      clearPublisherWarmup: false,
    });
  }
}
