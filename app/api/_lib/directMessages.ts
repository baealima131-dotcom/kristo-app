import { readJsonFile, updateJsonFile } from "@/app/api/_lib/store/fs";
import { readRoomMessagesJsonFile } from "@/app/api/_lib/store/roomMessageDb";
import { getChurchById } from "@/app/api/_lib/churches";
import { getMembershipsForChurch } from "@/app/api/_lib/memberships";
import { getProfile, getProfileByUserCode } from "@/app/api/auth/_lib/profile";

const THREADS_STORE_FILE = "direct-message-threads.json";

export type DirectMessageThreadRecord = {
  roomId: string;
  churchId: string;
  participantUserIds: [string, string];
  createdAt: number;
  updatedAt: number;
  readAtByUserId: Record<string, number>;
};

export type DirectMessagePeerPreview = {
  userId: string;
  displayName: string;
  avatarUrl: string;
  kristoId: string;
  churchId: string;
  churchName: string;
};

export type DirectMessageInboxItem = {
  roomId: string;
  churchId: string;
  peerUserId: string;
  title: string;
  subtitle: string;
  avatarUri: string;
  lastMessagePreview: string;
  timestampLabel: string;
  timestampMs: number;
  unreadCount: number;
};

function normUserId(value: string) {
  return String(value || "").trim();
}

function threadStoreKey(churchId: string, roomId: string) {
  return `${String(churchId || "").trim()}::${String(roomId || "").trim()}`;
}

function roomMessagesKey(churchId: string, roomId: string) {
  return `${String(churchId || "").trim()}::${String(roomId || "").trim()}`;
}

export function buildDirectRoomId(userIdA: string, userIdB: string) {
  const [a, b] = [normUserId(userIdA), normUserId(userIdB)].sort();
  if (!a || !b) return "";
  if (a === b) return "";
  return `dm:${a}::${b}`;
}

export function isDirectRoomId(roomId: string) {
  const raw = String(roomId || "").trim();
  return raw.startsWith("dm:") || raw.startsWith("dm_");
}

export function parseDirectRoomParticipants(roomId: string): [string, string] | null {
  const raw = String(roomId || "").trim();
  if (raw.startsWith("dm:")) {
    const body = raw.slice(3);
    const parts = body.split("::");
    if (parts.length !== 2) return null;
    const a = parts[0].trim();
    const b = parts[1].trim();
    if (!a || !b) return null;
    return [a, b];
  }

  if (!raw.startsWith("dm_")) return null;
  const body = raw.slice(3);
  const splitAt = body.indexOf("_");
  if (splitAt <= 0) return null;
  const a = body.slice(0, splitAt).trim();
  const b = body.slice(splitAt + 1).trim();
  if (!a || !b) return null;
  return [a, b];
}

export function isParticipantInDirectRoom(roomId: string, userId: string) {
  const participants = parseDirectRoomParticipants(roomId);
  if (!participants) return false;
  const uid = normUserId(userId);
  return participants[0] === uid || participants[1] === uid;
}

async function readThreadStore(): Promise<Record<string, DirectMessageThreadRecord>> {
  const data = await readJsonFile<Record<string, DirectMessageThreadRecord>>(THREADS_STORE_FILE, {});
  return data && typeof data === "object" ? data : {};
}

async function writeThreadStore(data: Record<string, DirectMessageThreadRecord>) {
  await updateJsonFile(THREADS_STORE_FILE, () => data);
}

