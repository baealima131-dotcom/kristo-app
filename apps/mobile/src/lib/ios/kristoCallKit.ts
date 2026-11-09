import { NativeModules, Platform } from "react-native";

/**
 * iOS CallKit for Kristo private calls (react-native-callkeep). An answered call is reported to
 * CallKit, so iOS keeps it running with the screen locked or the app in the background, shows
 * it in the system call UI, and the system Mute / End buttons reach the call. Android keeps its
 * foreground service (kristoCallNotifications); every function here is a no-op off iOS or in a
 * binary without the native module.
 */

type CallKeep = typeof import("react-native-callkeep").default;

let callKeep: CallKeep | null | undefined;
let setupPromise: Promise<boolean> | null = null;

const uuidByCallId = new Map<string, string>();
const callIdByUuid = new Map<string, string>();
const muteHandlers = new Map<string, (muted: boolean) => void>();
const endHandlers = new Map<string, () => void>();
const answerHandlers = new Map<string, () => void>();

function loadCallKeep(): CallKeep | null {
  if (callKeep !== undefined) return callKeep;
  callKeep = null;
  if (Platform.OS !== "ios" || !NativeModules.RNCallKeep) return callKeep;
  try {
    callKeep = require("react-native-callkeep").default as CallKeep;
  } catch (error: any) {
    console.log("KRISTO_CALLKIT_UNAVAILABLE", { message: String(error?.message || error) });
  }
  return callKeep;
}

export function isKristoCallKitAvailable() {
  return loadCallKeep() !== null;
}

/** CallKit UUIDs come back lowercased from the native side. */
function normalizeUuid(uuid: string) {
  return String(uuid || "").trim().toLowerCase();
}

function newCallUuid() {
  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    return (c === "x" ? r : (r & 0x3) | 0x8).toString(16);
  });
}

function forgetCall(callId: string) {
  const uuid = uuidByCallId.get(callId);
  if (uuid) callIdByUuid.delete(uuid);
  uuidByCallId.delete(callId);
  muteHandlers.delete(callId);
  endHandlers.delete(callId);
  answerHandlers.delete(callId);
}

/** CallKit owns the audio session while a call is active; WebRTC must follow it. */
function audioSessionDidChange(active: boolean) {
  try {
    const { RTCAudioSession } = require("@livekit/react-native-webrtc");
    if (active) RTCAudioSession.audioSessionDidActivate();
    else RTCAudioSession.audioSessionDidDeactivate();
  } catch (error: any) {
    console.log("KRISTO_CALLKIT_AUDIO_SESSION_SYNC_FAILED", {
      active,
      message: String(error?.message || error),
    });
  }
}

function ensureCallKit(): Promise<boolean> {
  const mod = loadCallKeep();
  if (!mod) return Promise.resolve(false);
  if (setupPromise) return setupPromise;
  setupPromise = (async () => {
    try {
      await mod.setup({
        ios: {
          appName: "Kristo",
          supportsVideo: false,
          maximumCallGroups: "1",
          maximumCallsPerCallGroup: "1",
          includesCallsInRecents: false,
        },
        // Required by the type only; CallKit is never set up on Android.
        android: {
          alertTitle: "",
          alertDescription: "",
          cancelButton: "",
          okButton: "",
          additionalPermissions: [],
        },
      });
      mod.addEventListener("didActivateAudioSession", () => audioSessionDidChange(true));
      mod.addEventListener("didDeactivateAudioSession", () => audioSessionDidChange(false));
      mod.addEventListener("didReceiveStartCallAction", ({ callUUID }) => {
        // Our own startCall was performed: the call is already connected in LiveKit.
        const uuid = normalizeUuid(callUUID || "");
        if (uuid && callIdByUuid.has(uuid)) mod.reportConnectedOutgoingCallWithUUID(uuid);
      });
      mod.addEventListener("didPerformSetMutedCallAction", ({ muted, callUUID }) => {
        const callId = callIdByUuid.get(normalizeUuid(callUUID));
        if (!callId) return;
        console.log("KRISTO_CALLKIT_MUTE_ACTION", { callId, muted });
        muteHandlers.get(callId)?.(Boolean(muted));
      });
      mod.addEventListener("answerCall", ({ callUUID }) => {
        const callId = callIdByUuid.get(normalizeUuid(callUUID));
        if (!callId) return;
        console.log("KRISTO_CALLKIT_ANSWER_ACTION", { callId });
        answerHandlers.get(callId)?.();
      });
      mod.addEventListener("endCall", ({ callUUID }) => {
        const callId = callIdByUuid.get(normalizeUuid(callUUID));
        if (!callId) return;
        const onEnd = endHandlers.get(callId);
        forgetCall(callId);
        console.log("KRISTO_CALLKIT_END_ACTION", { callId });
        onEnd?.();
      });
      console.log("KRISTO_CALLKIT_READY");
      return true;
    } catch (error: any) {
      setupPromise = null;
      console.log("KRISTO_CALLKIT_SETUP_FAILED", { message: String(error?.message || error) });
      return false;
    }
  })();
  return setupPromise;
}

