import { requireOptionalNativeModule } from "expo-modules-core";

import { loadNotifee, registerCallForegroundService } from "@/src/lib/push/kristoCallNotifications";
import {
  KRISTO_PUSH_BACKGROUND_TASK,
  extractKristoPushData,
  handleCallNotificationEvent,
  handleKristoPushData,
  loadExpoNotifications,
} from "@/src/lib/push/kristoPush";

/**
 * Runs from index.js before the app mounts, so pushes and notification buttons are handled while
 * the app is in the background, the screen is locked, or Android started the app just for them.
 */
export function registerKristoPushBackgroundHandlers() {
  registerCallForegroundService();

  const notifee = loadNotifee();
  notifee?.default.onBackgroundEvent((event) => handleCallNotificationEvent(event, true));

  const Notifications = loadExpoNotifications();
  if (!Notifications || !requireOptionalNativeModule("ExpoTaskManager")) return;
  const TaskManager = require("expo-task-manager") as typeof import("expo-task-manager");

  TaskManager.defineTask(KRISTO_PUSH_BACKGROUND_TASK, async ({ data, error }) => {
    if (error) {
      console.log("KRISTO_PUSH_BACKGROUND_TASK_ERROR", { message: String(error.message || error) });
      return;
    }
    await handleKristoPushData(extractKristoPushData(data), "background-task");
  });
  Notifications.registerTaskAsync(KRISTO_PUSH_BACKGROUND_TASK).catch((taskError: any) =>
    console.log("KRISTO_PUSH_BACKGROUND_TASK_REGISTER_FAILED", { message: String(taskError?.message || taskError) })
  );
}
