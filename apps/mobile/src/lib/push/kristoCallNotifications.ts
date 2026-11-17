import { NativeModules, Platform } from "react-native";

/**
 * Android call notifications (Notifee): the full-screen incoming call with Answer / Decline, and
 * the "call in progress" foreground service that keeps the microphone while the screen is off.
 * Every function is a no-op when the native module is missing (older dev clients, iOS).
 */

type NotifeeModule = typeof import("@notifee/react-native");

export const INCOMING_CALL_CHANNEL_ID = "kristo_call_incoming";
export const ONGOING_CALL_CHANNEL_ID = "kristo_call_ongoing";
export const MESSAGES_CHANNEL_ID = "kristo_messages";

export const CALL_ACTION_ANSWER = "answer";
export const CALL_ACTION_DECLINE = "decline";
export const CALL_ACTION_END = "end";

let notifeeModule: NotifeeModule | null | undefined;
let channelsReady: Promise<void> | null = null;

export function loadNotifee(): NotifeeModule | null {
  if (notifeeModule !== undefined) return notifeeModule;
  notifeeModule = null;
  if (Platform.OS === "android" && NativeModules.NotifeeApiModule) {
    try {
      notifeeModule = require("@notifee/react-native") as NotifeeModule;
    } catch (error: any) {
      console.log("KRISTO_PUSH_NOTIFEE_UNAVAILABLE", { message: String(error?.message || error) });
    }
  }
  return notifeeModule;
}

export function incomingCallNotificationId(callId: string) {
  return `kristo-call-${callId}`;
}

function ongoingCallNotificationId(callId: string) {
  return `kristo-call-ongoing-${callId}`;
}

export function ensureKristoNotificationChannels(): Promise<void> {
  const mod = loadNotifee();
  if (!mod) return Promise.resolve();
  if (!channelsReady) {
    const { default: notifee, AndroidImportance, AndroidVisibility } = mod;
    channelsReady = (async () => {
      await notifee.createChannel({
        id: INCOMING_CALL_CHANNEL_ID,
        name: "Incoming calls",
        importance: AndroidImportance.HIGH,
        visibility: AndroidVisibility.PUBLIC,
        sound: "default",
        vibration: true,
        bypassDnd: false,
      });
      await notifee.createChannel({
        id: ONGOING_CALL_CHANNEL_ID,
        name: "Calls in progress",
        importance: AndroidImportance.LOW,
        visibility: AndroidVisibility.PUBLIC,
        vibration: false,
      });
      await notifee.createChannel({
        id: MESSAGES_CHANNEL_ID,
        name: "Messages",
        importance: AndroidImportance.HIGH,
        visibility: AndroidVisibility.PRIVATE,
        sound: "default",
        vibration: true,
      });
    })().catch((error) => {
      channelsReady = null;
      console.log("KRISTO_PUSH_CHANNELS_FAILED", { message: String(error?.message || error) });
    });
  }
  return channelsReady;
}

export async function showIncomingCallNotification(input: {
  callId: string;
  title: string;
  ringExpiresAt?: string;
}) {
  const mod = loadNotifee();
  if (!mod || !input.callId) return;
  const { default: notifee, AndroidCategory, AndroidImportance, AndroidVisibility } = mod;
  await ensureKristoNotificationChannels();

  const expiresAt = Date.parse(String(input.ringExpiresAt || ""));
  const remainingMs = Number.isFinite(expiresAt) ? expiresAt - Date.now() : 45_000;
  if (remainingMs <= 1000) return;

  await notifee.displayNotification({
    id: incomingCallNotificationId(input.callId),
    title: input.title || "Incoming Kristo call",
    body: "Kristo private call",
    data: { kind: "private_call", callId: input.callId },
    android: {
      channelId: INCOMING_CALL_CHANNEL_ID,
      category: AndroidCategory.CALL,
      importance: AndroidImportance.HIGH,
      visibility: AndroidVisibility.PUBLIC,
      ongoing: true,
      autoCancel: false,
      loopSound: true,
      lightUpScreen: true,
      timeoutAfter: remainingMs,
      fullScreenAction: { id: "default" },
      pressAction: { id: "default", launchActivity: "default" },
      actions: [
        { title: "Decline", pressAction: { id: CALL_ACTION_DECLINE } },
        { title: "Answer", pressAction: { id: CALL_ACTION_ANSWER, launchActivity: "default" } },
      ],
    },
  });
  console.log("KRISTO_PUSH_INCOMING_CALL_SHOWN", { callId: input.callId, remainingMs });
}

export async function cancelIncomingCallNotification(callId: string) {
  const mod = loadNotifee();
  if (!mod || !callId) return;
  await mod.default.cancelNotification(incomingCallNotificationId(callId)).catch(() => {});
}

let foregroundServiceRegistered = false;
let ongoingCallId = "";

/** Must run at startup (index.js) so Android can start the service from a notification. */
export function registerCallForegroundService() {
  const mod = loadNotifee();
  if (!mod || foregroundServiceRegistered) return;
  foregroundServiceRegistered = true;
  // The service lives as long as this promise is pending; stopForegroundService() ends it.
  mod.default.registerForegroundService(() => new Promise<void>(() => {}));
}

export async function startCallForegroundService(input: { callId: string; peerName: string }) {
  const mod = loadNotifee();
  if (!mod || !input.callId || ongoingCallId === input.callId) return;
  const { default: notifee, AndroidCategory, AndroidForegroundServiceType, AndroidImportance } = mod;
  await ensureKristoNotificationChannels();
  ongoingCallId = input.callId;
  try {
    await notifee.displayNotification({
      id: ongoingCallNotificationId(input.callId),
      title: input.peerName || "Kristo call",
      body: "Call in progress",
      data: { kind: "private_call_ongoing", callId: input.callId },
      android: {
        channelId: ONGOING_CALL_CHANNEL_ID,
        category: AndroidCategory.CALL,
        importance: AndroidImportance.LOW,
        asForegroundService: true,
        foregroundServiceTypes: [AndroidForegroundServiceType.FOREGROUND_SERVICE_TYPE_MICROPHONE],
        ongoing: true,
        autoCancel: false,
        onlyAlertOnce: true,
        pressAction: { id: "default", launchActivity: "default" },
        actions: [{ title: "End call", pressAction: { id: CALL_ACTION_END } }],
      },
    });
    console.log("KRISTO_CALL_FOREGROUND_SERVICE_STARTED", { callId: input.callId });
  } catch (error: any) {
    ongoingCallId = "";
    console.log("KRISTO_CALL_FOREGROUND_SERVICE_FAILED", {
      callId: input.callId,
      message: String(error?.message || error),
    });
  }
}

export async function stopCallForegroundService(callId: string) {
  const mod = loadNotifee();
  if (!mod || !callId || ongoingCallId !== callId) return;
  ongoingCallId = "";
  await mod.default.stopForegroundService().catch(() => {});
  await mod.default.cancelNotification(ongoingCallNotificationId(callId)).catch(() => {});
  console.log("KRISTO_CALL_FOREGROUND_SERVICE_STOPPED", { callId });
}
