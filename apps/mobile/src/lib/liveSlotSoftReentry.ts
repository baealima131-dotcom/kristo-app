/**
 * Automatic slot soft re-entry orchestrator.
 * Re-initializes live-session state for EVERY participant at each slot boundary
 * without navigating away from the live room.
 */
import {
  fetchLiveKitToken,
  invalidateLiveKitTokenCache,
} from "@/src/lib/liveKitTokenPrefetch";
import { extractUserIdFromLiveKitIdentity } from "@/src/lib/liveSlotParticipantRegistry";
import type { SlotTransitionPhase } from "@/src/lib/liveSlotTransitionCore";

export type SoftReentryOrchestratorInput = {
  transitionId: string;
  canonicalLiveSessionId: string;
  incomingSlotId: string;
  incomingOwnerUserId: string;
  outgoingSlotId?: string;
  outgoingOwnerUserId?: string;
  scheduleVersion?: string;
  currentUserId: string;
};

export type SoftReentryOrchestratorAdapters = {
  canonicalLiveSessionId: string;
  currentUserId: string;
  headers: Record<string, string>;
  /** Prevents duplicate soft re-entry for the same transitionId. */
  reentryInFlightRef: { current: string };
  pushLiveAction: (action: string, body?: Record<string, any>) => Promise<any>;
  suppressLocalCamera: (room: any, reason: string) => Promise<boolean>;
  suppressLocalMic: (room: any, reason: string) => Promise<boolean>;
  publishLocalCamera: (room: any) => Promise<boolean>;
  publishLocalMic?: (room: any) => Promise<boolean>;
  resetLocalVideoReady: () => void;
  bumpLiveNowMs: (at: number) => void;
  /** Controlled soft exit: dispose LiveKit + clear live-session stale state only. */
  clearStaleLiveSessionState: (input: SoftReentryOrchestratorInput) => Promise<void>;
  /** Exact-ID refetch of live + schedule + roles. Must reject foreign live IDs. */
  refetchExactLiveSession: (input: SoftReentryOrchestratorInput) => Promise<{
    ok: boolean;
    live?: any;
    activeSlotId?: string;
    activeOwnerUserId?: string;
    abortReason?: string;
  }>;
  /** Apply server-authoritative role/permission state after refetch. */
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
  onProgress?: (phase: SlotTransitionPhase, extra?: Record<string, unknown>) => void;
  onCompleted: (input: SoftReentryOrchestratorInput & { videoReady: boolean }) => void;
  onFailed: (input: SoftReentryOrchestratorInput & { reason: string }) => void;
  canPublishMicForIncoming: boolean;
};

function norm(v: unknown) {
  return String(v || "").trim();
}

function sleep(ms: number) {
  return new Promise<void>((r) => setTimeout(r, ms));
}

function readRoom() {
  const g = globalThis as any;
  return g.__KRISTO_LIVEKIT_CONNECTED_ROOM__ || g.__KRISTO_HELD_LIVEKIT_ROOM__ || null;
}

function isLocalVideoTrackReady(room: any): boolean {
  try {
    const lp: any = room?.localParticipant;
    if (!lp) return false;
    const pubs = Array.from(lp?.trackPublications?.values?.() || []) as any[];
    for (const pub of pubs) {
      const source = String(pub?.source || "").toLowerCase();
      const kind = String(pub?.kind || pub?.track?.kind || "").toLowerCase();
      if (!(kind === "video" || source.includes("camera"))) continue;
      const track: any = pub?.track || pub?.videoTrack || null;
      const media = track?.mediaStreamTrack;
      if (!media) continue;
      if (track?.isMuted === true || pub?.isMuted === true) continue;
      if (String(media.readyState || "").toLowerCase() !== "live") continue;
      if (media.enabled === false) continue;
      return true;
    }
  } catch {}
  return false;
}

