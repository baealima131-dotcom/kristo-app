import AsyncStorage from "@react-native-async-storage/async-storage";
import type { KristoSession } from "./kristoSession";
import { apiGet } from "./kristoApi";
import { getKristoHeaders } from "./kristoHeaders";
import { getSessionSync } from "./kristoSession";
import { resolveActiveChurchFromProfileResponse } from "./churchMembershipSync";
import { clearResponseCacheForRequest } from "./kristoTraffic";
import { clearChurchProfileCache, saveChurchProfileCache } from "./churchStore";
import { mergeChurchAvatarForDisplay, normalizeAvatarUpdatedAt } from "./avatarFreshness";
import { saveProfileDraft } from "./profileStore";
import { waitForHomeFirstVideoReadyIfOnHome } from "./firstPaint";
import {
  logMoreDeferredRefreshSkip,
  logMoreDeferredRefreshStart,
  runAfterMoreTabReadyForRefresh,
  shouldBlockChurchBackgroundWorkForMoreTab,
} from "./refreshCoordinator";
import { shouldPauseBackgroundProfileRefresh } from "./mediaScheduleFlowFlags";
import { isSessionExitInProgress } from "./kristoSessionExitFlags";
import {
  exportMediaPosterCacheSnapshot,
  hydrateMediaPosterCache,
  importMediaPosterCacheSnapshot,
} from "./mediaPosterCache";

export const SCREEN_CACHE_TTL_MS = 45000;
/** Fast re-check for church profile block on Church Overview focus. */
export const CHURCH_OVERVIEW_PROFILE_REFRESH_MS = 4000;

export type ChurchOverviewCachePayload = {
  churchId: string;
  userId: string;
  profile: {
    id: string;
    name: string;
    address: string;
    phone: string;
    pastorName: string;
    avatarUri: string;
    avatarUpdatedAt?: number;
  };
  stats: {
    activeMembers: number;
    ministries: number;
    ministryMembers: number;
    unreadNotifications: number;
    offeringBalance: number;
  };
  updatedAt: number;
};

export type ProfileScreenCachePayload = {
  userId: string;
  profile: Record<string, any> | null;
  postsCount: number;
  followersCount: number;
  followingCount: number;
  latestAnnouncement: Record<string, any> | null;
  latestTestimony: Record<string, any> | null;
  latestPrayer: Record<string, any> | null;
  latestSaved: { title: string; body: string } | null;
  mediaPosterEntries?: Record<string, import("./mediaPosterCache").MediaPosterCacheEntry>;
  updatedAt: number;
};

export type MinistriesCachePayload = {
  churchId: string;
  userId: string;
  items: Record<string, unknown>[];
  churchLiveControlStatus?: string;
  updatedAt: number;
};

const CHURCH_OVERVIEW_PREFIX = "kristo_screen_church_overview_v2:";
const PROFILE_SCREEN_PREFIX = "kristo_screen_profile_v1:";
const MINISTRIES_PREFIX = "kristo_screen_ministries_v1:";

const churchOverviewMemory = new Map<string, ChurchOverviewCachePayload>();
const profileScreenMemory = new Map<string, ProfileScreenCachePayload>();
const ministriesMemory = new Map<string, MinistriesCachePayload>();

let preloadInflight: Promise<void> | null = null;
let lastPreloadKey = "";
let lastPreloadAt = 0;

function churchOverviewKey(churchId: string, userId: string) {
  return `${String(churchId || "").trim().toUpperCase()}:${String(userId || "").trim()}`;
}

function profileScreenKey(userId: string) {
  return String(userId || "").trim();
}

function ministriesKey(churchId: string, userId: string) {
  return `${String(churchId || "").trim().toUpperCase()}:${String(userId || "").trim()}`;
}

export function isScreenCacheFresh(updatedAt?: number, ttlMs = SCREEN_CACHE_TTL_MS) {
  return Boolean(updatedAt) && Date.now() - Number(updatedAt) < ttlMs;
}

export function peekChurchOverviewCache(churchId: string, userId: string) {
  const key = churchOverviewKey(churchId, userId);
  return churchOverviewMemory.get(key) || null;
}

export function peekProfileScreenCache(userId: string) {
  const key = profileScreenKey(userId);
  const cached = profileScreenMemory.get(key) || null;
  if (cached?.mediaPosterEntries && typeof cached.mediaPosterEntries === "object") {
    importMediaPosterCacheSnapshot(cached.mediaPosterEntries);
  }
  return cached;
}

