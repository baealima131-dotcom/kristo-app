import { AppState, Platform } from "react-native";
import { requireOptionalNativeModule } from "expo-modules-core";
import { router } from "expo-router";

import { apiPost } from "@/src/lib/kristoApi";
import { getKristoHeaders } from "@/src/lib/kristoHeaders";
import { loadSession } from "@/src/lib/kristoSession";
import { getSessionSync } from "@/src/lib/kristoSessionSync";
import { declinePrivateCall, endPrivateCall } from "@/src/lib/privateCallService";
import {
  CALL_ACTION_ANSWER,
  CALL_ACTION_DECLINE,
  CALL_ACTION_END,
  cancelIncomingCallNotification,
  ensureKristoNotificationChannels,
  loadNotifee,
  showIncomingCallNotification,
  stopCallForegroundService,
} from "@/src/lib/push/kristoCallNotifications";
import { markPendingCallAnswer, openIncomingCallScreen } from "@/src/lib/push/kristoCallRouting";

/**
 * Kristo push on Android: FCM device registration (expo-notifications), incoming call / call
 * closed data messages, direct-message notification taps and the call notification buttons.
 * Without the native modules or a Firebase config every function quietly does nothing.
 */

type ExpoNotificationsModule = typeof import("expo-notifications");

export const KRISTO_PUSH_BACKGROUND_TASK = "kristo-push-background";

let notificationsModule: ExpoNotificationsModule | null | undefined;
let pendingCallScreenId = "";

export function loadExpoNotifications(): ExpoNotificationsModule | null {
  if (notificationsModule !== undefined) return notificationsModule;
  notificationsModule = null;
  // Android only for now: iOS push (APNs / CallKit) is not set up, so iOS never asks for permission.
  if (Platform.OS === "android" && requireOptionalNativeModule("ExpoPushTokenManager")) {
    try {
      notificationsModule = require("expo-notifications") as ExpoNotificationsModule;
    } catch (error: any) {
      console.log("KRISTO_PUSH_EXPO_NOTIFICATIONS_UNAVAILABLE", { message: String(error?.message || error) });
    }
  }
  return notificationsModule;
}

/** The FCM data map, wherever expo-notifications put it for this delivery path. */
export function extractKristoPushData(payload: any): Record<string, string> | null {
  const candidates = [
    payload?.request?.trigger?.remoteMessage?.data,
    payload?.request?.content?.data,
    payload?.notification?.request?.trigger?.remoteMessage?.data,
    payload?.notification?.data,
    payload?.data?.data,
    payload?.data,
    payload,
  ];
  for (const candidate of candidates) {
    let value = candidate;
    if (typeof value === "string") {
      try {
        value = JSON.parse(value);
      } catch {
        continue;
      }
    }
    if (value && typeof value === "object" && typeof value.type === "string") return value;
  }
  return null;
}

async function ensureSessionLoaded() {
  if (!getSessionSync()) await loadSession().catch(() => null);
  return getSessionSync();
}

/** Handles one Kristo data message (foreground listener or background task). */
export async function handleKristoPushData(data: Record<string, string> | null, source: string) {
  if (!data?.type) return;
  console.log("KRISTO_PUSH_RECEIVED", { type: data.type, callId: data.callId || "", source });

  if (data.type === "private_call_incoming" && data.callId) {
    if (AppState.currentState === "active") {
      openIncomingCallScreen(data.callId, `push-${source}`);
      return;
    }
    await showIncomingCallNotification({
      callId: data.callId,
      title: data.title || "Incoming Kristo call",
      ringExpiresAt: data.ringExpiresAt,
    });
    return;
  }

  if (data.type === "private_call_closed" && data.callId) {
    await cancelIncomingCallNotification(data.callId);
  }
}

/** Answer / Decline / End buttons and taps on the call notifications (Notifee events). */
export async function handleCallNotificationEvent(event: { type: number; detail: any }, inBackground: boolean) {
  const mod = loadNotifee();
  if (!mod) return;
  const { EventType } = mod;
  const data = event.detail?.notification?.data || {};
  const callId = String(data.callId || "");
  if (!callId) return;

  const pressed = event.type === EventType.PRESS || event.type === EventType.ACTION_PRESS;
  if (!pressed) return;
  const actionId = String(event.detail?.pressAction?.id || "default");
  console.log("KRISTO_PUSH_CALL_ACTION", { callId, actionId, kind: data.kind, inBackground });

  if (actionId === CALL_ACTION_DECLINE) {
    await cancelIncomingCallNotification(callId);
    if (await ensureSessionLoaded()) await declinePrivateCall(callId).catch(() => null);
    return;
  }
  if (actionId === CALL_ACTION_END) {
    if (await ensureSessionLoaded()) await endPrivateCall(callId).catch(() => null);
    await stopCallForegroundService(callId);
    return;
  }
  if (data.kind !== "private_call") return; // tapping the "call in progress" notification just opens the app
  if (actionId === CALL_ACTION_ANSWER) markPendingCallAnswer(callId);
  await cancelIncomingCallNotification(callId);
  // In the background the app is being opened by this press; KristoPushBridge routes on resume.
  if (!inBackground) openIncomingCallScreen(callId, `notification-${actionId}`);
  else pendingCallScreenId = callId;
}

export function consumePendingCallScreen() {
  const id = pendingCallScreenId;
  pendingCallScreenId = "";
  return id;
}

export function openDirectMessageFromPush(data: Record<string, string> | null, title?: string) {
  const roomId = String(data?.roomId || "");
  if (data?.type !== "direct_message" || !roomId) return false;
  const me = String(getSessionSync()?.userId || "");
  const participants = roomId.startsWith("dm:") ? roomId.slice(3).split("::") : [];
  const peerUserId = participants.find((id) => id && id !== me) || "";
  router.push({
    pathname: "/(tabs)/profile/messages/[id]",
    params: { id: roomId, title: title || "Messages", roomKind: "direct", peerUserId },
  } as any);
  return true;
}

let registeredToken = "";

/** Asks for notification permission and sends this device's FCM token to the backend. */
export async function registerKristoPushDevice() {
  const Notifications = loadExpoNotifications();
  if (!Notifications || !getSessionSync()?.sessionToken) return;
  await ensureKristoNotificationChannels();
  try {
    const permission = await Notifications.requestPermissionsAsync();
    if (!permission.granted) {
      console.log("KRISTO_PUSH_PERMISSION_DENIED");
      return;
    }
    const device = await Notifications.getDevicePushTokenAsync();
    const token = String(device?.data || "");
    if (!token || token === registeredToken) return;
    const res: any = await apiPost(
      "/api/push/devices",
      { token },
      { headers: { ...getKristoHeaders(), accept: "application/json", "content-type": "application/json" } }
    );
    if (res?.ok) registeredToken = token;
    console.log("KRISTO_PUSH_DEVICE_REGISTERED", { ok: !!res?.ok, tokenLength: token.length });
  } catch (error: any) {
    // Expected in builds without google-services.json.
    console.log("KRISTO_PUSH_REGISTER_SKIPPED", { message: String(error?.message || error) });
  }
}
