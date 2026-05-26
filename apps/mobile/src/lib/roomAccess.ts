import AsyncStorage from "@react-native-async-storage/async-storage";
import type { KristoSession } from "./kristoSession";
import { getSessionSnapshot } from "./kristoSessionStore";

export type AccessRoomKind = "church" | "ministry" | "system" | "myway";

export type RoomAccessItem = {
  roomId: string;
  title: string;
  sub: string;
  kind: AccessRoomKind;
  churchId?: string;
  ministryId?: string;
  source?: "base" | "invite" | "command";
  commandCode?: string;
  invitedByUserId?: string;
  invitedUserId?: string;
  country?: string;
  zone?: string;
  region?: string;
  churchName?: string;
  leaderName?: string;
  adminName?: string;
  createdAt: number;
};

const KEY = "kristo.room-access.v1";

const ROLE_BASE_CHURCH_ROOMS: Record<string, Array<{
  roomId: string;
  title: string;
  sub: string;
  kind: "church";
}>> = {
  Member: [
    {
      roomId: "c1",
      title: "My Church",
      sub: "Church members • announcements • updates",
      kind: "church",
    },
    {
      roomId: "c6",
      title: "Prayer Desk",
      sub: "Prayer requests • follow-up • counsel",
      kind: "church",
    },
  ],

  Leader: [
    {
      roomId: "c1",
      title: "My Church",
      sub: "Church members • announcements • updates",
      kind: "church",
    },
    {
      roomId: "c2",
      title: "Leaders Room",
      sub: "Pastor • elders • church admins",
      kind: "church",
    },
    {
      roomId: "c6",
      title: "Prayer Desk",
      sub: "Prayer requests • follow-up • counsel",
      kind: "church",
    },
    {
      roomId: "c7",
      title: "Church Operations",
      sub: "Services • logistics • weekly planning",
      kind: "church",
    },
  ],

  Ministry_Leader: [
    {
      roomId: "c1",
      title: "My Church",
      sub: "Church members • announcements • updates",
      kind: "church",
    },
    {
      roomId: "c2",
      title: "Leaders Room",
      sub: "Pastor • elders • church admins",
      kind: "church",
    },
    {
      roomId: "c3",
      title: "Ministries Admin",
      sub: "All ministry admins • coordination",
      kind: "church",
    },
    {
      roomId: "c6",
      title: "Prayer Desk",
      sub: "Prayer requests • follow-up • counsel",
      kind: "church",
    },
    {
      roomId: "c7",
      title: "Church Operations",
      sub: "Services • logistics • weekly planning",
      kind: "church",
    },
  ],

  Pastor: [
    {
      roomId: "c1",
      title: "My Church",
      sub: "Church members • announcements • updates",
      kind: "church",
    },
    {
      roomId: "c2",
      title: "Leaders Room",
      sub: "Pastor • elders • church admins",
      kind: "church",
    },
    {
      roomId: "c3",
      title: "Ministries Admin",
      sub: "All ministry admins • coordination",
      kind: "church",
    },
    {
      roomId: "c5",
      title: "TLMC & Church",
      sub: "TLMC + local church • shared direction",
      kind: "church",
    },
    {
      roomId: "c6",
      title: "Prayer Desk",
      sub: "Prayer requests • follow-up • counsel",
      kind: "church",
    },
    {
      roomId: "c7",
      title: "Church Operations",
      sub: "Services • logistics • weekly planning",
      kind: "church",
    },
  ],

  Church_Admin: [
    {
      roomId: "c1",
      title: "My Church",
      sub: "Church members • announcements • updates",
      kind: "church",
    },
    {
      roomId: "c2",
      title: "Leaders Room",
      sub: "Pastor • elders • church admins",
      kind: "church",
    },
    {
      roomId: "c3",
      title: "Ministries Admin",
      sub: "All ministry admins • coordination",
      kind: "church",
    },
    {
      roomId: "c5",
      title: "TLMC & Church",
      sub: "TLMC + local church • shared direction",
      kind: "church",
    },
    {
      roomId: "c6",
      title: "Prayer Desk",
      sub: "Prayer requests • follow-up • counsel",
      kind: "church",
    },
    {
      roomId: "c7",
      title: "Church Operations",
      sub: "Services • logistics • weekly planning",
      kind: "church",
    },
  ],

  System_Admin: [
    {
      roomId: "c1",
      title: "My Church",
      sub: "Church members • announcements • updates",
      kind: "church",
    },
    {
      roomId: "c2",
      title: "Leaders Room",
      sub: "Pastor • elders • church admins",
      kind: "church",
    },
    {
      roomId: "c3",
      title: "Ministries Admin",
      sub: "All ministry admins • coordination",
      kind: "church",
    },
    {
      roomId: "c5",
      title: "TLMC & Church",
      sub: "TLMC + local church • shared direction",
      kind: "church",
    },
    {
      roomId: "c6",
      title: "Prayer Desk",
      sub: "Prayer requests • follow-up • counsel",
      kind: "church",
    },
    {
      roomId: "c7",
      title: "Church Operations",
      sub: "Services • logistics • weekly planning",
      kind: "church",
    },
  ],
};

