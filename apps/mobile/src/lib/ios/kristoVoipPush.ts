import Constants from "expo-constants";
import { AppState, NativeModules, Platform } from "react-native";

import { apiPost } from "@/src/lib/kristoApi";
import { getKristoHeaders } from "@/src/lib/kristoHeaders";
import { loadSession } from "@/src/lib/kristoSession";
import { getSessionSync } from "@/src/lib/kristoSessionSync";
import { declinePrivateCall, fetchPrivateCallSession } from "@/src/lib/privateCallService";
import { markPendingCallAnswer, openIncomingCallScreen } from "@/src/lib/push/kristoCallRouting";
import {
  adoptKristoCallKitIncomingCall,
  endKristoCallKitCall,
  replayKristoCallKitInitialEvents,
} from "@/src/lib/ios/kristoCallKit";

/**
 * iOS incoming calls over VoIP push (PushKit), only in builds made with KRISTO_IOS_VOIP_PUSH=1
 * (plugins/withIosCalls). The native side reports each push to CallKit as an incoming call; this
 * links it to the Kristo call, routes Answer / Decline, closes the system call UI when the call
 * stops ringing (caller cancelled, timed out), and registers the VoIP token with the server.
 * With Kristo open, the in-app call screen takes over from the system incoming call (as on
 * Android), so the same call never shows twice.
 */

type VoipPush = typeof import("react-native-voip-push-notification").default;

const RING_STATUS_POLL_MS = 2000;
const RING_STATUS_WATCH_MAX_MS = 60_000;
// Coming back to Kristo: wait for an Answer / Decline pressed in the system UI to arrive first.
const RESUME_HANDOVER_DELAY_MS = 600;

let started = false;
let registeredToken = "";
let pendingToken = "";
/** Incoming calls in the system call UI that were not answered or ended there yet. */
const ringingInCallKit = new Set<string>();

export function isKristoVoipPushEnabled() {
  return (
    Platform.OS === "ios" &&
    Constants.expoConfig?.extra?.kristoIosVoipPush === true &&
    !!NativeModules.RNVoipPushNotificationManager
  );
}

async function ensureSessionLoaded() {
  if (!getSessionSync()) await loadSession().catch(() => null);
  return getSessionSync();
}

async function sendToken(token: string) {
  if (!token || token === registeredToken) return;
  if (!getSessionSync()?.sessionToken) {
    pendingToken = token;
    return;
  }
  const res: any = await apiPost(
    "/api/push/devices",
    { token, kind: "apns-voip" },
    { headers: { ...getKristoHeaders(), accept: "application/json", "content-type": "application/json" } }
  ).catch(() => null);
  if (res?.ok) {
    registeredToken = token;
    pendingToken = "";
  }
  console.log("KRISTO_VOIP_PUSH_TOKEN_REGISTERED", { ok: !!res?.ok, tokenLength: token.length });
}

/** While iOS shows the incoming call, follow the server: ringing over without an answer ends it. */
function watchRinging(callId: string) {
  const startedAt = Date.now();
  const timer = setInterval(async () => {
    if (Date.now() - startedAt > RING_STATUS_WATCH_MAX_MS) {
      clearInterval(timer);
      return;
    }
    if (!(await ensureSessionLoaded())) return;
    const session = await fetchPrivateCallSession(callId).catch(() => null);
    if (!session || session.status === "ringing") return;
    clearInterval(timer);
    ringingInCallKit.delete(callId);
    if (session.status !== "accepted") endKristoCallKitCall(callId);
  }, RING_STATUS_POLL_MS);
}

/** Closes the system incoming call (iOS had to show it for the VoIP push) and opens Kristo's. */
function handOverToCallScreen(callId: string, source: string) {
  if (!ringingInCallKit.delete(callId)) return;
  endKristoCallKitCall(callId);
  openIncomingCallScreen(callId, source);
}

function handleIncomingPush(payload: any) {
  const callId = String(payload?.callId || "").trim();
  const callUuid = String(payload?.callUuid || "").trim();
  if (!callId || !callUuid) return;
  console.log("KRISTO_VOIP_PUSH_RECEIVED", { callId, appState: AppState.currentState });
  ringingInCallKit.add(callId);
  void adoptKristoCallKitIncomingCall({
    callId,
    callUuid,
    onAnswer: () => {
      ringingInCallKit.delete(callId);
      markPendingCallAnswer(callId);
      openIncomingCallScreen(callId, "callkit-answer");
    },
    onEnd: () => {
      ringingInCallKit.delete(callId);
      void ensureSessionLoaded()
        .then((session) => (session ? declinePrivateCall(callId) : null))
        .catch(() => null);
    },
  }).then(() => {
    if (AppState.currentState === "active") handOverToCallScreen(callId, "voip-foreground");
  });
  watchRinging(callId);
}

/** Starts PushKit once (after sign-in); safe to call again to retry a token not yet sent. */
export function startKristoVoipPush() {
  if (!isKristoVoipPushEnabled()) return;
  if (started) {
    if (pendingToken) void sendToken(pendingToken);
    return;
  }
  started = true;
  const voip = require("react-native-voip-push-notification").default as VoipPush;
  voip.addEventListener("register", (token) => void sendToken(String(token || "")));
  voip.addEventListener("notification", (payload) => handleIncomingPush(payload));
  voip.addEventListener("didLoadWithEvents", (events) => {
    for (const event of events || []) {
      if (event.name === voip.RNVoipPushRemoteNotificationsRegisteredEvent) {
        void sendToken(String(event.data || ""));
      } else if (event.name === voip.RNVoipPushRemoteNotificationReceivedEvent) {
        handleIncomingPush(event.data);
      }
    }
    void replayKristoCallKitInitialEvents();
  });
  voip.registerVoipToken();
  AppState.addEventListener("change", (next) => {
    if (next !== "active" || !ringingInCallKit.size) return;
    setTimeout(() => {
      if (AppState.currentState !== "active") return;
      for (const callId of [...ringingInCallKit]) handOverToCallScreen(callId, "voip-resume");
    }, RESUME_HANDOVER_DELAY_MS);
  });
}
