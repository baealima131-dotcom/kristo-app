import { useSyncExternalStore } from "react";
import { Platform } from "react-native";
// Type-only at module level: this store is loaded by the root layout, before the call screen
// registers the WebRTC globals that livekit-client needs at import time.
import type { Room } from "livekit-client";

import {
  endPrivateCall,
  fetchPrivateCallSession,
  isPrivateCallTerminalStatus,
} from "@/src/lib/privateCallService";

/**
 * The connected private call, kept alive while the viewer uses other screens.
 *
 * The call screen owns the LiveKit Room while it is open. When the screen closes without the
 * call ending (back, a tab, a notification…), the Room is "parked" here instead of being
 * disconnected: microphone and remote audio keep running, the call bar shows, and the call
 * screen adopts the same Room again when it reopens. A parked call ends when either side hangs
 * up (Room disconnect or the server session turning terminal).
 */
export type ActiveCallInfo = {
  callId: string;
  roomName: string;
  peerName: string;
  peerAvatar?: string;
  connectedAt: number;
  /** True while the call screen is closed and the Room lives here. */
  parked: boolean;
  /** The call bar shows whenever the call screen is not the screen in front. */
  showBar: boolean;
};

type ActiveCallState = Omit<ActiveCallInfo, "showBar"> & { room: Room | null; screenFocused: boolean };

const PARKED_SESSION_POLL_MS = 3000;

let active: ActiveCallState | null = null;
let snapshot: ActiveCallInfo | null = null;
let endingCallId = "";
let stopParkedMonitor: (() => void) | null = null;
const listeners = new Set<() => void>();

