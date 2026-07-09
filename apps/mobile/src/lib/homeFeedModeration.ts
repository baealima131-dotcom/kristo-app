import AsyncStorage from "@react-native-async-storage/async-storage";

import { apiDelete, apiGet, apiPost } from "@/src/lib/kristoApi";
import { getKristoHeaders } from "@/src/lib/kristoHeaders";
import { getSessionSync } from "@/src/lib/kristoSession";

const BLOCKED_USERS_KEY = "kristo_home_feed_blocked_users_v1";
const CHURCH_MODERATION_KEY = "kristo_home_feed_church_moderation_v1";

export type ChurchFeedActionType = "hide" | "block";

export type ChurchModerationRecord = {
  churchId: string;
  actionType: ChurchFeedActionType;
  updatedAt?: string;
};

type ChurchModerationCache = Record<string, ChurchModerationRecord>;

type ChurchModerationListener = () => void;
const churchModerationListeners = new Set<ChurchModerationListener>();

function cleanUserId(raw: unknown) {
  return String(raw || "").trim();
}

export function normalizeFeedChurchId(raw: unknown) {
  return String(raw || "").trim().toUpperCase();
}

function authedHeaders() {
  const session = getSessionSync() as any;
  return getKristoHeaders({
    userId: session?.userId || "",
    role: (session?.role || "Member") as any,
    churchId: session?.churchId || "",
  });
}

export function subscribeChurchFeedModeration(listener: ChurchModerationListener) {
  churchModerationListeners.add(listener);
  return () => {
    churchModerationListeners.delete(listener);
  };
}

function notifyChurchFeedModerationChanged() {
  churchModerationListeners.forEach((listener) => {
    try {
      listener();
    } catch {}
  });
}