export function peekMinistriesCache(churchId: string, userId: string) {
  const key = ministriesKey(churchId, userId);
  return ministriesMemory.get(key) || null;
}

export async function getChurchOverviewCache(churchId: string, userId: string) {
  const key = churchOverviewKey(churchId, userId);
  const mem = churchOverviewMemory.get(key);
  if (mem) return mem;

  try {
    const raw = await AsyncStorage.getItem(`${CHURCH_OVERVIEW_PREFIX}${key}`);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as ChurchOverviewCachePayload;
    if (!parsed?.churchId || !parsed?.userId) return null;
    churchOverviewMemory.set(key, parsed);
    return parsed;
  } catch {
    return null;
  }
}

export async function saveChurchOverviewCache(payload: ChurchOverviewCachePayload) {
  const key = churchOverviewKey(payload.churchId, payload.userId);
  const next = { ...payload, updatedAt: Date.now() };
  churchOverviewMemory.set(key, next);
  await AsyncStorage.setItem(`${CHURCH_OVERVIEW_PREFIX}${key}`, JSON.stringify(next));

  await saveChurchProfileCache({
    churchId: next.profile.id || next.churchId,
    name: next.profile.name,
    address: next.profile.address,
    phone: next.profile.phone,
    pastorName: next.profile.pastorName,
    avatarUri: next.profile.avatarUri,
    avatarUrl: next.profile.avatarUri,
    avatarUpdatedAt: next.profile.avatarUpdatedAt,
  });
}

export async function invalidateChurchProfileCaches(
  churchId: string,
  opts?: { userId?: string; source?: string }
) {
  const cid = String(churchId || "").trim().toUpperCase();
  if (!cid) return;

  let removedOverviewKeys = 0;
  for (const key of [...churchOverviewMemory.keys()]) {
    if (key.startsWith(`${cid}:`)) {
      churchOverviewMemory.delete(key);
      removedOverviewKeys += 1;
    }
  }

  try {
    const allKeys = await AsyncStorage.getAllKeys();
    const prefix = `${CHURCH_OVERVIEW_PREFIX}${cid}:`;
    const toRemove = allKeys.filter((k) => k.startsWith(prefix));
    if (toRemove.length) await AsyncStorage.multiRemove(toRemove);
    removedOverviewKeys += toRemove.length;
  } catch {}

  await clearChurchProfileCache(cid);

  const uid = String(opts?.userId || "").trim();
  if (uid) {
    clearResponseCacheForRequest("GET", "/api/church/overview", uid);
  }

  console.log("KRISTO_CHURCH_PROFILE_CACHE_INVALIDATED", {
    churchId: cid,
    userId: uid || null,
    removedOverviewKeys,
    source: opts?.source || "unknown",
  });
}

export type ChurchOverviewProfileFields = ChurchOverviewCachePayload["profile"];

export function parseChurchOverviewProfileFields(
  churchId: string,
  p: Record<string, unknown> | null | undefined,
  local?: { uri?: string; updatedAt?: number }
): ChurchOverviewProfileFields {
  const serverAvatarRaw = String(
    p?.avatarUri ||
      p?.avatarUrl ||
      p?.churchAvatarUri ||
      p?.churchLogoUrl ||
      p?.profileImage ||
      p?.profilePhoto ||
      p?.photo ||
      p?.image ||
      ""
  ).trim();
  const serverUpdatedAt = normalizeAvatarUpdatedAt(p?.avatarUpdatedAt || p?.updatedAt);
  const mergedAvatar = mergeChurchAvatarForDisplay({
    churchId,
    localUri: local?.uri || "",
    localUpdatedAt: local?.updatedAt,
    serverUri: serverAvatarRaw,
    serverUpdatedAt,
    preferServer: true,
  });
  const avatarUpdatedAt =
    mergedAvatar.source === "server"
      ? serverUpdatedAt || (mergedAvatar.uri ? Date.now() : undefined)
      : local?.updatedAt;

  return {
    id: String(p?.id || churchId || ""),
    name: String(p?.name || churchId || "Church"),
    address: String(p?.address || ""),
    phone: String(p?.phone || ""),
    pastorName: String(p?.pastorName || ""),
    avatarUri: mergedAvatar.uri,
    avatarUpdatedAt,
  };
}

export async function getProfileScreenCache(userId: string) {
  const key = profileScreenKey(userId);
  const mem = profileScreenMemory.get(key);
  if (mem) return mem;

  try {
    const raw = await AsyncStorage.getItem(`${PROFILE_SCREEN_PREFIX}${key}`);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as ProfileScreenCachePayload;
    if (!parsed?.userId) return null;
    if (parsed.mediaPosterEntries && typeof parsed.mediaPosterEntries === "object") {
      importMediaPosterCacheSnapshot(parsed.mediaPosterEntries);
    }
    profileScreenMemory.set(key, parsed);
    return parsed;
  } catch {
    return null;
  }
}

