import AsyncStorage from "@react-native-async-storage/async-storage";
import type { MessageLockStatus } from "@/src/lib/messageLockTypes";
import { DEFAULT_MESSAGE_LOCK_STATUS } from "@/src/lib/messageLockTypes";

const UNLOCK_PREFIX = "kristo_message_lock_unlock_v1_";
const STATUS_CACHE_PREFIX = "kristo_message_lock_status_v1_";

/** In-memory unlock for timeout=0 (until background / clear). */
const memoryUnlocked = new Map<string, true>();

function unlockKey(userId: string) {
  return `${UNLOCK_PREFIX}${userId}`;
}

function statusKey(userId: string) {
  return `${STATUS_CACHE_PREFIX}${userId}`;
}

export async function cacheMessageLockStatus(
  userId: string,
  status: MessageLockStatus
): Promise<void> {
  const uid = String(userId || "").trim();
  if (!uid) return;
  try {
    // Never cache secrets — status is non-secret public fields only.
    const safe: MessageLockStatus = {
      enabled: Boolean(status.enabled),
      hasPin: Boolean(status.hasPin),
      pinLength: status.pinLength,
      timeoutSeconds: status.timeoutSeconds,
      locked: Boolean(status.locked),
      cooldownRemainingSec: Math.max(0, Number(status.cooldownRemainingSec || 0)),
      failedAttempts: Math.max(0, Number(status.failedAttempts || 0)),
    };
    await AsyncStorage.setItem(statusKey(uid), JSON.stringify(safe));
  } catch {
    // non-fatal
  }
}

export async function readCachedMessageLockStatus(
  userId: string
): Promise<MessageLockStatus | null> {
  const uid = String(userId || "").trim();
  if (!uid) return null;
  try {
    const raw = await AsyncStorage.getItem(statusKey(uid));
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    return {
      ...DEFAULT_MESSAGE_LOCK_STATUS,
      ...parsed,
    };
  } catch {
    return null;
  }
}

/**
 * Mark Messages unlocked for this user.
 * timeoutSeconds === 0 → memory-only (cleared on background).
 * timeoutSeconds > 0 → persist unlock-until timestamp.
 */
export async function markMessageLockUnlocked(args: {
  userId: string;
  timeoutSeconds: number;
}): Promise<void> {
  const uid = String(args.userId || "").trim();
  if (!uid) return;
  const timeout = Math.max(0, Math.floor(Number(args.timeoutSeconds) || 0));

  if (timeout === 0) {
    memoryUnlocked.set(uid, true);
    try {
      await AsyncStorage.removeItem(unlockKey(uid));
    } catch {
      // ignore
    }
    return;
  }

  memoryUnlocked.set(uid, true);
  const until = Date.now() + timeout * 1000;
  try {
    await AsyncStorage.setItem(
      unlockKey(uid),
      JSON.stringify({ until, updatedAt: Date.now() })
    );
  } catch {
    // ignore
  }
}

export async function isMessageLockLocallyUnlocked(
  userId: string,
  timeoutSeconds: number
): Promise<boolean> {
  const uid = String(userId || "").trim();
  if (!uid) return false;
  const timeout = Math.max(0, Math.floor(Number(timeoutSeconds) || 0));

  if (timeout === 0) {
    return memoryUnlocked.has(uid);
  }

  if (memoryUnlocked.has(uid)) {
    // Still honor persisted expiry
  }

  try {
    const raw = await AsyncStorage.getItem(unlockKey(uid));
    if (!raw) return memoryUnlocked.has(uid);
    const parsed = JSON.parse(raw);
    const until = Number(parsed?.until || 0);
    if (!until || Date.now() >= until) {
      memoryUnlocked.delete(uid);
      await AsyncStorage.removeItem(unlockKey(uid));
      return false;
    }
    return true;
  } catch {
    return memoryUnlocked.has(uid);
  }
}

export async function clearMessageLockUnlock(userId?: string): Promise<void> {
  const uid = String(userId || "").trim();
  if (uid) {
    memoryUnlocked.delete(uid);
    try {
      await AsyncStorage.removeItem(unlockKey(uid));
    } catch {
      // ignore
    }
    return;
  }

  memoryUnlocked.clear();
  try {
    const keys = await AsyncStorage.getAllKeys();
    const unlockKeys = keys.filter((k) => k.startsWith(UNLOCK_PREFIX));
    if (unlockKeys.length) await AsyncStorage.multiRemove(unlockKeys);
  } catch {
    // ignore
  }
}

/** Clear unlock + status cache for a user (logout / account switch / credential change). */
export async function clearMessageLockLocalState(userId?: string): Promise<void> {
  const uid = String(userId || "").trim();
  await clearMessageLockUnlock(uid || undefined);
  if (uid) {
    try {
      await AsyncStorage.removeItem(statusKey(uid));
    } catch {
      // ignore
    }
    return;
  }
  try {
    const keys = await AsyncStorage.getAllKeys();
    const statusKeys = keys.filter((k) => k.startsWith(STATUS_CACHE_PREFIX));
    if (statusKeys.length) await AsyncStorage.multiRemove(statusKeys);
  } catch {
    // ignore
  }
}

/** Call when app backgrounds — immediately mode drops memory unlock. */
export function onMessageLockAppBackground(userId: string, timeoutSeconds: number) {
  const uid = String(userId || "").trim();
  if (!uid) return;
  if (Math.max(0, Math.floor(Number(timeoutSeconds) || 0)) === 0) {
    memoryUnlocked.delete(uid);
  }
}