const ROLE_BASE_MINISTRY_ROOMS: Record<string, Array<{
  roomId: string;
  title: string;
  sub: string;
  kind: "ministry";
}>> = {
  Member: [],

  Leader: [
    {
      roomId: "m3",
      title: "Prayer Leaders",
      sub: "Prayer coverage update",
      kind: "ministry",
    },
  ],

  Ministry_Leader: [
    {
      roomId: "m1",
      title: "Senior Leaders",
      sub: "Vision and direction • 8 new",
      kind: "ministry",
    },
    {
      roomId: "m3",
      title: "Prayer Leaders",
      sub: "Prayer coverage update",
      kind: "ministry",
    },
    {
      roomId: "m4",
      title: "Ministry Heads",
      sub: "Operations and movement • 5 new",
      kind: "ministry",
    },
    {
      roomId: "m6",
      title: "Media Leaders",
      sub: "Live stream and media • 2 new",
      kind: "ministry",
    },
    {
      roomId: "m7",
      title: "Youth Leaders",
      sub: "Team follow-up",
      kind: "ministry",
    },
  ],

  Pastor: [
    {
      roomId: "m1",
      title: "Senior Leaders",
      sub: "Vision and direction • 8 new",
      kind: "ministry",
    },
    {
      roomId: "m2",
      title: "Pastors Council",
      sub: "Church planning • 3 new",
      kind: "ministry",
    },
    {
      roomId: "m3",
      title: "Prayer Leaders",
      sub: "Prayer coverage update",
      kind: "ministry",
    },
    {
      roomId: "m4",
      title: "Ministry Heads",
      sub: "Operations and movement • 5 new",
      kind: "ministry",
    },
    {
      roomId: "m5",
      title: "Women Leaders",
      sub: "Sunday coordination",
      kind: "ministry",
    },
    {
      roomId: "m6",
      title: "Media Leaders",
      sub: "Live stream and media • 2 new",
      kind: "ministry",
    },
    {
      roomId: "m7",
      title: "Youth Leaders",
      sub: "Team follow-up",
      kind: "ministry",
    },
    {
      roomId: "m8",
      title: "Protocol Leaders",
      sub: "Guest reception planning",
      kind: "ministry",
    },
  ],

  Church_Admin: [
    {
      roomId: "m1",
      title: "Senior Leaders",
      sub: "Vision and direction • 8 new",
      kind: "ministry",
    },
    {
      roomId: "m2",
      title: "Pastors Council",
      sub: "Church planning • 3 new",
      kind: "ministry",
    },
    {
      roomId: "m3",
      title: "Prayer Leaders",
      sub: "Prayer coverage update",
      kind: "ministry",
    },
    {
      roomId: "m4",
      title: "Ministry Heads",
      sub: "Operations and movement • 5 new",
      kind: "ministry",
    },
    {
      roomId: "m5",
      title: "Women Leaders",
      sub: "Sunday coordination",
      kind: "ministry",
    },
    {
      roomId: "m6",
      title: "Media Leaders",
      sub: "Live stream and media • 2 new",
      kind: "ministry",
    },
    {
      roomId: "m7",
      title: "Youth Leaders",
      sub: "Team follow-up",
      kind: "ministry",
    },
    {
      roomId: "m8",
      title: "Protocol Leaders",
      sub: "Guest reception planning",
      kind: "ministry",
    },
  ],

  System_Admin: [
    {
      roomId: "m1",
      title: "Senior Leaders",
      sub: "Vision and direction • 8 new",
      kind: "ministry",
    },
    {
      roomId: "m2",
      title: "Pastors Council",
      sub: "Church planning • 3 new",
      kind: "ministry",
    },
    {
      roomId: "m3",
      title: "Prayer Leaders",
      sub: "Prayer coverage update",
      kind: "ministry",
    },
    {
      roomId: "m4",
      title: "Ministry Heads",
      sub: "Operations and movement • 5 new",
      kind: "ministry",
    },
    {
      roomId: "m5",
      title: "Women Leaders",
      sub: "Sunday coordination",
      kind: "ministry",
    },
    {
      roomId: "m6",
      title: "Media Leaders",
      sub: "Live stream and media • 2 new",
      kind: "ministry",
    },
    {
      roomId: "m7",
      title: "Youth Leaders",
      sub: "Team follow-up",
      kind: "ministry",
    },
    {
      roomId: "m8",
      title: "Protocol Leaders",
      sub: "Guest reception planning",
      kind: "ministry",
    },
  ],
};

