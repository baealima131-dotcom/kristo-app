import { Platform } from "react-native";
import { requireOptionalNativeModule } from "expo";

/*
 * Watch-only rotation control.
 *
 * The app stays portrait everywhere. While Watch is open the OS may rotate the
 * screen, but only through modes that honour the system rotation lock:
 * - Android: SCREEN_ORIENTATION_FULL_USER. expo-screen-orientation's
 *   OrientationLock.ALL maps to FULL_SENSOR, which ignores the lock.
 * - iOS: interface mask "all but upside down". UIKit only auto-rotates on device
 *   orientation changes, which stop while Control Center rotation lock is on.
 *
 * Calls are no-ops on binaries built without the native module.
 */

// android.content.pm.ActivityInfo constants
const ANDROID_SCREEN_ORIENTATION_PORTRAIT = 1;
const ANDROID_SCREEN_ORIENTATION_FULL_USER = 13;

type ScreenOrientationModule = typeof import("expo-screen-orientation");

let cachedModule: ScreenOrientationModule | null | undefined;

function getScreenOrientation(): ScreenOrientationModule | null {
  if (cachedModule !== undefined) return cachedModule;
  if (!requireOptionalNativeModule("ExpoScreenOrientation")) {
    console.log("KRISTO_WATCH_ORIENTATION_NATIVE_MISSING");
    cachedModule = null;
    return null;
  }
  cachedModule = require("expo-screen-orientation") as ScreenOrientationModule;
  return cachedModule;
}

export async function allowWatchRotation(): Promise<void> {
  const so = getScreenOrientation();
  if (!so) return;
  try {
    if (Platform.OS === "android") {
      await so.lockPlatformAsync({
        screenOrientationConstantAndroid: ANDROID_SCREEN_ORIENTATION_FULL_USER,
      });
    } else if (Platform.OS === "ios") {
      await so.lockPlatformAsync({
        screenOrientationArrayIOS: [
          so.Orientation.PORTRAIT_UP,
          so.Orientation.LANDSCAPE_LEFT,
          so.Orientation.LANDSCAPE_RIGHT,
        ],
      });
    }
  } catch (error: any) {
    console.log("KRISTO_WATCH_ORIENTATION_UNLOCK_FAILED", {
      error: String(error?.message || error || "unknown"),
    });
  }
}

export async function restoreAppPortrait(): Promise<void> {
  const so = getScreenOrientation();
  if (!so) return;
  try {
    if (Platform.OS === "android") {
      await so.lockPlatformAsync({
        screenOrientationConstantAndroid: ANDROID_SCREEN_ORIENTATION_PORTRAIT,
      });
    } else if (Platform.OS === "ios") {
      await so.lockAsync(so.OrientationLock.PORTRAIT_UP);
    }
  } catch (error: any) {
    console.log("KRISTO_WATCH_ORIENTATION_RESTORE_FAILED", {
      error: String(error?.message || error || "unknown"),
    });
  }
}

/**
 * Reads the current screen rotation from native. Window dimensions in JS lag a
 * real rotation slightly, so auto-fullscreen re-checks this right before entering.
 * Returns null when it cannot be determined.
 */
export async function isScreenLandscapeNow(): Promise<boolean | null> {
  const so = getScreenOrientation();
  if (!so) return null;
  try {
    const orientation = await so.getOrientationAsync();
    if (
      orientation === so.Orientation.LANDSCAPE_LEFT ||
      orientation === so.Orientation.LANDSCAPE_RIGHT
    ) {
      return true;
    }
    if (
      orientation === so.Orientation.PORTRAIT_UP ||
      orientation === so.Orientation.PORTRAIT_DOWN
    ) {
      return false;
    }
    return null;
  } catch {
    return null;
  }
}