function formatTimestampLabel(ms: number) {
  if (!ms || !Number.isFinite(ms)) return "";
  const date = new Date(ms);
  const now = new Date();
  const sameDay =
    date.getFullYear() === now.getFullYear() &&
    date.getMonth() === now.getMonth() &&
    date.getDate() === now.getDate();
  if (sameDay) {
    return date.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
  }
  return date.toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

function pickDisplayName(profile: any, fallback = "Kristo member") {
  return String(
    profile?.fullName || profile?.displayName || profile?.name || profile?.email || fallback
  ).trim();
}

function pickAvatar(profile: any) {
  return String(profile?.avatarUrl || profile?.avatarUri || "").trim();
}

async function activeMemberUserIdsForChurch(churchId: string) {
  const rows = await getMembershipsForChurch(churchId, "Active");
  return new Set(rows.map((row) => normUserId(row.userId)).filter(Boolean));
}

export async function assertActiveChurchMember(churchId: string, userId: string) {
  const cid = String(churchId || "").trim();
  const uid = normUserId(userId);
  if (!cid || !uid) return false;
  const active = await activeMemberUserIdsForChurch(cid);
  return active.has(uid);
}

export async function resolveDirectMessagePeerPreview(args: {
  kristoId: string;
  churchId: string;
}): Promise<DirectMessagePeerPreview | null> {
  const kristoId = String(args.kristoId || "").trim().toUpperCase();
  const churchId = String(args.churchId || "").trim();
  if (!kristoId || !churchId) return null;

  const profile = await getProfileByUserCode(kristoId);
  if (!profile?.userId) return null;

  const isMember = await assertActiveChurchMember(churchId, profile.userId);
  if (!isMember) return null;

  const church = await getChurchById(churchId).catch(() => null);
  return {
    userId: profile.userId,
    displayName: pickDisplayName(profile),
    avatarUrl: pickAvatar(profile),
    kristoId: String(profile.userCode || kristoId).trim().toUpperCase(),
    churchId,
    churchName: String(church?.name || church?.churchName || "Church").trim(),
  };
}

export async function openDirectMessageThread(args: {
  viewerUserId: string;
  targetUserId: string;
  churchId: string;
}) {
  const viewerUserId = normUserId(args.viewerUserId);
  const targetUserId = normUserId(args.targetUserId);
  const churchId = String(args.churchId || "").trim();

  if (!viewerUserId || !targetUserId || !churchId) {
    throw new Error("Missing viewer, target, or church.");
  }
  if (viewerUserId === targetUserId) {
    throw new Error("You cannot start a chat with yourself.");
  }

  const [viewerMember, targetMember] = await Promise.all([
    assertActiveChurchMember(churchId, viewerUserId),
    assertActiveChurchMember(churchId, targetUserId),
  ]);

  if (!viewerMember) {
    throw new Error("You must be an active member of this church to start a chat.");
  }
  if (!targetMember) {
    throw new Error("That person is not an active member of this church.");
  }

  const roomId = buildDirectRoomId(viewerUserId, targetUserId);
  if (!roomId) throw new Error("Could not create conversation.");

  const now = Date.now();
  const store = await readThreadStore();
  const key = threadStoreKey(churchId, roomId);
  const existing = store[key];
  const participants = parseDirectRoomParticipants(roomId);
  if (!participants) throw new Error("Invalid conversation id.");

  const record: DirectMessageThreadRecord = existing || {
    roomId,
    churchId,
    participantUserIds: participants,
    createdAt: now,
    updatedAt: now,
    readAtByUserId: {},
  };

  record.updatedAt = Math.max(record.updatedAt, now);
  store[key] = record;
  await writeThreadStore(store);

  const peerProfile = await getProfile(targetUserId).catch(() => null);
  const church = await getChurchById(churchId).catch(() => null);

  return {
    roomId,
    churchId,
    peerUserId: targetUserId,
    title: pickDisplayName(peerProfile),
    subtitle: String(church?.name || church?.churchName || "Direct message").trim(),
    avatarUri: pickAvatar(peerProfile),
  };
}

export async function markDirectMessageThreadRead(args: {
  churchId: string;
  roomId: string;
  userId: string;
}) {
  const churchId = String(args.churchId || "").trim();
  const roomId = String(args.roomId || "").trim();
  const userId = normUserId(args.userId);
  if (!churchId || !roomId || !userId) return false;
  if (!isDirectRoomId(roomId) || !isParticipantInDirectRoom(roomId, userId)) return false;

  const store = await readThreadStore();
  const key = threadStoreKey(churchId, roomId);
  const record = store[key];
  if (!record) return false;

  record.readAtByUserId = {
    ...(record.readAtByUserId || {}),
    [userId]: Date.now(),
  };
  record.updatedAt = Date.now();
  store[key] = record;
  await writeThreadStore(store);
  return true;
}

export async function touchDirectMessageThread(args: {
  churchId: string;
  roomId: string;
  senderUserId: string;
  previewText?: string;
  createdAt?: number;
}) {
  const churchId = String(args.churchId || "").trim();
  const roomId = String(args.roomId || "").trim();
  const senderUserId = normUserId(args.senderUserId);
  if (!churchId || !roomId || !senderUserId || !isDirectRoomId(roomId)) return;

  const participants = parseDirectRoomParticipants(roomId);
  if (!participants) return;

  const now = args.createdAt || Date.now();
  const store = await readThreadStore();
  const key = threadStoreKey(churchId, roomId);
  const record: DirectMessageThreadRecord = store[key] || {
    roomId,
    churchId,
    participantUserIds: participants,
    createdAt: now,
    updatedAt: now,
    readAtByUserId: {},
  };

  record.updatedAt = now;
  record.readAtByUserId = {
    ...(record.readAtByUserId || {}),
    [senderUserId]: now,
  };
  store[key] = record;
  await writeThreadStore(store);
}

async function unreadCountForThread(args: {
  churchId: string;
  roomId: string;
  viewerUserId: string;
  readAt: number;
}) {
  const store = await readRoomMessagesJsonFile<Record<string, any[]>>("room-messages.json", {});
  const rows = Array.isArray(store[roomMessagesKey(args.churchId, args.roomId)])
    ? store[roomMessagesKey(args.churchId, args.roomId)]
    : [];
  const viewerUserId = normUserId(args.viewerUserId);
  const readAt = Number(args.readAt || 0);

  return rows.reduce((count, row) => {
    const senderUserId = normUserId(row?.senderUserId || "");
    const createdAt = Number(row?.createdAt || 0);
    const deletedFor = Array.isArray(row?.deletedFor) ? row.deletedFor.map(String) : [];
    if (!senderUserId || senderUserId === viewerUserId) return count;
    if (deletedFor.includes(viewerUserId)) return count;
    if (createdAt <= readAt) return count;
    return count + 1;
  }, 0);
}

async function lastMessageForThread(churchId: string, roomId: string) {
  const store = await readRoomMessagesJsonFile<Record<string, any[]>>("room-messages.json", {});
  const rows = Array.isArray(store[roomMessagesKey(churchId, roomId)])
    ? store[roomMessagesKey(churchId, roomId)]
    : [];
  const sorted = rows
    .slice()
    .sort((a, b) => Number(b?.createdAt || 0) - Number(a?.createdAt || 0));
  const latest = sorted[0];
  if (!latest) return null;
  return {
    preview: String(latest?.text || "").trim() || (Array.isArray(latest?.attachments) && latest.attachments.length ? "Attachment" : ""),
    timestampMs: Number(latest?.createdAt || 0),
  };
}

export async function listDirectMessageInbox(args: {
  churchId: string;
  viewerUserId: string;
}): Promise<DirectMessageInboxItem[]> {
  const churchId = String(args.churchId || "").trim();
  const viewerUserId = normUserId(args.viewerUserId);
  if (!churchId || !viewerUserId) return [];

  const store = await readThreadStore();
  const threads = Object.values(store).filter(
    (thread) =>
      String(thread?.churchId || "") === churchId &&
      Array.isArray(thread?.participantUserIds) &&
      thread.participantUserIds.includes(viewerUserId)
  );

  const items = await Promise.all(
    threads.map(async (thread) => {
      const peerUserId =
        thread.participantUserIds[0] === viewerUserId
          ? thread.participantUserIds[1]
          : thread.participantUserIds[0];
      const profile = await getProfile(peerUserId).catch(() => null);
      const church = await getChurchById(churchId).catch(() => null);
      const lastMessage = await lastMessageForThread(churchId, thread.roomId);
      const readAt = Number(thread.readAtByUserId?.[viewerUserId] || 0);
      const unreadCount = await unreadCountForThread({
        churchId,
        roomId: thread.roomId,
        viewerUserId,
        readAt,
      });
      const timestampMs = Number(lastMessage?.timestampMs || thread.updatedAt || thread.createdAt || 0);

      return {
        roomId: thread.roomId,
        churchId,
        peerUserId,
        title: pickDisplayName(profile),
        subtitle: String(church?.name || church?.churchName || "Direct message").trim(),
        avatarUri: pickAvatar(profile),
        lastMessagePreview: String(lastMessage?.preview || "No messages yet"),
        timestampLabel: formatTimestampLabel(timestampMs),
        timestampMs,
        unreadCount,
      } satisfies DirectMessageInboxItem;
    })
  );

  return items.sort((a, b) => b.timestampMs - a.timestampMs);
}