function isRemoteVideoReady(room: any, ownerUserId: string): boolean {
  const uid = norm(ownerUserId);
  if (!uid || !room) return false;
  try {
    const remotes = Array.from((room as any)?.remoteParticipants?.values?.() || []) as any[];
    const participant = remotes.find(
      (entry) => extractUserIdFromLiveKitIdentity(String(entry?.identity || "")) === uid
    );
    if (!participant) return false;
    const pubs = Array.from(participant?.trackPublications?.values?.() || []) as any[];
    for (const pub of pubs) {
      const source = String(pub?.source || "").toLowerCase();
      const kind = String(pub?.kind || pub?.track?.kind || "").toLowerCase();
      if (!(kind === "video" || source.includes("camera"))) continue;
      if (pub?.isMuted === true || pub?.muted === true) continue;
      const track: any = pub?.track || pub?.videoTrack || null;
      const media = track?.mediaStreamTrack;
      if (!media) continue;
      if (track?.isMuted === true) continue;
      if (String(media.readyState || "").toLowerCase() !== "live") continue;
      if (media.enabled === false) continue;
      return true;
    }
  } catch {}
  return false;
}

async function waitFor(predicate: () => boolean, timeoutMs: number, intervalMs = 100) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    if (predicate()) return true;
    await sleep(intervalMs);
  }
  return predicate();
}

const completedByTransition = new Map<string, string>();

function completionKey(canonicalLiveSessionId: string, transitionId: string) {
  return `${norm(canonicalLiveSessionId)}|${norm(transitionId)}`;
}

export function wasSoftReentryCompleted(
  canonicalLiveSessionId: string,
  transitionId: string
): boolean {
  return completedByTransition.get(completionKey(canonicalLiveSessionId, transitionId)) === "done";
}

export function clearSoftReentryCompletion(
  canonicalLiveSessionId: string,
  transitionId: string
) {
  completedByTransition.delete(completionKey(canonicalLiveSessionId, transitionId));
}

/**
 * Soft re-entry for one SLOT_TRANSITION_START.
 * Idempotent per (canonicalLiveSessionId, transitionId) via reentryInFlightRef + completion map.
 */
