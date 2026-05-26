import AsyncStorage from "@react-native-async-storage/async-storage";
import type { KristoSession } from "./kristoSession";
import { apiGet } from "./kristoApi";
import { getKristoHeaders } from "./kristoHeaders";
import { saveChurchProfileCache } from "./churchStore";
import { saveProfileDraft } from "./profileStore";

export const SCREEN_CACHE_TTL_MS = 45000;

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
  updatedAt: number;
};

const CHURCH_OVERVIEW_PREFIX = "kristo_screen_church_overview_v1:";
const PROFILE_SCREEN_PREFIX = "kristo_screen_profile_v1:";

const churchOverviewMemory = new Map<string, ChurchOverviewCachePayload>();
const profileScreenMemory = new Map<string, ProfileScreenCachePayload>();

let preloadInflight: Promise<void> | null = null;
let lastPreloadKey = "";
let lastPreloadAt = 0;

function churchOverviewKey(churchId: string, userId: string) {
  return `${String(churchId || "").trim().toUpperCase()}:${String(userId || "").trim()}`;
}

function profileScreenKey(userId: string) {
  return String(userId || "").trim();
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
  return profileScreenMemory.get(key) || null;
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

export async function getProfileScreenCache(userId: string) {
  const key = profileScreenKey(userId);
  const mem = profileScreenMemory.get(key);
  if (mem) return mem;

  try {
    const raw = await AsyncStorage.getItem(`${PROFILE_SCREEN_PREFIX}${key}`);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as ProfileScreenCachePayload;
    if (!parsed?.userId) return null;
    profileScreenMemory.set(key, parsed);
    return parsed;
  } catch {
    return null;
  }
}

export async function saveProfileScreenCache(payload: ProfileScreenCachePayload) {
  const key = profileScreenKey(payload.userId);
  const next = { ...payload, updatedAt: Date.now() };
  profileScreenMemory.set(key, next);
  await AsyncStorage.setItem(`${PROFILE_SCREEN_PREFIX}${key}`, JSON.stringify(next));
}

function parseChurchOverviewResponse(churchId: string, userId: string, j: any): ChurchOverviewCachePayload | null {
  if (!j?.ok) return null;
  const s = j?.data?.stats || {};
  const p = j?.data?.profile || {};
  const avatarUri = String(
    p?.avatarUri || p?.avatarUrl || p?.profileImage || p?.profilePhoto || p?.photo || p?.image || ""
  ).trim();

  return {
    churchId,
    userId,
    profile: {
      id: String(p?.id || churchId || ""),
      name: String(p?.name || churchId || "Church"),
      address: String(p?.address || ""),
      phone: String(p?.phone || ""),
      pastorName: String(p?.pastorName || ""),
      avatarUri,
      avatarUpdatedAt: Number(p?.updatedAt || p?.avatarUpdatedAt || 0) || undefined,
    },
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
  opts?: { force?: boolean }
) {
  const cid = String(churchId || "").trim();
  const uid = String(userId || "").trim();
  if (!cid || !uid) return null;

  const existing = await getChurchOverviewCache(cid, uid);
  if (!opts?.force && existing && isScreenCacheFresh(existing.updatedAt)) {
    return existing;
  }

  const res = await apiGet<any>(
    "/api/church/overview",
    { headers: headers || getKristoHeaders({ userId: uid, churchId: cid }) },
    { screen: "ScreenCache", throttleMs: SCREEN_CACHE_TTL_MS }
  ).catch(() => null);

  const parsed = parseChurchOverviewResponse(cid, uid, res);
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
  });

  const [profileRes, postsRes, announcementsRes, feedRes, overviewRes] = await Promise.all([
    apiGet<any>("/api/auth/profile", { headers }, { screen: "ScreenCache", throttleMs: SCREEN_CACHE_TTL_MS }),
    apiGet<any>(`/api/users/${encodeURIComponent(userId)}/posts?limit=60`, { headers }, { screen: "ScreenCache", throttleMs: 120000 }),
    churchId
      ? apiGet<any>("/api/church/feed?type=announcement", { headers }, { screen: "ScreenCache", throttleMs: 120000 })
      : Promise.resolve(null),
    churchId
      ? apiGet<any>("/api/church/feed", { headers }, { screen: "ScreenCache", throttleMs: 120000 })
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
  const userId = String(session?.userId || "").trim();
  const churchId = String(session?.churchId || "").trim();
  if (!userId) return;

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
    const tasks: Promise<unknown>[] = [silentRefreshProfileScreen(session as KristoSession, opts)];
    if (churchId) {
      tasks.push(
        silentRefreshChurchOverview(
          churchId,
          userId,
          getKristoHeaders({
            userId,
            role: (session?.role || "Member") as any,
            churchId,
          }),
          opts
        )
      );
    }
    await Promise.allSettled(tasks);
  })().finally(() => {
    preloadInflight = null;
  });

  return preloadInflight;
}