export async function saveProfileScreenCache(payload: ProfileScreenCachePayload) {
  const key = profileScreenKey(payload.userId);
  const next = {
    ...payload,
    mediaPosterEntries: exportMediaPosterCacheSnapshot(),
    updatedAt: Date.now(),
  };
  profileScreenMemory.set(key, next);
  await AsyncStorage.setItem(`${PROFILE_SCREEN_PREFIX}${key}`, JSON.stringify(next));
}

export async function getMinistriesCache(churchId: string, userId: string) {
  const key = ministriesKey(churchId, userId);
  const mem = ministriesMemory.get(key);
  if (mem) return mem;

  try {
    const raw = await AsyncStorage.getItem(`${MINISTRIES_PREFIX}${key}`);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as MinistriesCachePayload;
    if (!parsed?.churchId || !parsed?.userId) return null;
    ministriesMemory.set(key, parsed);
    return parsed;
  } catch {
    return null;
  }
}

export async function saveMinistriesCache(payload: MinistriesCachePayload) {
  const key = ministriesKey(payload.churchId, payload.userId);
  const next = {
    ...payload,
    items: Array.isArray(payload.items) ? payload.items : [],
    updatedAt: Date.now(),
  };
  ministriesMemory.set(key, next);
  await AsyncStorage.setItem(`${MINISTRIES_PREFIX}${key}`, JSON.stringify(next));
}

function parseChurchOverviewResponse(
  churchId: string,
  userId: string,
  j: any,
  existing?: ChurchOverviewCachePayload | null
): ChurchOverviewCachePayload | null {
  if (!j?.ok) return null;
  const s = j?.data?.stats || {};
  const p = j?.data?.profile || {};
  const profile = parseChurchOverviewProfileFields(churchId, p, {
    uri: existing?.profile?.avatarUri || "",
    updatedAt: existing?.profile?.avatarUpdatedAt,
  });

  return {
    churchId,
    userId,
    profile,
    stats: {
      activeMembers: Number(s?.activeMembers || 0),
      ministries: Number(s?.ministries || 0),
      ministryMembers: Number(s?.ministryMembers || 0),
      unreadNotifications: Number(s?.unreadNotifications || 0),
      offeringBalance: Number(s?.offeringBalance || 0),
    },
    updatedAt: Date.now(),
  };
}

export async function silentRefreshChurchOverview(
  churchId: string,
  userId: string,
  headers?: Record<string, string>,
  opts?: { force?: boolean; profileFresh?: boolean }
) {
  if (isSessionExitInProgress()) return null;

  const cid = String(churchId || "").trim();
  const uid = String(userId || "").trim();
  if (!cid || !uid) return null;

  const existing = await getChurchOverviewCache(cid, uid);
  const existingStats = existing?.stats;
  const existingLooksStale =
    existingStats &&
    Number(existingStats.ministries || 0) === 0 &&
    Number(existingStats.ministryMembers || 0) === 0;

  const profileFresh = Boolean(opts?.profileFresh || opts?.force);
  if (
    !profileFresh &&
    !opts?.force &&
    existing &&
    isScreenCacheFresh(existing.updatedAt) &&
    !existingLooksStale
  ) {
    return existing;
  }

  if (profileFresh) {
    clearResponseCacheForRequest("GET", "/api/church/overview", uid);
  }

  if (shouldBlockChurchBackgroundWorkForMoreTab()) {
    logMoreDeferredRefreshSkip("silentRefreshChurchOverview", "more-first-paint-pending", {
      churchId: cid,
      userId: uid,
    });
    return existing || null;
  }

  const session = getSessionSync();
  const res = await apiGet<any>(
    "/api/church/overview",
    {
      headers:
        headers ||
        getKristoHeaders({
          userId: uid,
          churchId: cid,
          sessionToken: session?.sessionToken,
        }),
    },
    {
      screen: "ScreenCache",
      throttleMs: profileFresh ? 0 : SCREEN_CACHE_TTL_MS,
    }
  ).catch(() => null);

  const parsed = parseChurchOverviewResponse(cid, uid, res, existing);
  if (!parsed) return existing || null;

  await saveChurchOverviewCache(parsed);
  if (__DEV__) {
    console.log("KRISTO_CHURCH_OVERVIEW_SILENT_REFRESH", { churchId: cid, userId: uid });
  }
  return parsed;
}

