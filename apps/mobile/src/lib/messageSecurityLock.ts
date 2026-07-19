import AsyncStorage from "@react-native-async-storage/async-storage";
import * as LocalAuthentication from "expo-local-authentication";
import * as SecureStore from "expo-secure-store";
import type { MessageLockTimeout } from "@/src/lib/messagePrivacySettingsTypes";
import { getKristoHeaders } from "@/src/lib/kristoHeaders";

function currentUserId(): string {
  const headers = getKristoHeaders() as Record<string, string>;
  return String(
    headers?.["x-kristo-user-id"] || headers?.["X-Kristo-User-Id"] || ""
  ).trim();
}

function unlockAtKey(userId: string) {
  return `kristo_messages_unlocked_at_v1_${userId}`;
}

function requireAuthCacheKey(userId: string) {
  return `kristo_messages_require_device_auth_v1_${userId}`;
}

function timeoutMs(timeout: MessageLockTimeout): number {
  switch (timeout) {
    case "1m":
      return 60_000;
    case "5m":
      return 5 * 60_000;
    case "15m":
      return 15 * 60_000;
    case "immediate":
    default:
      return 0;
  }
}

export async function cacheRequireDeviceAuthForUser(
  userId: string,
  required: boolean
): Promise<void> {
  const uid = String(userId || "").trim();
  if (!uid) return;
  await AsyncStorage.setItem(
    requireAuthCacheKey(uid),
    required ? "1" : "0"
  ).catch(() => null);
}

export async function readCachedRequireDeviceAuth(
  userId?: string
): Promise<boolean | null> {
  const uid = String(userId || currentUserId() || "").trim();
  if (!uid) return null;
  const raw = await AsyncStorage.getItem(requireAuthCacheKey(uid)).catch(
    () => null
  );
  if (raw === "1") return true;
  if (raw === "0") return false;
  return null;
}

export async function markMessagesUnlockedNow(
  userId?: string
): Promise<void> {
  const uid = String(userId || currentUserId() || "").trim();
  if (!uid) return;
  await SecureStore.setItemAsync(unlockAtKey(uid), String(Date.now()));
}

export async function clearMessagesUnlock(userId?: string): Promise<void> {
  const uid = String(userId || currentUserId() || "").trim();
  if (!uid) return;
  await SecureStore.deleteItemAsync(unlockAtKey(uid)).catch(() => null);
}

/** Clears unlock state for the previous account on switch/logout. */
export async function clearMessagesUnlockForUser(userId: string): Promise<void> {
  const uid = String(userId || "").trim();
  if (!uid) return;
  await SecureStore.deleteItemAsync(unlockAtKey(uid)).catch(() => null);
}

export async function isMessagesUnlockStillValid(
  timeout: MessageLockTimeout,
  userId?: string
): Promise<boolean> {
  const uid = String(userId || currentUserId() || "").trim();
  if (!uid) return false;
  const raw = await SecureStore.getItemAsync(unlockAtKey(uid)).catch(
    () => null
  );
  const unlockedAt = Number(raw || 0);
  if (!Number.isFinite(unlockedAt) || unlockedAt <= 0) return false;
  const windowMs = timeoutMs(timeout);
  if (windowMs <= 0) return false;
  return Date.now() - unlockedAt <= windowMs;
}

export async function authenticateForMessages(userId?: string): Promise<{
  ok: boolean;
  error?: string;
  noBiometrics?: boolean;
}> {
  const uid = String(userId || currentUserId() || "").trim();
  try {
    const hasHardware = await LocalAuthentication.hasHardwareAsync();
    const enrolled = await LocalAuthentication.isEnrolledAsync();

    if (!hasHardware || !enrolled) {
      // Still attempt device passcode fallback when the OS supports it.
      const result = await LocalAuthentication.authenticateAsync({
        promptMessage: "Unlock Messages",
        fallbackLabel: "Use passcode",
        disableDeviceFallback: false,
        cancelLabel: "Cancel",
      });
      if (result.success) {
        await markMessagesUnlockedNow(uid);
        return { ok: true };
      }
      return {
        ok: false,
        noBiometrics: true,
        error:
          "Face ID / biometrics are not available on this device. Add a device passcode or biometrics in system Settings, then try again. Messages stay locked while device authentication is enabled.",
      };
    }

    const result = await LocalAuthentication.authenticateAsync({
      promptMessage: "Unlock Messages",
      fallbackLabel: "Use passcode",
      disableDeviceFallback: false,
      cancelLabel: "Cancel",
    });

    if (result.success) {
      await markMessagesUnlockedNow(uid);
      return { ok: true };
    }

    return {
      ok: false,
      error: result.error || "Authentication failed.",
    };
  } catch (error: any) {
    return {
      ok: false,
      noBiometrics: true,
      error: String(
        error?.message ||
          "Device authentication is unavailable. Messages stay locked while this setting is enabled."
      ),
    };
  }
}
