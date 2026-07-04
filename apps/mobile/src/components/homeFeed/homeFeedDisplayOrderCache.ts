import AsyncStorage from "@react-native-async-storage/async-storage";
import { getSessionSync } from "@/src/lib/kristoSession";
import { feedRenderKey } from "./homeFeedRowKeys";

const STORAGE_PREFIX = "kristo_home_feed_display_order_v1:";
const SESSION_KEY = "kristo.session.v1";

export type HomeFeedDisplayOrderCachePayload = {
  userId: string;
  churchId: string;
  rows: any[];
  savedAt: number;
  orderDigest: string;
};

const memoryByUser = new Map<string, HomeFeedDisplayOrderCachePayload>();
let hydrateInflight: Promise<HomeFeedDisplayOrderCachePayload | null> | null = null;
let lastHydrateUserId = "";
let hydrateSettled = false;
let hydrateSettledPromise: Promise<void> | null = null;
let resolveHydrateSettled: (() => void) | null = null;

function markHydrateSettled() {
  if (hydrateSettled) return;
  hydrateSettled = true;
  resolveHydrateSettled?.();
  resolveHydrateSettled = null;
  hydrateSettledPromise = null;
}

export function isHomeFeedDisplayOrderCacheHydrateSettled(): boolean {
  return hydrateSettled;
}

export function whenHomeFeedDisplayOrderCacheHydrateDone(): Promise<void> {
  if (hydrateSettled) return Promise.resolve();
  if (!hydrateSettledPromise) {
    hydrateSettledPromise = new Promise<void>((resolve) => {
      resolveHydrateSettled = resolve;
    });
  }
  return hydrateSettledPromise;
}

export function hasHomeFeedDisplayOrderCache(userId?: string): boolean {
  return peekHomeFeedDisplayOrderSync(userId).length > 0;
}

function displayOrderCacheKey(userId: string) {
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

function rowOrderKey(row: any): string {
  return feedRenderKey(row) || String(row?.id || "").trim();
}

export function buildHomeFeedDisplayOrderDigest(rows: any[]): string {
  return rows
    .map((row) => rowOrderKey(row))
    .filter(Boolean)
    .join("|");
}

export function peekHomeFeedDisplayOrderSync(userId?: string): any[] {
  const uid = String(userId || activeCacheUserId()).trim() || "guest";
  return memoryByUser.get(uid)?.rows || [];
}

export function peekHomeFeedDisplayOrderSavedAt(userId?: string): number | null {
  const uid = String(userId || activeCacheUserId()).trim() || "guest";
  const savedAt = memoryByUser.get(uid)?.savedAt ?? 0;
  return Number.isFinite(savedAt) && savedAt > 0 ? savedAt : null;
}

export function seedHomeFeedDisplayOrderMemoryCache(
  rows: any[],
  orderDigest?: string,
  savedAt = Date.now(),
  userId?: string
) {
  const uid = String(userId || activeCacheUserId()).trim() || "guest";
  const normalized = Array.isArray(rows) ? rows.filter((row) => row && typeof row === "object") : [];
  if (!normalized.length) return [];

  const payload: HomeFeedDisplayOrderCachePayload = {
    userId: uid,
    churchId: String(getSessionSync()?.churchId || "").trim(),
    rows: normalized,
    savedAt,
    orderDigest: String(orderDigest || buildHomeFeedDisplayOrderDigest(normalized)).trim(),
  };
  memoryByUser.set(uid, payload);
  return normalized;
}

export async function hydrateHomeFeedDisplayOrderFromStorage(
  userId?: string
): Promise<HomeFeedDisplayOrderCachePayload | null> {
  const { isHomeFeedYouTubeStyleVideo } = require("@/src/lib/homeFeedVideoMode") as {
    isHomeFeedYouTubeStyleVideo: () => boolean;
  };
  if (isHomeFeedYouTubeStyleVideo()) return null;

  const uid = String(userId || (await resolveHydrateUserId())).trim() || "guest";
  const mem = memoryByUser.get(uid);
  if (mem?.rows?.length) {
    markHydrateSettled();
    return mem;
  }

  if (!userId && hydrateInflight && lastHydrateUserId === uid) {
    return hydrateInflight;
  }

  lastHydrateUserId = uid;
  console.log("KRISTO_HOME_FEED_DISPLAY_ORDER_CACHE_HYDRATE_START", { userId: uid });
  hydrateInflight = (async () => {
    try {
      const raw = await AsyncStorage.getItem(displayOrderCacheKey(uid));
      if (!raw) return null;

      const parsed = JSON.parse(raw) as HomeFeedDisplayOrderCachePayload;
      const rows = Array.isArray(parsed?.rows)
        ? parsed.rows.filter((row) => row && typeof row === "object")
        : [];
      if (!rows.length) return null;

      const savedAt = Number(parsed?.savedAt || 0) || Date.now();
      const payload: HomeFeedDisplayOrderCachePayload = {
        userId: uid,
        churchId: String(parsed?.churchId || "").trim(),
        rows,
        savedAt,
        orderDigest: String(parsed?.orderDigest || buildHomeFeedDisplayOrderDigest(rows)).trim(),
      };
      memoryByUser.set(uid, payload);

      console.log("KRISTO_HOME_FEED_DISPLAY_ORDER_CACHE_HYDRATE", {
        count: rows.length,
        ageMs: Math.max(0, Date.now() - savedAt),
      });

      return payload;
    } catch {
      return null;
    } finally {
      hydrateInflight = null;
      markHydrateSettled();
    }
  })();

  return hydrateInflight;
}

export async function saveHomeFeedDisplayOrderCache(rows: any[], userId?: string) {
  const uid = String(userId || activeCacheUserId()).trim() || "guest";
  const normalized = Array.isArray(rows) ? rows.filter((row) => row && typeof row === "object") : [];
  if (!normalized.length) {
    memoryByUser.delete(uid);
    await AsyncStorage.removeItem(displayOrderCacheKey(uid));
    return;
  }

  const payload: HomeFeedDisplayOrderCachePayload = {
    userId: uid,
    churchId: String(getSessionSync()?.churchId || "").trim(),
    rows: normalized,
    savedAt: Date.now(),
    orderDigest: buildHomeFeedDisplayOrderDigest(normalized),
  };

  memoryByUser.set(uid, payload);
  await AsyncStorage.setItem(displayOrderCacheKey(uid), JSON.stringify(payload));

  console.log("KRISTO_HOME_FEED_DISPLAY_ORDER_CACHE_SAVE", {
    count: normalized.length,
  });
}

export function kickoffHomeFeedDisplayOrderCacheHydrate() {
  const { isHomeFeedYouTubeStyleVideo } = require("@/src/lib/homeFeedVideoMode") as {
    isHomeFeedYouTubeStyleVideo: () => boolean;
  };
  if (isHomeFeedYouTubeStyleVideo()) return;

  void (async () => {
    const uid = await resolveHydrateUserId();
    await hydrateHomeFeedDisplayOrderFromStorage(uid);
  })();
}