export async function performAutomaticSlotSoftReentry(
  input: SoftReentryOrchestratorInput,
  adapters: SoftReentryOrchestratorAdapters
): Promise<{ ok: boolean; deduped?: boolean; reason?: string }> {
  const transitionId = norm(input.transitionId);
  const canonicalLiveSessionId = norm(
    input.canonicalLiveSessionId || adapters.canonicalLiveSessionId
  );
  const incomingSlotId = norm(input.incomingSlotId);
  const incomingOwnerUserId = norm(input.incomingOwnerUserId);
  const currentUserId = norm(input.currentUserId || adapters.currentUserId);
  const isIncoming = !!currentUserId && currentUserId === incomingOwnerUserId;

  const baseLog = {
    transitionId,
    canonicalLiveSessionId,
    incomingSlotId,
    incomingOwnerUserId,
    outgoingSlotId: norm(input.outgoingSlotId),
    outgoingOwnerUserId: norm(input.outgoingOwnerUserId),
    scheduleVersion: norm(input.scheduleVersion),
    currentUserId,
    isIncoming,
    serverNow: Date.now(),
  };

  if (!transitionId || !canonicalLiveSessionId) {
    console.log("KRISTO_SLOT_SOFT_REENTRY_FAILED", {
      ...baseLog,
      reason: "missing_transition_or_canonical_id",
    });
    adapters.onFailed({ ...input, canonicalLiveSessionId, transitionId, reason: "missing_ids" });
    return { ok: false, reason: "missing_ids" };
  }

  if (norm(adapters.canonicalLiveSessionId) && norm(adapters.canonicalLiveSessionId) !== canonicalLiveSessionId) {
    console.log("KRISTO_LIVE_SESSION_ID_MISMATCH_BLOCKED", {
      requestedLiveId: canonicalLiveSessionId,
      canonicalLiveSessionId,
      responseLiveId: adapters.canonicalLiveSessionId,
      source: "slot-soft-reentry-orchestrator",
      transitionId,
      reason: "adapter_canonical_diverged",
    });
    adapters.onFailed({
      ...input,
      canonicalLiveSessionId,
      transitionId,
      reason: "canonical_mismatch",
    });
    return { ok: false, reason: "canonical_mismatch" };
  }

  const doneKey = completionKey(canonicalLiveSessionId, transitionId);
  if (
    adapters.reentryInFlightRef.current === transitionId ||
    completedByTransition.get(doneKey) === "done"
  ) {
    console.log("KRISTO_SLOT_SOFT_REENTRY_DEDUPED", {
      ...baseLog,
      inFlight: adapters.reentryInFlightRef.current,
      completed: completedByTransition.get(doneKey) === "done",
    });
    return { ok: false, deduped: true };
  }

  adapters.reentryInFlightRef.current = transitionId;
  console.log("KRISTO_SLOT_SOFT_REENTRY_START", baseLog);

  try {
    adapters.bumpLiveNowMs(Date.now());
    adapters.onProgress?.("loading_schedule", { role: isIncoming ? "incoming" : "remote" });

    // Soft exit: unpublish → dispose → clear live-session stale only.
    const room = readRoom();
    if (room) {
      await adapters.suppressLocalCamera(room, "slot-soft-reentry");
      await adapters.suppressLocalMic(room, "slot-soft-reentry");
      adapters.resetLocalVideoReady();
    }
    console.log("KRISTO_SLOT_SOFT_REENTRY_UNPUBLISH_DONE", baseLog);

    await adapters.clearStaleLiveSessionState({
      ...input,
      transitionId,
      canonicalLiveSessionId,
      incomingSlotId,
      incomingOwnerUserId,
      currentUserId,
    });
    console.log("KRISTO_SLOT_SOFT_REENTRY_ROOM_DISCONNECTED", baseLog);
    console.log("KRISTO_SLOT_SOFT_REENTRY_STALE_STATE_CLEARED", baseLog);

    // Exact-ID refetch (same live only).
    console.log("KRISTO_SLOT_SOFT_REENTRY_LIVE_REFETCH_START", baseLog);
    adapters.onProgress?.("loading_schedule", { step: "refetch" });
    const refetch = await adapters.refetchExactLiveSession({
      ...input,
      transitionId,
      canonicalLiveSessionId,
      incomingSlotId,
      incomingOwnerUserId,
      currentUserId,
    });
    if (!refetch.ok) {
      throw new Error(refetch.abortReason || "exact_id_refetch_failed");
    }
    const activeSlotId = norm(refetch.activeSlotId || incomingSlotId);
    const activeOwnerUserId = norm(refetch.activeOwnerUserId || incomingOwnerUserId);
    console.log("KRISTO_SLOT_SOFT_REENTRY_LIVE_REFETCH_DONE", {
      ...baseLog,
      activeSlotId,
      activeOwnerUserId,
      responseLiveId: norm(refetch.live?.liveId),
    });

    adapters.applyRoleStateFromLive({
      transitionId,
      canonicalLiveSessionId,
      incomingSlotId: activeSlotId || incomingSlotId,
      incomingOwnerUserId: activeOwnerUserId || incomingOwnerUserId,
      live: refetch.live,
    });
    console.log("KRISTO_SLOT_SOFT_REENTRY_ROLE_STATE_READY", {
      ...baseLog,
      activeSlotId,
      activeOwnerUserId,
    });
    adapters.onProgress?.("getting_token");

    // Fresh token for the same canonical live ID.
    invalidateLiveKitTokenCache({
      roomName: canonicalLiveSessionId,
      identity: currentUserId,
    });
    let tokenOk = false;
    if (currentUserId) {
      const token = await fetchLiveKitToken({
        roomName: canonicalLiveSessionId,
        identity: currentUserId,
        canPublish: isIncoming,
        headers: adapters.headers,
        source: "slot-soft-reentry",
        forceRefresh: true,
      });
      tokenOk = Boolean(token?.url && token?.token);
      if (tokenOk) {
        const g = globalThis as any;
        g.__KRISTO_LIVEKIT_ACTIVE_ROOM__ = canonicalLiveSessionId;
        g.__KRISTO_LIVEKIT_ACTIVE_TOKEN_CLAIMS__ = {
          identity: currentUserId,
          room: canonicalLiveSessionId,
        };
      }
    }
    if (!tokenOk) {
      throw new Error("token_not_ready");
    }
    console.log("KRISTO_SLOT_SOFT_REENTRY_TOKEN_READY", baseLog);
    adapters.onProgress?.("confirming_room");

    // Reconnect automatically (route stays open).
    adapters.remountAndReconnectLiveKit({
      transitionId,
      canonicalLiveSessionId,
      isIncoming,
    });
    const connected = await adapters.waitForRoomConnected(canonicalLiveSessionId, 12000);
    if (!connected) {
      throw new Error("room_not_connected");
    }
    console.log("KRISTO_SLOT_SOFT_REENTRY_ROOM_RECONNECTED", baseLog);

    // Publish / subscribe.
    let videoReady = false;
    if (isIncoming) {
      adapters.onProgress?.("preparing_mic");
      const pubRoom = readRoom();
      if (pubRoom && adapters.canPublishMicForIncoming && adapters.publishLocalMic) {
        await adapters.publishLocalMic(pubRoom).catch(() => false);
      }
      adapters.onProgress?.("preparing_camera");
      adapters.onProgress?.("publishing_video");
      if (pubRoom) {
        try {
          const camOk = await adapters.publishLocalCamera(pubRoom);
          videoReady = await waitFor(
            () => isLocalVideoTrackReady(pubRoom) || camOk === true,
            8000,
            100
          );
        } catch {}
      }
      console.log("KRISTO_SLOT_SOFT_REENTRY_INCOMING_PUBLISHED", {
        ...baseLog,
        videoReady,
      });
    } else {
      adapters.onProgress?.("preparing_mic");
      adapters.onProgress?.("preparing_camera");
      adapters.onProgress?.("publishing_video");
      videoReady = await waitFor(
        () => isRemoteVideoReady(readRoom(), activeOwnerUserId || incomingOwnerUserId),
        10000,
        100
      );
      console.log("KRISTO_SLOT_SOFT_REENTRY_INCOMING_PUBLISHED", {
        ...baseLog,
        videoReady,
        note: "remote_subscribed",
      });
    }

    try {
      await adapters.pushLiveAction("slot-transition-progress", {
        transitionId,
        phase: "entering_live",
        videoReady,
        avatarFallback: !videoReady,
        role: isIncoming ? "incoming" : "remote",
      });
    } catch {}

    adapters.onProgress?.("entering_live", { videoReady });
    completedByTransition.set(doneKey, "done");
    console.log("KRISTO_SLOT_SOFT_REENTRY_COMPLETED", {
      ...baseLog,
      videoReady,
      activeSlotId,
      activeOwnerUserId,
    });
    adapters.onCompleted({
      ...input,
      transitionId,
      canonicalLiveSessionId,
      incomingSlotId: activeSlotId || incomingSlotId,
      incomingOwnerUserId: activeOwnerUserId || incomingOwnerUserId,
      currentUserId,
      videoReady,
    });
    return { ok: true };
  } catch (error: any) {
    const reason = String(error?.message || error || "soft_reentry_failed");
    console.log("KRISTO_SLOT_SOFT_REENTRY_FAILED", {
      ...baseLog,
      reason,
    });
    adapters.onFailed({
      ...input,
      transitionId,
      canonicalLiveSessionId,
      incomingSlotId,
      incomingOwnerUserId,
      currentUserId,
      reason,
    });
    return { ok: false, reason };
  } finally {
    if (adapters.reentryInFlightRef.current === transitionId) {
      adapters.reentryInFlightRef.current = "";
    }
  }
}