/**
 * Reports an answered call to CallKit (an outgoing CallKit call for both sides: it starts
 * already connected). The system End button calls onEnd.
 */
export async function startKristoCallKitCall(input: {
  callId: string;
  peerName: string;
  onEnd: () => void;
}) {
  const callId = String(input.callId || "").trim();
  const mod = loadCallKeep();
  if (!mod || !callId) return;
  endHandlers.set(callId, input.onEnd);
  if (uuidByCallId.has(callId)) return;
  if (!(await ensureCallKit())) return;
  const uuid = newCallUuid();
  uuidByCallId.set(callId, uuid);
  callIdByUuid.set(uuid, callId);
  const name = String(input.peerName || "").trim() || "Kristo call";
  mod.startCall(uuid, name, name, "generic", false);
  console.log("KRISTO_CALLKIT_CALL_STARTED", { callId });
}

/**
 * An incoming call that iOS already shows (reported natively from a VoIP push): links its UUID
 * to the Kristo call so Answer / Decline reach the app.
 */
export async function adoptKristoCallKitIncomingCall(input: {
  callId: string;
  callUuid: string;
  onAnswer: () => void;
  onEnd: () => void;
}) {
  const callId = String(input.callId || "").trim();
  const uuid = normalizeUuid(input.callUuid);
  if (!callId || !uuid || !(await ensureCallKit())) return;
  uuidByCallId.set(callId, uuid);
  callIdByUuid.set(uuid, callId);
  answerHandlers.set(callId, input.onAnswer);
  endHandlers.set(callId, input.onEnd);
}

/**
 * Answer / End pressed on an incoming call before JS was running (the app was woken by the VoIP
 * push): CallKit queued them natively; handle them once the calls are adopted.
 */
export async function replayKristoCallKitInitialEvents() {
  const mod = loadCallKeep();
  if (!mod || !(await ensureCallKit())) return;
  const events = await mod.getInitialEvents().catch(() => []);
  mod.clearInitialEvents();
  for (const event of events) {
    const callId = callIdByUuid.get(normalizeUuid((event.data as any)?.callUUID || ""));
    if (!callId) continue;
    if (event.name === "RNCallKeepPerformAnswerCallAction") {
      answerHandlers.get(callId)?.();
    } else if (event.name === "RNCallKeepPerformEndCallAction") {
      const onEnd = endHandlers.get(callId);
      forgetCall(callId);
      onEnd?.();
    }
  }
}

/** The call is over (ended here or by the other side): removes it from the system call UI. */
export function endKristoCallKitCall(callId: string) {
  const mod = loadCallKeep();
  const uuid = uuidByCallId.get(String(callId || "").trim());
  if (!mod || !uuid) return;
  forgetCall(callId);
  mod.reportEndCallWithUUID(uuid, 2);
  console.log("KRISTO_CALLKIT_CALL_ENDED", { callId });
}

/** Receives the system Mute button for this call. */
export function onKristoCallKitMute(callId: string, handler: (muted: boolean) => void) {
  muteHandlers.set(callId, handler);
  return () => {
    if (muteHandlers.get(callId) === handler) muteHandlers.delete(callId);
  };
}

/** Keeps the system call UI's Mute button in step with the in-app button / LiveKit track. */
export function setKristoCallKitMuted(callId: string, muted: boolean) {
  const mod = loadCallKeep();
  const uuid = uuidByCallId.get(String(callId || "").trim());
  if (!mod || !uuid) return;
  mod.setMutedCall(uuid, muted);
}