function normalize(items: RoomAccessItem[]) {
  return Array.from(
    new Map(
      (items || []).map((item) => [
        String(item.roomId || "").trim(),
        {
          ...item,
          roomId: String(item.roomId || "").trim(),
          title: String(item.title || "").trim(),
          sub: String(item.sub || "").trim(),
          kind: (item.kind || "church") as AccessRoomKind,
          churchId: item.churchId ? String(item.churchId) : undefined,
          ministryId: item.ministryId ? String(item.ministryId) : undefined,
          source: (item.source || "invite") as "base" | "invite" | "command",
          commandCode: item.commandCode ? String(item.commandCode) : undefined,
          invitedByUserId: item.invitedByUserId ? String(item.invitedByUserId) : undefined,
          invitedUserId: item.invitedUserId ? String(item.invitedUserId) : undefined,
          country: item.country ? String(item.country) : undefined,
          zone: item.zone ? String(item.zone) : undefined,
          region: item.region ? String(item.region) : undefined,
          churchName: item.churchName ? String(item.churchName) : undefined,
          leaderName: item.leaderName ? String(item.leaderName) : undefined,
          adminName: item.adminName ? String(item.adminName) : undefined,
          createdAt: Number(item.createdAt || Date.now()),
        } satisfies RoomAccessItem,
      ])
    ).values()
  ).filter((x) => x.roomId);
}