async function readBlockedUsersCache(): Promise<Record<string, true>> {
  try {
    const raw = await AsyncStorage.getItem(BLOCKED_USERS_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object") return {};
    return parsed as Record<string, true>;
  } catch {
    return {};
  }
}

async function writeBlockedUsersCache(map: Record<string, true>) {
  try {
    await AsyncStorage.setItem(BLOCKED_USERS_KEY, JSON.stringify(map));
  } catch {}
}

async function readChurchModerationCache(): Promise<ChurchModerationCache> {
  try {
    const raw = await AsyncStorage.getItem(CHURCH_MODERATION_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object") return {};
    return parsed as ChurchModerationCache;
  } catch {
    return {};
  }
}

async function writeChurchModerationCache(map: ChurchModerationCache) {
  try {
    await AsyncStorage.setItem(CHURCH_MODERATION_KEY, JSON.stringify(map));
  } catch {}
}

export async function markUserBlockedLocally(userId: string) {
  const id = cleanUserId(userId);
  if (!id) return;
  const cache = await readBlockedUsersCache();
  cache[id] = true;
  await writeBlockedUsersCache(cache);
}

export async function getLocallyBlockedUserIds() {
  const cache = await readBlockedUsersCache();
  return Object.keys(cache);
}

export async function fetchBlockedUserIdsFromApi(): Promise<string[]> {
  const session = getSessionSync() as any;
  if (!session?.userId) return [];

  try {
    const res: any = await apiGet(
      "/api/church/feed/block",
      { headers: authedHeaders() },
      { screen: "HomeFeedModeration", throttleMs: 0 }
    );

    const blockedUserIds = Array.isArray(res?.data?.blockedUserIds)
      ? res.data.blockedUserIds.map(cleanUserId).filter(Boolean)
      : [];

    if (blockedUserIds.length) {
      const cache = await readBlockedUsersCache();
      for (const uid of blockedUserIds) cache[uid] = true;
      await writeBlockedUsersCache(cache);
    }
    return blockedUserIds;
  } catch {
    return [];
  }
}

export async function blockHomeFeedUser(input: {
  blockedUserId: string;
  reason?: string;
}) {
  const blockedUserId = cleanUserId(input.blockedUserId);
  if (!blockedUserId) {
    return { ok: false as const, error: "Missing user id" };
  }

  const session = getSessionSync() as any;
  if (!session?.userId) {
    return { ok: false as const, error: "Sign in to block users" };
  }

  try {
    const res: any = await apiPost(
      "/api/church/feed/block",
      {
        blockedUserId,
        reason: String(input.reason || "").trim(),
      },
      { headers: authedHeaders() }
    );

    if (!res?.ok) {
      return { ok: false as const, error: String(res?.error || "Failed to block user") };
    }

    await markUserBlockedLocally(blockedUserId);
    return { ok: true as const };
  } catch (error: any) {
    return { ok: false as const, error: String(error?.message || "Failed to block user") };
  }
}

export async function getLocallyExcludedChurchIds() {
  const cache = await readChurchModerationCache();
  return Object.keys(cache).map(normalizeFeedChurchId).filter(Boolean);
}

export async function getLocallyChurchModerationRecords(): Promise<ChurchModerationRecord[]> {
  const cache = await readChurchModerationCache();
  return Object.values(cache).filter((row) => Boolean(row?.churchId));
}

export async function getLocalChurchModerationAction(
  churchId: string
): Promise<ChurchFeedActionType | null> {
  const id = normalizeFeedChurchId(churchId);
  if (!id) return null;
  const cache = await readChurchModerationCache();
  return cache[id]?.actionType || null;
}

async function markChurchModerationLocally(input: {
  churchId: string;
  actionType: ChurchFeedActionType;
}) {
  const churchId = normalizeFeedChurchId(input.churchId);
  if (!churchId) return;
  const cache = await readChurchModerationCache();
  cache[churchId] = {
    churchId,
    actionType: input.actionType,
    updatedAt: new Date().toISOString(),
  };
  await writeChurchModerationCache(cache);
  notifyChurchFeedModerationChanged();
}

export async function removeChurchModerationLocally(churchId: string) {
  const id = normalizeFeedChurchId(churchId);
  if (!id) return;
  const cache = await readChurchModerationCache();
  if (!cache[id]) return;
  delete cache[id];
  await writeChurchModerationCache(cache);
  notifyChurchFeedModerationChanged();
}

export async function fetchChurchModerationFromApi(): Promise<{
  ok: boolean;
  records: ChurchModerationRecord[];
}> {
  const session = getSessionSync() as any;
  if (!session?.userId) return { ok: false, records: [] };

  try {
    const res: any = await apiGet(
      "/api/church/feed/block-church",
      { headers: authedHeaders() },
      { screen: "HomeFeedChurchModeration", throttleMs: 0 }
    );

    if (!res?.ok) {
      return { ok: false, records: [] };
    }

    const records = Array.isArray(res?.data?.records)
      ? res.data.records
          .map((row: any) => ({
            churchId: normalizeFeedChurchId(row?.churchId),
            actionType: (String(row?.actionType || "").toLowerCase() === "block"
              ? "block"
              : "hide") as ChurchFeedActionType,
            updatedAt: String(row?.updatedAt || ""),
          }))
          .filter((row: ChurchModerationRecord) => Boolean(row.churchId))
      : [];

    const cache = await readChurchModerationCache();
    for (const key of Object.keys(cache)) {
      delete cache[key];
    }
    for (const row of records) {
      cache[row.churchId] = row;
    }
    await writeChurchModerationCache(cache);
    notifyChurchFeedModerationChanged();

    return { ok: true, records };
  } catch {
    return { ok: false, records: [] };
  }
}

export async function hideHomeFeedChurch(input: { churchId: string; reason?: string }) {
  const churchId = normalizeFeedChurchId(input.churchId);
  if (!churchId) return { ok: false as const, error: "Missing church id" };

  const session = getSessionSync() as any;
  if (!session?.userId) {
    return { ok: false as const, error: "Sign in to hide churches" };
  }

  console.log("KRISTO_CHURCH_HIDE_REQUESTED", { churchId, userId: session.userId });

  try {
    const res: any = await apiPost(
      "/api/church/feed/block-church",
      {
        churchId,
        actionType: "hide",
        reason: String(input.reason || "").trim(),
      },
      { headers: authedHeaders() }
    );

    if (!res?.ok) {
      return { ok: false as const, error: String(res?.error || "Failed to hide church") };
    }

    await markChurchModerationLocally({ churchId, actionType: "hide" });
    return { ok: true as const, actionType: "hide" as const };
  } catch (error: any) {
    return { ok: false as const, error: String(error?.message || "Failed to hide church") };
  }
}

export async function blockHomeFeedChurch(input: { churchId: string; reason?: string }) {
  const churchId = normalizeFeedChurchId(input.churchId);
  if (!churchId) return { ok: false as const, error: "Missing church id" };

  const session = getSessionSync() as any;
  if (!session?.userId) {
    return { ok: false as const, error: "Sign in to block churches" };
  }

  console.log("KRISTO_CHURCH_BLOCK_REQUESTED", { churchId, userId: session.userId });

  try {
    const res: any = await apiPost(
      "/api/church/feed/block-church",
      {
        churchId,
        actionType: "block",
        reason: String(input.reason || "").trim(),
      },
      { headers: authedHeaders() }
    );

    if (!res?.ok) {
      return { ok: false as const, error: String(res?.error || "Failed to block church") };
    }

    await markChurchModerationLocally({ churchId, actionType: "block" });
    return { ok: true as const, actionType: "block" as const };
  } catch (error: any) {
    return { ok: false as const, error: String(error?.message || "Failed to block church") };
  }
}

export async function unhideHomeFeedChurch(churchId: string) {
  const id = normalizeFeedChurchId(churchId);
  if (!id) return { ok: false as const, error: "Missing church id" };

  const session = getSessionSync() as any;
  if (!session?.userId) {
    return { ok: false as const, error: "Sign in to unhide churches" };
  }

  console.log("KRISTO_CHURCH_UNHIDE_REQUESTED", { churchId: id, userId: session.userId });

  try {
    const res: any = await apiDelete(
      `/api/church/feed/block-church?churchId=${encodeURIComponent(id)}`,
      { headers: authedHeaders() }
    );

    if (!res?.ok) {
      return { ok: false as const, error: String(res?.error || "Failed to unhide church") };
    }

    await removeChurchModerationLocally(id);
    return { ok: true as const };
  } catch (error: any) {
    return { ok: false as const, error: String(error?.message || "Failed to unhide church") };
  }
}

export async function unblockHomeFeedChurch(churchId: string) {
  const id = normalizeFeedChurchId(churchId);
  if (!id) return { ok: false as const, error: "Missing church id" };

  const session = getSessionSync() as any;
  if (!session?.userId) {
    return { ok: false as const, error: "Sign in to unblock churches" };
  }

  console.log("KRISTO_CHURCH_UNBLOCK_REQUESTED", { churchId: id, userId: session.userId });

  try {
    const res: any = await apiDelete(
      `/api/church/feed/block-church?churchId=${encodeURIComponent(id)}`,
      { headers: authedHeaders() }
    );

    if (!res?.ok) {
      return { ok: false as const, error: String(res?.error || "Failed to unblock church") };
    }

    await removeChurchModerationLocally(id);
    return { ok: true as const };
  } catch (error: any) {
    return { ok: false as const, error: String(error?.message || "Failed to unblock church") };
  }
}

export function isViewerOwnChurchAdmin(churchId: string) {
  const session = getSessionSync() as any;
  const ownChurchId = normalizeFeedChurchId(session?.churchId || "");
  const targetChurchId = normalizeFeedChurchId(churchId);
  if (!ownChurchId || !targetChurchId || ownChurchId !== targetChurchId) return false;

  const role = String(session?.role || session?.churchRole || "").trim();
  return /pastor|admin|bishop|elder|supervisor|media/i.test(role);
}
