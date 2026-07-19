import AsyncStorage from "@react-native-async-storage/async-storage";
import { clearChurchDraft, clearChurchProfileCache } from "./churchStore";
import { clearChurchMembersCachesForUser } from "./churchTabCache";
import { clearChurchMediaProfileCache } from "./churchMediaProfileStore";
import { clearProfileDraft } from "./profileStore";
import { clearResponseCacheForRequest } from "./kristoTraffic";
import { getSessionSync, setSessionSync } from "./kristoSessionSync";

export type {
  KristoMediaCategory,
  KristoMediaProfile,
  KristoRole,
  KristoSession,
} from "./kristoSessionTypes";
export { getSessionSync, setSessionSync } from "./kristoSessionSync";

import type { KristoMediaCategory, KristoRole, KristoSession } from "./kristoSessionTypes";
import { normalizePlatformRole } from "./platformRole";

const KEY = "kristo.session.v1";
export const LOGGED_OUT_KEY = "KRISTO_LOGGED_OUT";
export const MOBILE_SESSION_IDLE_MS = 7 * 24 * 60 * 60 * 1000; // 7 days inactivity
export const MOBILE_SESSION_MAX_MS = 30 * 24 * 60 * 60 * 1000; // 30 days hard expiry

export async function isLoggedOutFlagSet(): Promise<boolean> {
  try {
    return (await AsyncStorage.getItem(LOGGED_OUT_KEY)) === "true";
  } catch {
    return false;
  }
}

export async function setLoggedOutFlag(enabled: boolean): Promise<void> {
  try {
    if (enabled) {
      await AsyncStorage.setItem(LOGGED_OUT_KEY, "true");
    } else {
      await AsyncStorage.removeItem(LOGGED_OUT_KEY);
    }
  } catch {}
}

export async function clearLoggedOutFlag(): Promise<void> {
  const wasSet = await isLoggedOutFlagSet();
  await setLoggedOutFlag(false);
  if (wasSet) {
    console.log("KRISTO_LOGIN_CLEAR_LOGOUT_FLAG");
  }
}

