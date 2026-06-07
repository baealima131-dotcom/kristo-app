import AsyncStorage from "@react-native-async-storage/async-storage";
import { getSessionSync } from "@/src/lib/kristoSession";
import { normalizeHomeFeedApiRow } from "@/src/components/homeFeed/homeFeedUtils";

const STORAGE_PREFIX = "kristo_home_feed_rows_v1:";
const SESSION_KEY = "kristo.session.v1";

export type HomeFeedRowsCachePayload = {
  userId: string;
  churchId: string;
  rows: any[];
  savedAt: number;
};

const memoryByUser = new Map<string, HomeFeedRowsCachePayload>();
let hydrateInflight: Promise<HomeFeedRowsCachePayload | null> | null = null;
let lastHydrateUserId = "";

function homeFeedRowsCacheKey(userId: string) {
  const uid = String(userId || "guest").trim() || "guest";
  return `${STORAGE_PREFIX}${uid}`;
}

function activeCacheUserId() {
  return String(getSessionSync()?.userId || "guest").trim() || "guest";
}

async function resolveHydrateUserId(): Promise<string> {
  const syncUserId = String(getSessionSync()?.userId || "").trim();
  if (syncUserId) return syncUserId;

  try {
    const raw = await AsyncStorage.getItem(SESSION_KEY);
    if (!raw) return "guest";
    const parsed = JSON.parse(raw);
    return String(parsed?.userId || "guest").trim() || "guest";
  } catch {
    return "guest";
  }
}

function normalizeCachedRows(rows: unknown): any[] {
  if (!Array.isArray(rows)) return [];
  return rows
    .filter((row) => row && typeof row === "object")
    .map((row) => normalizeHomeFeedApiRow(row));
}

export function peekHomeFeedRowsCacheSync(userId?: string): any[] {
  const uid = String(userId || activeCacheUserId()).trim() || "guest";
  return memoryByUser.get(uid)?.rows || [];
}

export function peekHomeFeedRowsCacheSavedAt(userId?: string): number | null {
  const uid = String(userId || activeCacheUserId()).trim() || "guest";
  const savedAt = memoryByUser.get(uid)?.savedAt;
  return Number.isFinite(savedAt) && savedAt > 0 ? savedAt : null;
}

export function seedHomeFeedRowsMemoryCache(rows: any[], savedAt = Date.now(), userId?: string) {
  const uid = String(userId || activeCacheUserId()).trim() || "guest";
  const normalized = normalizeCachedRows(rows);
  if (!normalized.length) return [];
  const payload: HomeFeedRowsCachePayload = {
    userId: uid,
    churchId: String(getSessionSync()?.churchId || "").trim(),
    rows: normalized,
    savedAt,
  };
  memoryByUser.set(uid, payload);
  return normalized;
}

export async function hydrateHomeFeedRowsCacheFromStorage(
  userId?: string
): Promise<HomeFeedRowsCachePayload | null> {
  const uid = String(userId || (await resolveHydrateUserId())).trim() || "guest";
  const mem = memoryByUser.get(uid);
  if (mem?.rows?.length) return mem;

  if (!userId && hydrateInflight && lastHydrateUserId === uid) {
    return hydrateInflight;
  }

  lastHydrateUserId = uid;
  hydrateInflight = (async () => {
    try {
      const raw = await AsyncStorage.getItem(homeFeedRowsCacheKey(uid));
      if (!raw) return null;

      const parsed = JSON.parse(raw) as HomeFeedRowsCachePayload;
      const rows = normalizeCachedRows(parsed?.rows);
      if (!rows.length) return null;

      const savedAt = Number(parsed?.savedAt || 0) || Date.now();
      const payload: HomeFeedRowsCachePayload = {
        userId: uid,
        churchId: String(parsed?.churchId || "").trim(),
        rows,
        savedAt,
      };
      memoryByUser.set(uid, payload);

      console.log("KRISTO_HOME_FEED_CACHE_HYDRATE", {
        count: rows.length,
        ageMs: Math.max(0, Date.now() - savedAt),
      });

      return payload;
    } catch {
      return null;
    } finally {
      hydrateInflight = null;
    }
  })();

  return hydrateInflight;
}

export async function saveHomeFeedRowsCache(rows: any[], userId?: string) {
  const uid = String(userId || activeCacheUserId()).trim() || "guest";
  const normalized = normalizeCachedRows(rows);
  if (!normalized.length) return;

  const payload: HomeFeedRowsCachePayload = {
    userId: uid,
    churchId: String(getSessionSync()?.churchId || "").trim(),
    rows: normalized,
    savedAt: Date.now(),
  };

  memoryByUser.set(uid, payload);
  await AsyncStorage.setItem(homeFeedRowsCacheKey(uid), JSON.stringify(payload));

  console.log("KRISTO_HOME_FEED_CACHE_SAVE", {
    count: normalized.length,
  });
}

/** Start AsyncStorage hydration as early as possible (safe to call multiple times). */
export function kickoffHomeFeedRowsCacheHydrate() {
  void hydrateHomeFeedRowsCacheFromStorage();
}

kickoffHomeFeedRowsCacheHydrate();
