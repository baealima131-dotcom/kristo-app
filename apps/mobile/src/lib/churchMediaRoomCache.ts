import AsyncStorage from "@react-native-async-storage/async-storage";
import { isScreenCacheFresh } from "@/src/lib/screenDataCacheFresh";

export const CHURCH_MEDIA_ROOM_REFRESH_MS = 75000;
/** Church Live Control schedule cards — poll often enough to feel realtime. */
export const CHURCH_LIVE_CONTROL_ROOM_REFRESH_MS = 4000;

export function resolveRoomMessagesRefreshMs(roomId: string) {
  const rid = String(roomId || "").trim();
  return rid === "church-media-room"
    ? CHURCH_LIVE_CONTROL_ROOM_REFRESH_MS
    : CHURCH_MEDIA_ROOM_REFRESH_MS;
}

const ROOM_MESSAGES_PREFIX = "kristo_media_room_messages_v1:";
const LIVE_CONTROL_PREFIX = "kristo_media_room_live_control_v1:";
const MC_HOSTS_PREFIX = "kristo_media_room_mc_hosts_v1:";

const roomMessagesMemory = new Map<string, RoomMessagesCachePayload>();
const liveControlMemory = new Map<string, LiveControlMembersCachePayload>();
const mcHostsMemory = new Map<string, McHostsCachePayload>();

export type RoomMessagesCachePayload = {
  churchId: string;
  userId: string;
  roomId: string;
  rawRows: Record<string, unknown>[];
  updatedAt: number;
};

export type LiveControlMembersCachePayload = {
  churchId: string;
  userId: string;
  roomId: string;
  rawRows: Record<string, unknown>[];
  updatedAt: number;
};

export type McHostsCachePayload = {
  churchId: string;
  userId: string;
  assignmentId: string;
  hostUserIds: string[];
  updatedAt: number;
};

function scopeKey(churchId: string, userId: string) {
  return `${String(churchId || "").trim().toUpperCase()}:${String(userId || "").trim()}`;
}

function roomMessagesKey(churchId: string, userId: string, roomId: string) {
  return `${scopeKey(churchId, userId)}:${String(roomId || "").trim()}`;
}

function liveControlKey(churchId: string, userId: string, roomId: string) {
  return `${scopeKey(churchId, userId)}:${String(roomId || "").trim()}`;
}

function mcHostsKey(churchId: string, userId: string, assignmentId: string) {
  return `${scopeKey(churchId, userId)}:${String(assignmentId || "").trim()}`;
}

export function isChurchMediaRoomCacheFresh(updatedAt?: number) {
  return isScreenCacheFresh(updatedAt, CHURCH_MEDIA_ROOM_REFRESH_MS);
}

export function roomMessagesRawSignature(rows: any[]) {
  return (Array.isArray(rows) ? rows : [])
    .map((r) => {
      const card = r?.card && typeof r.card === "object" ? r.card : null;
      const cardMeta = card
        ? `${String(card?.cardId || card?.id || "")}|${String(card?.claimedByUserId || "")}|${String(card?.status || "")}|${Number(card?.slotNumber || card?.order || 0)}|${String(card?.startTime || "")}|${String(card?.endTime || "")}`
        : "";
      return `${String(r?.id || "")}|${String(r?.createdAt || "")}|${String(r?.kind || "")}|${String(r?.text || "").slice(0, 40)}|${cardMeta}`;
    })
    .sort()
    .join("\n");
}

export function liveControlMembersRawSignature(rows: any[]) {
  return (Array.isArray(rows) ? rows : [])
    .map(
      (r) =>
        `${String(r?.userId || r?.id || "")}|${String(r?.role || "")}|${String(r?.status || r?.liveControlStatus || "")}|${Boolean(r?.avatarUri || r?.avatarUrl)}`
    )
    .sort()
    .join("\n");
}

export function mcHostsSignature(hostUserIds: string[]) {
  return (Array.isArray(hostUserIds) ? hostUserIds : [])
    .map((id) => String(id || "").trim())
    .filter(Boolean)
    .sort()
    .join("|");
}

export function peekRoomMessagesCache(churchId: string, userId: string, roomId: string) {
  return roomMessagesMemory.get(roomMessagesKey(churchId, userId, roomId)) || null;
}

export async function getRoomMessagesCache(churchId: string, userId: string, roomId: string) {
  const key = roomMessagesKey(churchId, userId, roomId);
  const mem = roomMessagesMemory.get(key);
  if (mem) return mem;

  try {
    const raw = await AsyncStorage.getItem(`${ROOM_MESSAGES_PREFIX}${key}`);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as RoomMessagesCachePayload;
    if (!parsed?.roomId) return null;
    roomMessagesMemory.set(key, parsed);
    return parsed;
  } catch {
    return null;
  }
}