function safeLower(v: unknown) {
  return String(v || "").toLowerCase();
}

function toTime(v: unknown) {
  const t = new Date(String(v || "")).getTime();
  return Number.isFinite(t) ? t : 0;
}

function isChurchActivityPost(x: any) {
  const type = safeLower(x?.type || x?.postType || "");
  return type !== "media" && type !== "live";
}

function firstWords(text: unknown, fallback: string, max = 5) {
  const words = String(text || "")
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, max);
  return words.length ? words.join(" ") : fallback;
}

export async function silentRefreshProfileScreen(
  session: KristoSession,
  opts?: { force?: boolean }
) {
  if (isSessionExitInProgress()) return null;

  if (!opts?.force && shouldPauseBackgroundProfileRefresh()) {
    if (__DEV__) {
      console.log("KRISTO_PROFILE_SILENT_REFRESH_SKIPPED", {
        reason: "media_schedule_flow_active",
        userId: String(session?.userId || "").trim() || null,
      });
    }
    return null;
  }

  const userId = String(session?.userId || "").trim();
  const churchId = String(session?.churchId || "").trim();
  if (!userId) return null;

  const existing = await getProfileScreenCache(userId);
  if (!opts?.force && existing && isScreenCacheFresh(existing.updatedAt)) {
    return existing;
  }

  const headers = getKristoHeaders({
    userId,
    role: (session.role || "Member") as any,
    churchId,
    sessionToken: session.sessionToken,
  });

  const [profileRes, postsRes, announcementsRes, feedRes, overviewRes] = await Promise.all([
    apiGet<any>("/api/auth/profile", { headers }, { screen: "ScreenCache", throttleMs: SCREEN_CACHE_TTL_MS }),
    apiGet<any>(`/api/users/${encodeURIComponent(userId)}/posts?limit=60`, { headers }, { screen: "ScreenCache", throttleMs: 120000 }),
    churchId
      ? apiGet<any>("/api/church/feed?scope=church&type=announcement", { headers }, { screen: "ScreenCache", throttleMs: 120000 })
      : Promise.resolve(null),
    churchId
      ? apiGet<any>("/api/church/feed?scope=church", { headers }, { screen: "ScreenCache", throttleMs: 120000 })
      : Promise.resolve(null),
    apiGet<any>(`/api/users/${encodeURIComponent(userId)}/overview`, { headers }, { screen: "ScreenCache", throttleMs: 120000 }),
  ]);

  const profile = profileRes?.ok ? profileRes.profile || profileRes.data?.profile || null : null;
  const overview = overviewRes?.ok ? overviewRes.data : undefined;
  const userPosts = Array.isArray(postsRes?.data?.items) ? postsRes.data.items : [];
  const announcementItems = Array.isArray(announcementsRes?.data) ? announcementsRes.data : [];
  const feedItems = Array.isArray(feedRes?.data) ? feedRes.data : [];

  const myAnnouncements = announcementItems
    .filter((x: any) => String(x?.createdBy || "").trim() === userId)
    .filter(isChurchActivityPost)
    .sort((a: any, b: any) => toTime(b?.createdAt) - toTime(a?.createdAt));

  const myFeed = feedItems
    .filter(isChurchActivityPost)
    .filter((x: any) => String(x?.createdBy || "").trim() === userId)
    .sort((a: any, b: any) => toTime(b?.createdAt) - toTime(a?.createdAt));

  const testimony = myFeed.find((x: any) => {
    const bag = `${safeLower(x?.title)} ${safeLower(x?.text)}`;
    return bag.includes("testimony") || bag.includes("ushuhuda");
  });

  const prayer = myFeed.find((x: any) => {
    const bag = `${safeLower(x?.title)} ${safeLower(x?.text)}`;
    return bag.includes("prayer") || bag.includes("maombi");
  });

  const savedSource = userPosts[0];
  const latestSaved = savedSource
    ? {
        title: firstWords(savedSource.caption, "Latest post", 5),
        body: String(savedSource.caption || "").trim() || "Your newest user post is ready here.",
      }
    : null;

  const payload: ProfileScreenCachePayload = {
    userId,
    profile,
    postsCount: typeof overview?.postsCount === "number" ? overview.postsCount : userPosts.length,
    followersCount: typeof overview?.followersCount === "number" ? overview.followersCount : 0,
    followingCount: typeof overview?.followingCount === "number" ? overview.followingCount : 0,
    latestAnnouncement: myAnnouncements[0] || null,
    latestTestimony: testimony || null,
    latestPrayer: prayer || null,
    latestSaved,
    updatedAt: Date.now(),
  };

  await saveProfileScreenCache(payload);

  if (profile?.fullName || profile?.avatarUrl) {
    await saveProfileDraft(
      {
        userId,
        displayName: String(profile.fullName || ""),
        avatarUri: String(profile.avatarUrl || ""),
      },
      userId
    );
  }

  if (__DEV__) {
    console.log("KRISTO_PROFILE_SILENT_REFRESH", { userId, churchId });
  }

  return payload;
}

