/**
 * Deterministic slot-boundary media handoff for Big Screen.
 * Independent of React rerenders; uses refs + LiveKit room globals.
 */
import { extractUserIdFromLiveKitIdentity } from "@/src/lib/liveSlotParticipantRegistry";
import type { ClaimedSlotLike } from "@/src/lib/liveSlotPreflightCore";

export type SlotBoundaryResolved = {
  slotId: string;
  slotNumber: number;
  ownerUserId: string;
  ownerName: string;
  startMs: number;
  endMs: number;
};

type HandoffState = {
  activeSlotId: string;
  activeOwnerUserId: string;
  handoffInFlight: boolean;
  lastCompletedBoundary: string;
  lastIncomingSlotId: string;
};

function stateStore(): HandoffState {
  const g = globalThis as any;
  if (!g.__KRISTO_SLOT_BOUNDARY_HANDOFF_STATE__) {
    g.__KRISTO_SLOT_BOUNDARY_HANDOFF_STATE__ = {
      activeSlotId: "",
      activeOwnerUserId: "",
      handoffInFlight: false,
      lastCompletedBoundary: "",
      lastIncomingSlotId: "",
    } satisfies HandoffState;
  }
  return g.__KRISTO_SLOT_BOUNDARY_HANDOFF_STATE__;
}

function norm(value: unknown) {
  return String(value || "").trim();
}

function sleep(ms: number) {
  return new Promise<void>((resolve) => setTimeout(resolve, ms));
}

function readRoom() {
  const g = globalThis as any;
  return g.__KRISTO_LIVEKIT_CONNECTED_ROOM__ || g.__KRISTO_HELD_LIVEKIT_ROOM__ || null;
}

function boundaryKey(outgoingSlotId: string, incomingSlotId: string) {
  return `${norm(outgoingSlotId)}=>${norm(incomingSlotId)}`;
}

/** Active claimed slot for `nowMs` — schedule source of truth, not React hold state. */
export function resolveActiveClaimedSlotForHandoff(
  slots: ClaimedSlotLike[] | null | undefined,
  nowMs: number
): SlotBoundaryResolved | null {
  const now = Number(nowMs) || Date.now();
  const active = (Array.isArray(slots) ? slots : [])
    .map((slot, index) => {
      const ownerUserId = norm(
        slot?.claimedByUserId || slot?.claimedBy?.userId
      );
      const ownerName = norm(
        slot?.claimedByName || slot?.claimedBy?.name || slot?.name
      );
      if (!ownerUserId && !ownerName) return null;
      const startMs = Number(slot?.startMs || 0);
      const endMs = Number(slot?.endMs || 0);
      if (
        !(
          Number.isFinite(startMs) &&
          Number.isFinite(endMs) &&
          endMs > startMs &&
          startMs > 0 &&
          now >= startMs &&
          now < endMs
        )
      ) {
        return null;
      }
      const slotNumber = Math.max(
        1,
        Math.floor(
          Number(slot?.slot ?? slot?.slotNumber ?? index + 1) || index + 1
        )
      );
      const slotId =
        norm(slot?.id || slot?.slotId) ||
        `slot_${slotNumber}_${ownerUserId || ownerName}`;
      return {
        slotId,
        slotNumber,
        ownerUserId,
        ownerName: ownerName || "Speaker",
        startMs,
        endMs,
      } satisfies SlotBoundaryResolved;
    })
    .filter(Boolean) as SlotBoundaryResolved[];

  if (!active.length) return null;
  active.sort((a, b) => b.startMs - a.startMs || a.slotNumber - b.slotNumber);
  return active[0] || null;
}

export function readSlotBoundaryHandoffState(): HandoffState {
  return { ...stateStore() };
}