export async function loadSession(): Promise<KristoSession | null> {
  try {
    if (await isLoggedOutFlagSet()) {
      console.log("KRISTO_SESSION_RESTORE_BLOCKED_BY_LOGOUT");
      setSessionSync(null);
      try {
        await AsyncStorage.removeItem(KEY);
      } catch {}
      return null;
    }

    const raw = await AsyncStorage.getItem(KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object") return null;

    const userId = String(parsed.userId || "");
    const role = String(parsed.role || "Member") as KristoRole;
    const churchId = String(parsed.churchId || "");
    const mediaProfile =
      parsed.mediaProfile && typeof parsed.mediaProfile === "object"
        ? {
            mediaName: String(parsed.mediaProfile.mediaName || ""),
            category: String(parsed.mediaProfile.category || "Teacher") as KristoMediaCategory,
            subCategory: String(parsed.mediaProfile.subCategory || ""),
            language: String(parsed.mediaProfile.language || ""),
            country: String(parsed.mediaProfile.country || ""),
            targetAudience: String(parsed.mediaProfile.targetAudience || ""),
            contentStyle: String(parsed.mediaProfile.contentStyle || ""),
            bio: String(parsed.mediaProfile.bio || ""),
            tags: Array.isArray(parsed.mediaProfile.tags)
              ? parsed.mediaProfile.tags.map((x: unknown) => String(x || "").trim()).filter(Boolean)
              : [],
          }
        : null;

    if (!userId) return null;

    const now = Date.now();
    const lastSeenAt = Number(parsed.lastSeenAt || parsed.createdAt || now);
    const expiresAt = Number(parsed.expiresAt || (lastSeenAt + MOBILE_SESSION_MAX_MS));

    if (now - lastSeenAt > MOBILE_SESSION_IDLE_MS || now > expiresAt) {
      await clearSession();
      return null;
    }

    const loadedSessionToken = String(parsed.sessionToken || "").trim();
    console.log("KRISTO_SESSION_LOAD_TOKEN", {
      hasSessionToken: Boolean(loadedSessionToken),
    });

    const s: KristoSession = {
      userId,
      sessionToken: loadedSessionToken,
      kristoId: String(parsed.kristoId || parsed.publicKristoId || parsed.secureId || ""),
      role,
      churchId,
      name: String(parsed.name || ""),
      displayName: String(parsed.displayName || parsed.name || ""),
      gender: String(parsed.gender || ""),
      phone: String(parsed.phone || ""),
      email: String(parsed.email || ""),
      avatarUri: String(parsed.avatarUri || parsed.avatarUrl || parsed.profileImage || ""),
      avatarUrl: String(parsed.avatarUrl || parsed.avatarUri || parsed.profileImage || ""),
      profileImage: String(parsed.profileImage || parsed.avatarUrl || parsed.avatarUri || ""),
      address: String(parsed.address || ""),
      city: String(parsed.city || ""),
      country: String(parsed.country || ""),

      churchPhone: String(parsed.churchPhone || ""),
      churchCountry: String(parsed.churchCountry || ""),
      churchProvince: String(parsed.churchProvince || ""),
      churchCity: String(parsed.churchCity || ""),
      churchPrimaryLanguage: String(parsed.churchPrimaryLanguage || parsed.primaryLanguage || ""),
      churchName: String(parsed.churchName || ""),
      churchRole: String(parsed.churchRole || parsed.role || "Member") as KristoRole,
      platformRole: normalizePlatformRole(parsed.platformRole || parsed.offlineActivationRole) || null,
      offlineActivationRole:
        normalizePlatformRole(parsed.offlineActivationRole || parsed.platformRole) || null,

      mediaProfile,
      createdAt: Number(parsed.createdAt || now),
      lastSeenAt,
      expiresAt,
    };
    
    console.log("KRISTO_CURRENT_SESSION_FOR_CLEANUP", {
      userId: s.userId,
      role: s.role,
      churchId: s.churchId,
      activeChurchId: s.activeChurchId,
      churchRole: s.churchRole,
    });
    
    setSessionSync(s);
    return s;
  } catch {
    return null;
  }
}

export async function saveSession(s: KristoSession): Promise<void> {
  const userId = String(s?.userId || "").trim();
  if (!userId) return;

  // Login/session save must clear the intentional logout guard first.
  // Otherwise the old KRISTO_LOGGED_OUT flag blocks every fresh login restore.
  await clearLoggedOutFlag();

  const now = Date.now();
  const existing = getSessionSync();
  const sessionToken =
    String(s.sessionToken || "").trim() ||
    (existing?.userId === userId ? String(existing.sessionToken || "").trim() : "");

  const nextChurchId = String(s.churchId || "").trim();
  const prevChurchId = String(existing?.churchId || "").trim();
  const prevUserId = String(existing?.userId || "").trim();
  let sessionPayload = s;
  if (
    (prevChurchId && nextChurchId && prevChurchId !== nextChurchId) ||
    (prevUserId && prevUserId !== userId)
  ) {
    sessionPayload = { ...s, mediaProfile: null };
    console.log("KRISTO_SESSION_MEDIA_PROFILE_CLEARED", {
      reason: prevUserId && prevUserId !== userId ? "user_switch" : "church_switch",
      previousChurchId: prevChurchId || null,
      nextChurchId: nextChurchId || null,
      previousUserId: prevUserId || null,
      nextUserId: userId,
    });
  }
  if (prevUserId && prevUserId !== userId) {
    try {
      const { clearMessageLockLocalState } = await import(
        "@/src/lib/messageLockSession"
      );
      await clearMessageLockLocalState(prevUserId);
    } catch {
      // non-fatal
    }
  }

  console.log("KRISTO_SESSION_SAVE_TOKEN", {
    hasSessionToken: Boolean(sessionToken),
  });

  const next: KristoSession = {
    ...sessionPayload,
    ...(sessionToken ? { sessionToken } : {}),
    createdAt: Number(s.createdAt || now),
    lastSeenAt: now,
    expiresAt: Number(s.expiresAt || (now + MOBILE_SESSION_MAX_MS)),
  };

  setSessionSync(next);
  try {
    await AsyncStorage.setItem(KEY, JSON.stringify(next));
  } catch {}
}

export async function touchMobileSession(): Promise<KristoSession | null> {
  if (await isLoggedOutFlagSet()) return null;
  const current = getSessionSync() || (await loadSession());
  if (!current) return null;

  const next: KristoSession = {
    ...current,
    lastSeenAt: Date.now(),
  };

  await saveSession(next);
  return next;
}

export async function clearSession(): Promise<void> {
  const prevUserId = String(getSessionSync()?.userId || "").trim();
  setSessionSync(null);
  try {
    await AsyncStorage.removeItem(KEY);
  } catch {}
  try {
    const { clearMessageLockLocalState } = await import(
      "@/src/lib/messageLockSession"
    );
    await clearMessageLockLocalState(prevUserId || undefined);
  } catch {
    // non-fatal
  }
}

export type LogoutCleanupParams = {
  userId?: string;
  churchId?: string;
  reason?: "logout" | "delete";
};

export async function performLogoutCleanup(params: LogoutCleanupParams = {}): Promise<void> {
  const userId = String(params.userId || "").trim();
  const churchId = String(params.churchId || "").trim();
  const reason = params.reason === "delete" ? "delete" : "logout";

  console.log("KRISTO_LOGOUT_CLEAR_START", {
    userId: userId || null,
    churchId: churchId || null,
    reason,
  });

  await setLoggedOutFlag(true);
  setSessionSync(null);

  try {
    await AsyncStorage.removeItem(KEY);
  } catch {}

  try {
    const { clearMessageLockLocalState } = await import(
      "@/src/lib/messageLockSession"
    );
    await clearMessageLockLocalState(userId || undefined);
  } catch {
    // non-fatal
  }

  try {
    if (userId) {
      await clearProfileDraft(userId);
      await clearChurchDraft(userId);
      clearResponseCacheForRequest("GET", "/api/auth/profile", userId);
      clearResponseCacheForRequest("GET", "/api/church/members", userId);
      clearResponseCacheForRequest("GET", "/api/church/join-requests", userId);
      await clearChurchMembersCachesForUser(userId);
    }

    if (churchId) {
      await clearChurchProfileCache(churchId);
      await clearChurchMediaProfileCache(churchId);
    }

    const { logOutRevenueCat } = await import("./payments/mobileSubscriptions");
    if (reason === "delete") {
      console.log("KRISTO_ACCOUNT_DELETE_RC_LOGOUT", {
        userId: userId || null,
        churchId: churchId || null,
      });
    }
    await logOutRevenueCat();

    const { resetAuthRefreshStateForLogout } = await import("./refreshCoordinator");
    resetAuthRefreshStateForLogout();
  } catch (error: any) {
    console.log("KRISTO_LOGOUT_CLEAR_PARTIAL", {
      reason,
      error: String(error?.message || error || "unknown"),
    });
  }

  if (reason === "delete") {
    console.log("KRISTO_ACCOUNT_DELETE_SESSION_CLEARED", {
      userId: userId || null,
      churchId: churchId || null,
    });
  }

  console.log("KRISTO_LOGOUT_CLEAR_DONE", { userId: userId || null, reason });
}

// helper ids
export function makeChurchId() {
  const rand = Math.random().toString(36).slice(2, 8).toUpperCase();
  return `CH7-${rand}`;
}


export function makeUserId() {
  const n = Date.now().toString(36).toUpperCase();
  const r = Math.random().toString(36).slice(2, 5).toUpperCase();
  const digits = String(Date.now()).slice(-5);
  return `KR7-${digits}${n.slice(-1)}${r.slice(0, 1)}`;
}