function emit() {
  snapshot = active
    ? {
        callId: active.callId,
        roomName: active.roomName,
        peerName: active.peerName,
        peerAvatar: active.peerAvatar,
        connectedAt: active.connectedAt,
        parked: active.parked,
        showBar: active.parked || !active.screenFocused,
      }
    : null;
  listeners.forEach((listener) => listener());
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function useActiveCall(): ActiveCallInfo | null {
  return useSyncExternalStore(subscribe, () => snapshot, () => snapshot);
}

/** A private call is connected (on screen or parked): other audio must not take the session. */
export function isPrivateCallAudioActive(): boolean {
  return Boolean(active);
}

export function getActiveCallConnectedAt(callId: string): number {
  return active && active.callId === callId ? active.connectedAt : 0;
}

/** The call screen connected its Room (or adopted a parked one). */
export function setActiveCallConnected(input: {
  callId: string;
  roomName: string;
  peerName: string;
  peerAvatar?: string;
}) {
  const callId = String(input.callId || "").trim();
  if (!callId) return;
  if (endingCallId === callId) endingCallId = "";
  const connectedAt = active && active.callId === callId ? active.connectedAt : Date.now();
  active = {
    callId,
    roomName: input.roomName,
    peerName: input.peerName || "Call",
    peerAvatar: input.peerAvatar,
    connectedAt,
    parked: false,
    room: null,
    screenFocused: true,
  };
  emit();
}

/**
 * The call screen gained or lost focus while staying mounted (e.g. another tab is in front).
 * The call keeps running; the bar offers the way back.
 */
export function setActiveCallScreenFocused(callId: string, focused: boolean) {
  if (!active || active.callId !== callId || active.screenFocused === focused) return;
  active = { ...active, screenFocused: focused };
  emit();
  if (!focused) void reassertPrivateCallAudio("screen-blurred");
}

/** The viewer (or the other side) is ending this call: closing its screen must disconnect. */
export function markActiveCallEnding(callId: string) {
  endingCallId = String(callId || "").trim();
}

export function clearActiveCall(callId: string, reason: string) {
  if (!active || active.callId !== callId) return;
  stopParkedMonitor?.();
  stopParkedMonitor = null;
  const room = active.room;
  active = null;
  console.log("KRISTO_ACTIVE_CALL_CLEARED", { callId, reason });
  emit();
  if (room && !["disconnected", "disconnecting"].includes(String((room as any)?.state || ""))) {
    void room.disconnect(true).catch(() => {});
  }
}

/**
 * Called by the call screen while it unmounts. Returns true when the Room was kept alive here
 * (the call is connected and nobody hung up), false when the screen should disconnect it.
 */
export function parkActiveCallRoom(callId: string, room: Room): boolean {
  if (!active || active.callId !== callId || endingCallId === callId) return false;
  if (String((room as any)?.state || "") !== "connected") return false;

  active = { ...active, room, parked: true, screenFocused: false };
  stopParkedMonitor?.();
  stopParkedMonitor = monitorParkedRoom(callId, room);
  console.log("KRISTO_ACTIVE_CALL_PARKED", { callId, roomName: active.roomName });
  emit();
  void reassertPrivateCallAudio("parked");
  return true;
}

/** The call screen reopened: hand back the parked Room (same call and room), if any. */
export function takeParkedCallRoom(callId: string, roomName: string): Room | null {
  if (!active || active.callId !== callId || !active.parked || !active.room) return null;
  if (active.roomName !== roomName) return null;
  const room = active.room;
  if (["disconnected", "disconnecting"].includes(String((room as any)?.state || ""))) return null;
  stopParkedMonitor?.();
  stopParkedMonitor = null;
  active = { ...active, room: null, parked: false, screenFocused: true };
  console.log("KRISTO_ACTIVE_CALL_UNPARKED", { callId, roomName });
  emit();
  return room;
}

/** Hang up from the call bar (the call screen is closed). */
export async function endActiveCall(source: string) {
  if (!active) return;
  const callId = active.callId;
  markActiveCallEnding(callId);
  console.log("KRISTO_ACTIVE_CALL_END_REQUESTED", { callId, source });
  try {
    await endPrivateCall(callId);
  } catch (error: any) {
    console.log("KRISTO_ACTIVE_CALL_END_ERROR", { callId, error: String(error?.message || error) });
  } finally {
    clearActiveCall(callId, `local-end:${source}`);
  }
}

/**
 * Put the call's audio session back (communication / play-and-record). Other media players
 * (videos, voice notes) can switch the session to playback-only, which silences the microphone.
 */
export async function reassertPrivateCallAudio(source: string) {
  if (!active) return;
  try {
    // Synchronous require: only reached during a call, after the call screen loaded LiveKit.
    const { AndroidAudioTypePresets, AudioSession } =
      require("@livekit/react-native") as typeof import("@livekit/react-native");
    if (Platform.OS === "ios") {
      await AudioSession.setAppleAudioConfiguration({
        audioCategory: "playAndRecord",
        audioCategoryOptions: ["allowBluetooth", "allowBluetoothA2DP", "allowAirPlay"],
        audioMode: "voiceChat",
      });
    } else {
      await AudioSession.configureAudio({
        android: { audioTypeOptions: AndroidAudioTypePresets.communication },
      });
    }
    await AudioSession.startAudioSession();
    console.log("KRISTO_ACTIVE_CALL_AUDIO_REASSERTED", { callId: active?.callId || "", source });
  } catch (error: any) {
    console.log("KRISTO_ACTIVE_CALL_AUDIO_REASSERT_ERROR", {
      source,
      error: String(error?.message || error),
    });
  }
}

function primeRemoteAudio(track: any, publication: any, participant: any) {
  if (participant?.isLocal) return;
  if (String(track?.kind || "").toLowerCase() !== "audio") return;
  try {
    publication?.setSubscribed?.(true);
    track?.setVolume?.(1);
    if (track?.mediaStreamTrack) track.mediaStreamTrack.enabled = true;
  } catch {}
}

/** While parked: keep remote audio playing and end the call when either side hangs up. */
function monitorParkedRoom(callId: string, room: Room) {
  // Only reached after a call connected, so the WebRTC globals are registered by now.
  const { RoomEvent } = require("livekit-client") as typeof import("livekit-client");
  let stopped = false;

  const verifySession = async (source: string) => {
    if (stopped) return;
    const session = await fetchPrivateCallSession(callId).catch(() => null);
    if (stopped) return;
    if (session && isPrivateCallTerminalStatus(session.status)) {
      clearActiveCall(callId, `remote-end:${source}:${session.status}`);
    }
  };

  const onDisconnected = () => clearActiveCall(callId, "room-disconnected");
  const onParticipantDisconnected = () => void verifySession("participant-disconnected");
  const onTrackSubscribed = (track: any, publication: any, participant: any) =>
    primeRemoteAudio(track, publication, participant);
  const onReconnected = () => {
    void room.localParticipant.setMicrophoneEnabled(true).catch(() => {});
    void reassertPrivateCallAudio("parked-reconnected");
  };

  room.on(RoomEvent.Disconnected, onDisconnected);
  room.on(RoomEvent.ParticipantDisconnected, onParticipantDisconnected);
  room.on(RoomEvent.TrackSubscribed, onTrackSubscribed);
  room.on(RoomEvent.Reconnected, onReconnected);
  const timer = setInterval(() => void verifySession("poll"), PARKED_SESSION_POLL_MS);

  return () => {
    stopped = true;
    clearInterval(timer);
    room.off(RoomEvent.Disconnected, onDisconnected);
    room.off(RoomEvent.ParticipantDisconnected, onParticipantDisconnected);
    room.off(RoomEvent.TrackSubscribed, onTrackSubscribed);
    room.off(RoomEvent.Reconnected, onReconnected);
  };
}
