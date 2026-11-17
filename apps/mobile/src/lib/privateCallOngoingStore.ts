import { useSyncExternalStore } from "react";
import type { Room } from "livekit-client";

import { setKristoCallKitMuted } from "@/src/lib/ios/kristoCallKit";
import { endPrivateCall } from "@/src/lib/privateCallService";

/**
 * App-wide state of the private call that is currently connected (accepted).
 *
 * The LiveKit room, audio, microphone, CallKit call and Android foreground service belong to
 * PrivateCallOngoingHost (mounted once in the tabs layout), not to the call screen. Leaving the
 * call screen (Back, another tab) therefore never disconnects the call; the call screen and the
 * "Simu inaendelea" bar are only views of this state.
 */
export type OngoingPrivateCall = {
  callId: string;
  roomName: string;
  serverUrl: string;
  token: string;
  peerUserId: string;
  currentUserId: string;
  peerName: string;
  peerAvatar?: string;
  returnTo?: string;
  /** Latency marks collected by the call screen (diagnostics only). */
  latencyMarks?: Record<string, number>;
};

/** Caller side: the "hapatikani kwa sasa" prompt playing after the call screen closed. */
export type PrivateCallUnavailablePrompt = {
  callId: string;
  peerName: string;
};

type OngoingPrivateCallState = {
  call: OngoingPrivateCall | null;
  room: Room | null;
  micEnabled: boolean;
  startedAt: number;
  /** Call id whose call screen is currently focused ("" = none). */
  focusedCallId: string;
  /** Last call that ended, so an open call screen can leave. */
  endedCallId: string;
  prompt: PrivateCallUnavailablePrompt | null;
};

let state: OngoingPrivateCallState = {
  call: null,
  room: null,
  micEnabled: true,
  startedAt: 0,
  focusedCallId: "",
  endedCallId: "",
  prompt: null,
};

const listeners = new Set<() => void>();

function setState(patch: Partial<OngoingPrivateCallState>) {
  state = { ...state, ...patch };
  listeners.forEach((listener) => listener());
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function getOngoingPrivateCallState() {
  return state;
}

export function useOngoingPrivateCallState() {
  return useSyncExternalStore(subscribe, getOngoingPrivateCallState, getOngoingPrivateCallState);
}

/** Hands an accepted call to the app-wide host. Idempotent for the same call id. */
export function startOngoingPrivateCall(call: OngoingPrivateCall) {
  if (state.call?.callId === call.callId) {
    setState({
      call: {
        ...state.call,
        peerName: call.peerName || state.call.peerName,
        peerAvatar: call.peerAvatar || state.call.peerAvatar,
        returnTo: call.returnTo || state.call.returnTo,
      },
    });
    return;
  }

  if (state.call) {
    // Only one call at a time: a new accepted call replaces (and ends) the previous one.
    void endOngoingPrivateCall("replaced-by-new-call", { notifyServer: true });
  }

  console.log("KRISTO_PRIVATE_CALL_ONGOING_STARTED", {
    callId: call.callId,
    roomName: call.roomName,
    ts: Date.now(),
  });
  setState({
    call,
    room: null,
    micEnabled: true,
    startedAt: Date.now(),
    endedCallId: "",
    prompt: state.prompt?.callId === call.callId ? null : state.prompt,
  });
}

export function setOngoingPrivateCallRoom(callId: string, room: Room | null) {
  if (state.call?.callId !== callId) return;
  if (state.room === room) return;
  setState({ room });
}

export function setOngoingPrivateCallMic(callId: string, enabled: boolean) {
  if (state.call?.callId !== callId || state.micEnabled === enabled) return;
  setState({ micEnabled: enabled });
}

export async function toggleOngoingPrivateCallMute() {
  const { room, call, micEnabled } = state;
  if (!room || !call) return;
  const next = !micEnabled;
  setState({ micEnabled: next });
  try {
    await room.localParticipant.setMicrophoneEnabled(next);
  } catch {
    if (state.call?.callId === call.callId) setState({ micEnabled });
    return;
  }
  setKristoCallKitMuted(call.callId, !next);
  console.log("KRISTO_PRIVATE_CALL_MUTE_TOGGLE", {
    callId: call.callId,
    currentUserId: call.currentUserId,
    muted: !next,
    micEnabled: next,
  });
}

export function setPrivateCallScreenFocused(callId: string, focused: boolean) {
  if (focused) {
    if (state.focusedCallId !== callId) setState({ focusedCallId: callId });
    return;
  }
  if (state.focusedCallId === callId) setState({ focusedCallId: "" });
}

/**
 * Ends the ongoing call and cleans its session up. Removing the call from the state unmounts
 * the host's engine, whose cleanup disconnects the LiveKit room, ends the CallKit call and
 * stops the Android foreground service. `notifyServer` sends the end request (local hang-up);
 * it is false when the other side / the server already ended the call.
 */
export async function endOngoingPrivateCall(
  reason: string,
  options: { notifyServer: boolean }
) {
  const call = state.call;
  if (!call) return;

  console.log("KRISTO_PRIVATE_CALL_ONGOING_ENDED", {
    callId: call.callId,
    reason,
    notifyServer: options.notifyServer,
    ts: Date.now(),
  });
  setState({
    call: null,
    room: null,
    micEnabled: true,
    startedAt: 0,
    endedCallId: call.callId,
  });

  if (options.notifyServer) {
    const res: any = await endPrivateCall(call.callId).catch(() => null);
    console.log("KRISTO_PRIVATE_CALL_SESSION_ENDED", {
      callId: call.callId,
      endedBy: call.currentUserId,
      ok: !!res?.ok,
      status: res?.data?.status || null,
      source: `ongoing-${reason}`,
    });
  }
}

export function startPrivateCallUnavailablePrompt(prompt: PrivateCallUnavailablePrompt) {
  console.log("KRISTO_PRIVATE_CALL_UNAVAILABLE_PROMPT_HANDOFF", { callId: prompt.callId });
  setState({ prompt });
}

export function stopPrivateCallUnavailablePrompt(callId: string, reason: string) {
  if (!state.prompt || state.prompt.callId !== callId) return;
  console.log("KRISTO_PRIVATE_CALL_UNAVAILABLE_PROMPT_FINISHED", { callId, reason });
  setState({ prompt: null });
}