export async function silentPreloadTabScreens(session: KristoSession | null, opts?: { force?: boolean }) {
  if (isSessionExitInProgress()) return null;

  const userId = String(session?.userId || "").trim();
  if (!userId) return;

  if (shouldBlockChurchBackgroundWorkForMoreTab()) {
    logMoreDeferredRefreshSkip("silentPreloadTabScreens", "more-first-paint-pending", {
      userId,
      churchId: String(session?.churchId || "").trim(),
    });
    runAfterMoreTabReadyForRefresh(() => {
      void silentPreloadTabScreens(session, opts);
    });
    return preloadInflight;
  }

  let effectiveSession = session as KristoSession;
  let churchId = String(effectiveSession?.churchId || "").trim();

  if (churchId) {
    if (opts?.force) {
      clearResponseCacheForRequest("GET", "/api/auth/profile", userId);
    }

    const profileRes = await apiGet<any>(
      "/api/auth/profile",
      {
        headers: getKristoHeaders({
          userId,
          role: "Member",
          churchId: "",
          sessionToken: effectiveSession?.sessionToken,
        }),
      },
      { screen: "ScreenCache", throttleMs: opts?.force ? 0 : SCREEN_CACHE_TTL_MS }
    ).catch(() => null);

    const resolved = resolveActiveChurchFromProfileResponse(profileRes);
    if (!resolved.churchId) {
      churchId = "";
      effectiveSession = {
        ...effectiveSession,
        churchId: "",
        activeChurchId: "",
        churchName: "",
        role: "Member",
        churchRole: "Member",
      } as KristoSession;
      if (__DEV__) {
        console.log("KRISTO_SILENT_PRELOAD_SKIP_CHURCH", {
          userId,
          membershipStatus: String(profileRes?.activeMembership?.status || "none"),
        });
      }
    }
  }

  const preloadKey = `${userId}:${churchId}`;
  if (
    !opts?.force &&
    preloadInflight &&
    lastPreloadKey === preloadKey &&
    Date.now() - lastPreloadAt < SCREEN_CACHE_TTL_MS
  ) {
    return preloadInflight;
  }

  if (__DEV__) {
    console.log("KRISTO_SILENT_PRELOAD_START", { userId, churchId });
  }

  lastPreloadKey = preloadKey;
  lastPreloadAt = Date.now();

  preloadInflight = (async () => {
    const runPreloadBody = async () => {
      await waitForHomeFirstVideoReadyIfOnHome();
      await hydrateMediaPosterCache();

      const tasks: Promise<unknown>[] = [silentRefreshProfileScreen(effectiveSession, opts)];
      if (churchId) {
        const existingOverview = await getChurchOverviewCache(churchId, userId);
        const overviewFresh =
          !opts?.force &&
          existingOverview &&
          isScreenCacheFresh(existingOverview.updatedAt) &&
          !(
            Number(existingOverview.stats?.ministries || 0) === 0 &&
            Number(existingOverview.stats?.ministryMembers || 0) === 0
          );

        if (overviewFresh) {
          logMoreDeferredRefreshSkip("silentPreloadTabScreens", "church-overview-cache-fresh", {
            churchId,
            userId,
          });
        } else if (shouldBlockChurchBackgroundWorkForMoreTab()) {
          logMoreDeferredRefreshSkip("silentPreloadTabScreens", "church-overview-deferred", {
            churchId,
            userId,
          });
        } else {
          logMoreDeferredRefreshStart("silentPreloadTabScreens-church-overview", {
            churchId,
            userId,
          });
          tasks.push(
            silentRefreshChurchOverview(
              churchId,
              userId,
              getKristoHeaders({
                userId,
                role: (effectiveSession?.role || "Member") as any,
                churchId,
                sessionToken: effectiveSession?.sessionToken,
              }),
              opts
            )
          );
        }
      }
      await Promise.allSettled(tasks);
    };

    await runPreloadBody();
  })().finally(() => {
    preloadInflight = null;
  });

  return preloadInflight;
}