export async function loadRoomAccess(): Promise<RoomAccessItem[]> {
  try {
    const raw = await AsyncStorage.getItem(KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return normalize(parsed as RoomAccessItem[]);
  } catch {
    return [];
  }
}

export async function saveRoomAccess(items: RoomAccessItem[]): Promise<void> {
  const clean = normalize(items);
  try {
    await AsyncStorage.setItem(KEY, JSON.stringify(clean));
  } catch {}
}

export async function grantRoomAccess(item: RoomAccessItem): Promise<RoomAccessItem[]> {
  const current = await loadRoomAccess();
  const next = normalize([...current, item]);
  await saveRoomAccess(next);
  return next;
}

export async function revokeRoomAccess(roomId: string): Promise<RoomAccessItem[]> {
  const current = await loadRoomAccess();
  const next = current.filter((x) => String(x.roomId) !== String(roomId));
  await saveRoomAccess(next);
  return next;
}

export async function clearRoomAccess(): Promise<void> {
  try {
    await AsyncStorage.removeItem(KEY);
  } catch {}
}

export async function ensureBaseChurchAccess(session?: KristoSession | null): Promise<RoomAccessItem[]> {
  const s = session || getSessionSnapshot();
  const churchId = String(s?.churchId || "").trim();
  const role = String(s?.role || "Member").trim();

  if (!churchId) {
    const existing = await loadRoomAccess();
    return existing;
  }

  const existing = await loadRoomAccess();

  const allowedChurchRooms = ROLE_BASE_CHURCH_ROOMS[role] || ROLE_BASE_CHURCH_ROOMS.Member || [];
  const allowedMinistryRooms = ROLE_BASE_MINISTRY_ROOMS[role] || ROLE_BASE_MINISTRY_ROOMS.Member || [];

  const preservedExisting = existing.filter((item) => {
    const sameChurch = String(item.churchId || "") === churchId;
    if (!sameChurch) return true
    if (item.source !== "base") return true

    const allowedIds = new Set([
      ...allowedChurchRooms.map((x) => String(x.roomId)),
      ...allowedMinistryRooms.map((x) => String(x.roomId)),
    ])

    return allowedIds.has(String(item.roomId || ""))
  });

  const baseChurchItems: RoomAccessItem[] = allowedChurchRooms.map((room) => ({
    roomId: room.roomId,
    title: room.title,
    sub: room.sub,
    kind: room.kind,
    churchId,
    source: "base",
    createdAt: Date.now(),
  }));

  const baseMinistryItems: RoomAccessItem[] = allowedMinistryRooms.map((room) => ({
    roomId: room.roomId,
    title: room.title,
    sub: room.sub,
    kind: room.kind,
    churchId,
    ministryId: room.roomId,
    source: "base",
    createdAt: Date.now(),
  }));

  const next = normalize([...preservedExisting, ...baseChurchItems, ...baseMinistryItems]);
  await saveRoomAccess(next);
  return next;
}

export async function hasRoomAccess(roomId: string): Promise<boolean> {
  const items = await loadRoomAccess();
  return items.some((x) => String(x.roomId) === String(roomId));
}

export async function getChurchRoomAccess(churchId?: string): Promise<RoomAccessItem[]> {
  const items = await loadRoomAccess();
  const cid = String(churchId || getSessionSnapshot()?.churchId || "").trim();

  if (!cid) {
    return items.filter((x) => x.kind === "church");
  }

  return items.filter(
    (x) => x.kind === "church" && String(x.churchId || "") === cid
  );
}

export async function getMinistryRoomAccess(churchId?: string): Promise<RoomAccessItem[]> {
  const items = await loadRoomAccess();
  const cid = String(churchId || getSessionSnapshot()?.churchId || "").trim();

  if (!cid) {
    return items.filter((x) => x.kind === "ministry");
  }

  return items.filter(
    (x) => x.kind === "ministry" && String(x.churchId || "") === cid
  );
}

export function makeInviteRoomAccess(input: {
  roomId: string;
  title: string;
  sub: string;
  kind?: AccessRoomKind;
  churchId?: string;
  ministryId?: string;
  commandCode?: string;
}): RoomAccessItem {
  return {
    roomId: String(input.roomId || "").trim(),
    title: String(input.title || "").trim(),
    sub: String(input.sub || "").trim(),
    kind: (input.kind || "church") as AccessRoomKind,
    churchId: input.churchId ? String(input.churchId) : undefined,
    ministryId: input.ministryId ? String(input.ministryId) : undefined,
    commandCode: input.commandCode ? String(input.commandCode) : undefined,
    source: input.commandCode ? "command" : "invite",
    createdAt: Date.now(),
  };
}

export async function getMyWayAccess(userId?: string): Promise<RoomAccessItem | null> {
  const currentUserId = String(userId || getSessionSnapshot()?.userId || "").trim();
  if (!currentUserId) return null;

  const items = await loadRoomAccess();
  const match = items
    .filter(
      (item) =>
        item.kind === "myway" &&
        String(item.roomId || "").trim() === "myway" &&
        (
          String(item.invitedUserId || "").trim() === currentUserId ||
          String(item.churchId || "").trim() === String(getSessionSnapshot()?.churchId || "").trim()
        )
    )
    .sort((a, b) => Number(b.createdAt || 0) - Number(a.createdAt || 0))[0];

  return match || null;
}

export async function grantMyWayAccess(input: {
  invitedUserId?: string;
  invitedByUserId?: string;
  commandCode: string;
  churchId?: string;
  country?: string;
  zone?: string;
  region?: string;
  churchName?: string;
  leaderName?: string;
  adminName?: string;
}): Promise<RoomAccessItem[]> {
  const item: RoomAccessItem = {
    roomId: "myway",
    title: "My Way",
    sub: "Invitation accepted • command ready",
    kind: "myway",
    churchId: input.churchId ? String(input.churchId) : undefined,
    source: "invite",
    commandCode: String(input.commandCode || "").trim().toUpperCase(),
    invitedUserId: input.invitedUserId ? String(input.invitedUserId) : undefined,
    invitedByUserId: input.invitedByUserId ? String(input.invitedByUserId) : undefined,
    country: input.country ? String(input.country) : undefined,
    zone: input.zone ? String(input.zone) : undefined,
    region: input.region ? String(input.region) : undefined,
    churchName: input.churchName ? String(input.churchName) : undefined,
    leaderName: input.leaderName ? String(input.leaderName) : undefined,
    adminName: input.adminName ? String(input.adminName) : undefined,
    createdAt: Date.now(),
  };

  const current = await loadRoomAccess();
  const next = normalize([
    ...current.filter(
      (x) => !(x.kind === "myway" && String(x.roomId || "") === "myway")
    ),
    item,
  ]);
  await saveRoomAccess(next);
  return next;
}

export async function revokeMyWayAccess(): Promise<RoomAccessItem[]> {
  const current = await loadRoomAccess();
  const next = current.filter(
    (x) => !(x.kind === "myway" && String(x.roomId || "") === "myway")
  );
  await saveRoomAccess(next);
  return next;
}
