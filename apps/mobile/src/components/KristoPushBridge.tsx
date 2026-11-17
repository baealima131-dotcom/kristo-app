import { useEffect, useRef } from "react";
import { AppState } from "react-native";
import { usePathname } from "expo-router";

import { useKristoSession } from "@/src/lib/KristoSessionProvider";
import { startKristoVoipPush } from "@/src/lib/ios/kristoVoipPush";
import { loadNotifee } from "@/src/lib/push/kristoCallNotifications";
import { markPendingCallAnswer, openIncomingCallScreen } from "@/src/lib/push/kristoCallRouting";
import {
  consumePendingCallScreen,
  extractKristoPushData,
  handleCallNotificationEvent,
  handleKristoPushData,
  loadExpoNotifications,
  openDirectMessageFromPush,
  registerKristoPushDevice,
} from "@/src/lib/push/kristoPush";

/**
 * Foreground side of Kristo push: registers this device for the signed-in user, routes taps on
 * message and call notifications, and keeps a message notification quiet when its chat is open.
 */
export function KristoPushBridge() {
  const { session } = useKristoSession();
  const userId = String(session?.userId || "").trim();
  const pathname = usePathname();
  const pathnameRef = useRef(pathname);
  pathnameRef.current = pathname;
  const handledResponseIdsRef = useRef(new Set<string>());

  useEffect(() => {
    if (!userId) return;
    void registerKristoPushDevice();
    startKristoVoipPush();
  }, [userId]);

  useEffect(() => {
    const Notifications = loadExpoNotifications();
    const notifee = loadNotifee();
    const subscriptions: { remove: () => void }[] = [];

    if (Notifications) {
      Notifications.setNotificationHandler({
        handleNotification: async (notification) => {
          const data = extractKristoPushData(notification);
          const roomId = String(data?.roomId || "");
          const chatOpen =
            !!roomId &&
            (pathnameRef.current.includes(roomId) || pathnameRef.current.includes(encodeURIComponent(roomId)));
          // Call pushes are data-only and drawn by the app; a message for the open chat stays quiet.
          const show = data?.type === "direct_message" && !chatOpen;
          return { shouldShowBanner: show, shouldShowList: show, shouldPlaySound: show, shouldSetBadge: false };
        },
      });

      subscriptions.push(
        Notifications.addNotificationReceivedListener((notification) => {
          void handleKristoPushData(extractKristoPushData(notification), "foreground");
        })
      );

      const openResponse = (response: any) => {
        const id = String(response?.notification?.request?.identifier || "");
        if (id && handledResponseIdsRef.current.has(id)) return;
        if (id) handledResponseIdsRef.current.add(id);
        openDirectMessageFromPush(
          extractKristoPushData(response?.notification),
          response?.notification?.request?.content?.title || undefined
        );
      };
      subscriptions.push(Notifications.addNotificationResponseReceivedListener(openResponse));
      Notifications.getLastNotificationResponseAsync()
        .then((response) => response && openResponse(response))
        .catch(() => {});
    }

    if (notifee) {
      subscriptions.push({
        remove: notifee.default.onForegroundEvent((event) => {
          void handleCallNotificationEvent(event, false);
        }),
      });
      // The app was started (or brought back) by a call notification.
      notifee.default
        .getInitialNotification()
        .then((initial) => {
          const callId = String(initial?.notification?.data?.callId || "");
          if (!callId || initial?.notification?.data?.kind !== "private_call") return;
          if (initial?.pressAction?.id === "answer") markPendingCallAnswer(callId);
          openIncomingCallScreen(callId, "notification-launch");
        })
        .catch(() => {});
    }

    const openPendingCall = () => {
      const callId = consumePendingCallScreen();
      if (callId) openIncomingCallScreen(callId, "notification-resume");
    };
    openPendingCall();
    const appState = AppState.addEventListener("change", (next) => {
      if (next === "active") openPendingCall();
    });
    subscriptions.push(appState);

    return () => subscriptions.forEach((subscription) => subscription.remove());
  }, []);

  return null;
}