export async function saveRoomMessagesCache(payload: RoomMessagesCachePayload) {
  const key = roomMessagesKey(payload.churchId, payload.userId, payload.roomId);
  const next = { ...payload, updatedAt: Date.now() };
  roomMessagesMemory.set(key, next);
  await AsyncStorage.setItem(`${ROOM_MESSAGES_PREFIX}${key}`, JSON.stringify(next));
}

/**
 * Drop the cached room-messages payload (memory + storage) so the next refresh
 * is forced to hit the network instead of returning a stale (possibly count:0)
 * snapshot. Used right after a successful send/reconcile.
 */
export function invalidateRoomMessagesCache(churchId: string, userId: string, roomId: string) {
  const key = roomMessagesKey(churchId, userId, roomId);
  roomMessagesMemory.delete(key);
  void AsyncStorage.removeItem(`${ROOM_MESSAGES_PREFIX}${key}`);
}

/** Wipe cached rows so cache-fresh polls cannot resurrect deleted assignment cards. */
export async function clearRoomMessagesCacheAfterDelete(
  churchId: string,
  userId: string,
  roomId: string
) {
  const cid = String(churchId || "").trim();
  const uid = String(userId || "").trim();
  const rid = String(roomId || "").trim();
  if (!cid || !uid || !rid) return;

  const key = roomMessagesKey(cid, uid, rid);
  const cleared: RoomMessagesCachePayload = {
    churchId: cid,
    userId: uid,
    roomId: rid,
    rawRows: [],
    updatedAt: 0,
  };

  roomMessagesMemory.set(key, cleared);
  await AsyncStorage.setItem(`${ROOM_MESSAGES_PREFIX}${key}`, JSON.stringify(cleared));

  console.log("KRISTO_ROOM_MESSAGES_CACHE_CLEARED_AFTER_DELETE", {
    roomId: rid,
  });
}

export function peekLiveControlMembersCache(churchId: string, userId: string, roomId: string) {
  return liveControlMemory.get(liveControlKey(churchId, userId, roomId)) || null;
}

export async function getLiveControlMembersCache(churchId: string, userId: string, roomId: string) {
  const key = liveControlKey(churchId, userId, roomId);
  const mem = liveControlMemory.get(key);
  if (mem) return mem;

  try {
    const raw = await AsyncStorage.getItem(`${LIVE_CONTROL_PREFIX}${key}`);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as LiveControlMembersCachePayload;
    if (!parsed?.roomId) return null;
    liveControlMemory.set(key, parsed);
    return parsed;
  } catch {
    return null;
  }
}

export async function saveLiveControlMembersCache(payload: LiveControlMembersCachePayload) {
  const key = liveControlKey(payload.churchId, payload.userId, payload.roomId);
  const next = { ...payload, updatedAt: Date.now() };
  liveControlMemory.set(key, next);
  await AsyncStorage.setItem(`${LIVE_CONTROL_PREFIX}${key}`, JSON.stringify(next));
}

export function peekMcHostsCache(churchId: string, userId: string, assignmentId: string) {
  return mcHostsMemory.get(mcHostsKey(churchId, userId, assignmentId)) || null;
}

export async function getMcHostsCache(churchId: string, userId: string, assignmentId: string) {
  const key = mcHostsKey(churchId, userId, assignmentId);
  const mem = mcHostsMemory.get(key);
  if (mem) return mem;

  try {
    const raw = await AsyncStorage.getItem(`${MC_HOSTS_PREFIX}${key}`);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as McHostsCachePayload;
    if (!parsed?.assignmentId) return null;
    mcHostsMemory.set(key, parsed);
    return parsed;
  } catch {
    return null;
  }
}

export async function saveMcHostsCache(payload: McHostsCachePayload) {
  const key = mcHostsKey(payload.churchId, payload.userId, payload.assignmentId);
  const next = { ...payload, updatedAt: Date.now() };
  mcHostsMemory.set(key, next);
  await AsyncStorage.setItem(`${MC_HOSTS_PREFIX}${key}`, JSON.stringify(next));
}

export function invalidateMcHostsCache(churchId: string, userId: string, assignmentId: string) {
  const key = mcHostsKey(churchId, userId, assignmentId);
  mcHostsMemory.delete(key);
  void AsyncStorage.removeItem(`${MC_HOSTS_PREFIX}${key}`);
}