export function resetSlotBoundaryHandoffState() {
  const s = stateStore();
  s.activeSlotId = "";
  s.activeOwnerUserId = "";
  s.handoffInFlight = false;
  s.lastCompletedBoundary = "";
  s.lastIncomingSlotId = "";
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

function findRemoteParticipant(room: any, ownerUserId: string) {
  const uid = norm(ownerUserId);
  if (!uid || !room) return null;
  try {
    const remotes = Array.from(
      (room as any)?.remoteParticipants?.values?.() || []
    ) as any[];
    return (
      remotes.find(
        (entry) =>
          extractUserIdFromLiveKitIdentity(String(entry?.identity || "")) ===
          uid
      ) || null
    );
  } catch {
    return null;
  }
}

function isRemoteVideoReady(room: any, ownerUserId: string): boolean {
  const participant = findRemoteParticipant(room, ownerUserId);
  if (!participant) return false;
  try {
    const pubs = Array.from(
      participant?.trackPublications?.values?.() || []
    ) as any[];
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

async function waitFor(
  predicate: () => boolean,
  timeoutMs: number,
  intervalMs = 100
): Promise<boolean> {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    if (predicate()) return true;
    await sleep(intervalMs);
  }
  return predicate();
}

export type SlotBoundaryHandoffAdapters = {
  liveBridgeId: string;
  currentUserId: string;
  suppressLocalCamera: (room: any, reason: string) => Promise<boolean>;
  suppressLocalMic: (room: any, reason: string) => Promise<boolean>;
  publishLocalCamera: (room: any) => Promise<boolean>;
  publishLocalMic?: (room: any) => Promise<boolean>;
  resetLocalVideoReady: () => void;
  bumpLiveNowMs: (at: number) => void;
  onHandoffCompleted?: (incoming: SlotBoundaryResolved) => void;
  incomingTrackTimeoutMs?: number;
};

/**
 * Full media handoff at a slot boundary. Guarded against duplicate execution.
 */
export async function performSlotBoundaryHandoff(args: {
  outgoingSlotId: string;
  outgoingOwnerUserId: string;
  incomingSlot: SlotBoundaryResolved;
  adapters: SlotBoundaryHandoffAdapters;
  canControlMicForOutgoing: boolean;
  canPublishMicForIncoming: boolean;
}): Promise<{ ok: boolean; error?: string; skipped?: boolean }> {
  const state = stateStore();
  const incoming = args.incomingSlot;
  const incomingSlotId = norm(incoming.slotId);
  const outgoingSlotId = norm(args.outgoingSlotId);
  const key = boundaryKey(outgoingSlotId, incomingSlotId);
  const currentUserId = norm(args.adapters.currentUserId);
  const liveBridgeId = norm(args.adapters.liveBridgeId);
  const timeoutMs = Math.max(
    2000,
    Number(args.adapters.incomingTrackTimeoutMs || 8000) || 8000
  );

  if (!incomingSlotId) {
    return { ok: false, error: "missing_incoming_slot" };
  }
  if (state.handoffInFlight) {
    return { ok: false, skipped: true, error: "handoff_in_flight" };
  }
  if (state.lastCompletedBoundary === key) {
    return { ok: true, skipped: true };
  }
  if (
    state.lastIncomingSlotId === incomingSlotId &&
    state.activeSlotId === incomingSlotId
  ) {
    return { ok: true, skipped: true };
  }

  state.handoffInFlight = true;

  const frozenIncoming: SlotBoundaryResolved = { ...incoming };
  const at = Date.now();

  console.log("KRISTO_SLOT_BOUNDARY_DETECTED", {
    liveBridgeId,
    outgoingSlotId,
    outgoingOwnerUserId: norm(args.outgoingOwnerUserId),
    incomingSlotId: frozenIncoming.slotId,
    incomingOwnerUserId: frozenIncoming.ownerUserId,
    incomingSlotNumber: frozenIncoming.slotNumber,
    at,
  });

  try {
    // Drive schedule clock immediately so authority/UI catch the new window.
    args.adapters.bumpLiveNowMs(at);

    const room = readRoom();
    const outgoingIsLocal =
      Boolean(currentUserId) &&
      norm(args.outgoingOwnerUserId) === currentUserId;
    const incomingIsLocal =
      Boolean(currentUserId) &&
      norm(frozenIncoming.ownerUserId) === currentUserId;

    // 1) Outgoing unpublish (local only — remote leaves when their authority ends).
    if (outgoingIsLocal && room) {
      console.log("KRISTO_SLOT_OUTGOING_UNPUBLISH_START", {
        liveBridgeId,
        outgoingSlotId,
        ownerUserId: currentUserId,
        includeMic: args.canControlMicForOutgoing,
      });
      await args.adapters.suppressLocalCamera(
        room,
        "slot-boundary-handoff-out"
      );
      if (args.canControlMicForOutgoing) {
        await args.adapters.suppressLocalMic(
          room,
          "slot-boundary-handoff-out"
        );
      }
      args.adapters.resetLocalVideoReady();
      console.log("KRISTO_SLOT_OUTGOING_UNPUBLISH_DONE", {
        liveBridgeId,
        outgoingSlotId,
        ownerUserId: currentUserId,
      });
    } else if (!incomingIsLocal && room) {
      // Safety: if this device still has camera pubs but is not the incoming owner, clear them.
      const localPubs = isLocalVideoTrackReady(room);
      if (localPubs && norm(args.outgoingOwnerUserId) !== currentUserId) {
        // no-op — local is viewer; don't strip unrelated state
      } else if (
        localPubs &&
        norm(args.outgoingOwnerUserId) === currentUserId
      ) {
        await args.adapters.suppressLocalCamera(
          room,
          "slot-boundary-handoff-out"
        );
        args.adapters.resetLocalVideoReady();
      }
    }

    // Clear outgoing ownership markers before promoting incoming.
    try {
      const g = globalThis as any;
      g.__KRISTO_SLOT_HANDOFF_BIG_SCREEN_OWNER__ = "";
      g.__KRISTO_ACTIVE_CAMERA_PUBLISHER_KEY__ = "";
    } catch {}

    // 2) Incoming publish / wait for track
    console.log("KRISTO_SLOT_INCOMING_PUBLISH_START", {
      liveBridgeId,
      incomingSlotId: frozenIncoming.slotId,
      ownerUserId: frozenIncoming.ownerUserId,
      incomingIsLocal,
    });

    let trackReady = false;
    let publishError = "";

    if (incomingIsLocal) {
      const publishRoom = readRoom() || room;
      if (!publishRoom) {
        publishError = "no_livekit_room";
      } else {
        try {
          const camOk = await args.adapters.publishLocalCamera(publishRoom);
          if (args.canPublishMicForIncoming && args.adapters.publishLocalMic) {
            await args.adapters.publishLocalMic(publishRoom).catch(() => false);
          }
          trackReady = await waitFor(
            () => isLocalVideoTrackReady(publishRoom) || camOk === true,
            timeoutMs,
            100
          );
          if (!trackReady && camOk) {
            // Publish API succeeded; give MST a brief moment then accept.
            await sleep(250);
            trackReady = isLocalVideoTrackReady(publishRoom) || camOk;
          }
        } catch (error) {
          publishError = String((error as any)?.message || error);
        }
      }
    } else {
      trackReady = await waitFor(
        () => isRemoteVideoReady(readRoom() || room, frozenIncoming.ownerUserId),
        timeoutMs,
        100
      );
      if (!trackReady) {
        publishError = "incoming_remote_track_timeout";
      }
    }

    if (trackReady) {
      console.log("KRISTO_SLOT_INCOMING_TRACK_READY", {
        liveBridgeId,
        incomingSlotId: frozenIncoming.slotId,
        ownerUserId: frozenIncoming.ownerUserId,
        incomingIsLocal,
      });
    }

    // 3) Promote Big Screen ownership to frozen incoming owner (even on track fail,
    //    so the old publisher does not remain incorrectly on screen).
    try {
      const g = globalThis as any;
      g.__KRISTO_SLOT_HANDOFF_BIG_SCREEN_OWNER__ = frozenIncoming.ownerUserId;
      g.__KRISTO_SLOT_HANDOFF_BIG_SCREEN_SLOT_ID__ = frozenIncoming.slotId;
      g.__KRISTO_SLOT_HANDOFF_BIG_SCREEN_SLOT_NUMBER__ =
        frozenIncoming.slotNumber;
    } catch {}

    state.activeSlotId = frozenIncoming.slotId;
    state.activeOwnerUserId = frozenIncoming.ownerUserId;
    state.lastIncomingSlotId = frozenIncoming.slotId;
    state.lastCompletedBoundary = key;
    args.adapters.bumpLiveNowMs(Date.now());

    // Promotion + next-slot preflight (N+2) are driven by the adapter callback
    // so live-room can reuse noteLiveSlotPromotedToBigScreen / syncLiveSlotPreflight.
    args.adapters.onHandoffCompleted?.(frozenIncoming);

    if (!trackReady) {
      console.log("KRISTO_SLOT_HANDOFF_FAILED", {
        liveBridgeId,
        incomingSlotId: frozenIncoming.slotId,
        ownerUserId: frozenIncoming.ownerUserId,
        error: publishError || "incoming_track_not_ready",
        fallback: "clear_outgoing_keep_placeholder",
      });
      return {
        ok: false,
        error: publishError || "incoming_track_not_ready",
      };
    }

    console.log("KRISTO_SLOT_HANDOFF_COMPLETED", {
      liveBridgeId,
      outgoingSlotId,
      incomingSlotId: frozenIncoming.slotId,
      incomingOwnerUserId: frozenIncoming.ownerUserId,
      incomingSlotNumber: frozenIncoming.slotNumber,
    });

    return { ok: true };
  } catch (error) {
    const message = String((error as any)?.message || error || "handoff_failed");
    console.log("KRISTO_SLOT_HANDOFF_FAILED", {
      liveBridgeId,
      incomingSlotId,
      error: message,
    });
    return { ok: false, error: message };
  } finally {
    state.handoffInFlight = false;
  }
}

/**
 * Polling tick for the boundary watcher. Call every ~250ms while live.
 */
export function tickSlotBoundaryWatcher(args: {
  slots: ClaimedSlotLike[] | null | undefined;
  adapters: SlotBoundaryHandoffAdapters;
  canControlMicForOutgoing: (ownerUserId: string) => boolean;
  canPublishMicForIncoming: (ownerUserId: string) => boolean;
}): void {
  const now = Date.now();
  const resolved = resolveActiveClaimedSlotForHandoff(args.slots, now);
  if (!resolved?.slotId) return;

  const state = stateStore();
  if (
    state.activeSlotId &&
    resolved.slotId === state.activeSlotId &&
    resolved.ownerUserId === state.activeOwnerUserId
  ) {
    return;
  }

  // First observation — seed without media surgery.
  if (!state.activeSlotId) {
    state.activeSlotId = resolved.slotId;
    state.activeOwnerUserId = resolved.ownerUserId;
    args.adapters.bumpLiveNowMs(now);
    return;
  }

  if (state.handoffInFlight) return;

  const outgoingSlotId = state.activeSlotId;
  const outgoingOwnerUserId = state.activeOwnerUserId;

  void performSlotBoundaryHandoff({
    outgoingSlotId,
    outgoingOwnerUserId,
    incomingSlot: resolved,
    adapters: args.adapters,
    canControlMicForOutgoing: args.canControlMicForOutgoing(
      outgoingOwnerUserId
    ),
    canPublishMicForIncoming: args.canPublishMicForIncoming(
      resolved.ownerUserId
    ),
  });
}
