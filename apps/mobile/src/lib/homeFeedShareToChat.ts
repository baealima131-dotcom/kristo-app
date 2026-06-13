import { apiGet, apiPost } from "@/src/lib/kristoApi";
import { isMinistryCreationBlocked } from "@/src/components/ChurchPremiumSubscriptionModal";
import { CHURCH_MEDIA_ROOM_ID } from "@/src/lib/churchMediaRoomRefresh";
import { fetchChurchSubscriptionActive } from "@/src/lib/churchSubscription";
import { getKristoAuth, getKristoHeaders } from "@/src/lib/kristoHeaders";
import { getSessionSync } from "@/src/lib/kristoSession";
import {
  buildSharedContentPayload,
  type HomeFeedSharePayload,
} from "@/src/lib/homeFeedShare";
import {
  ensureThread,
  sendMessage,
  type SharedContentPayload,
} from "@/src/lib/messagesStore";
import { getMinistriesCache, peekMinistriesCache } from "@/src/lib/screenDataCache";

export type ShareToChatRoomKind = "ministry" | "church";
export type ShareToChatRoomSendKind = "ministry" | "church-live-control";

export type ShareToChatRoom = {
  roomId: string;
  ministryId?: string;
  title: string;
  sub: string;
  kind: ShareToChatRoomKind;
  roomKind: ShareToChatRoomSendKind;
  isMember: true;
  canAccess: boolean;
  memberRole?: string;
};

type MinistryRow = {
  id?: string;
  name?: string;
  description?: string;
  memberRole?: string;
  memberStatus?: string;
};

type LiveControlSelfStatus = "Active" | "Suspended";

function isChurchAuthorityRole(role: string): boolean {
  const r = String(role || "").trim().toLowerCase();
  return (
    r.includes("pastor") ||
    r.includes("church_admin") ||
    r.includes("system_admin")
  );
}

function isDemoMinistryRoomId(id: string): boolean {
  return /^m\d+$/i.test(String(id || "").trim());
}

function ministryToShareRoom(ministry: MinistryRow, memberRole?: string): ShareToChatRoom | null {
  const ministryId = String(ministry?.id || "").trim();
  if (!ministryId || isDemoMinistryRoomId(ministryId)) return null;

  const role = String(memberRole || ministry?.memberRole || "Member").trim();
  const title = String(ministry?.name || "Ministry").trim() || "Ministry";
  const description = String(ministry?.description || "").trim();

  return {
    roomId: ministryId,
    ministryId,
    title,
    sub: description || (role ? `${role} • Ministry chat` : "Ministry chat"),
    kind: "ministry",
    roomKind: "ministry",
    isMember: true,
    canAccess: true,
    memberRole: role,
  };
}

function ministriesCacheToShareRooms(items: MinistryRow[]): ShareToChatRoom[] {
  return items
    .filter((m) => {
      const id = String(m?.id || "").trim();
      if (!id || isDemoMinistryRoomId(id)) return false;
      const status = String(m?.memberStatus || "Active").trim();
      return status !== "Suspended";
    })
    .map((m) => ministryToShareRoom(m, m?.memberRole))
    .filter(Boolean) as ShareToChatRoom[];
}

async function fetchLiveControlSelfStatus(viewerId: string): Promise<LiveControlSelfStatus> {
  try {
    const res = await apiGet<any>(
      `/api/church/live-control-members?roomId=${encodeURIComponent(CHURCH_MEDIA_ROOM_ID)}`,
      { headers: getKristoHeaders() as any }
    );

    if (!res || res.ok === false) return "Active";

    const selfStatus = String(res?.self?.liveControlStatus || res?.self?.status || "").trim();
    if (selfStatus === "Suspended" || selfStatus === "Active") {
      return selfStatus;
    }

    const rows = Array.isArray(res?.data) ? res.data : [];
    const mine = rows.find((row: any) => String(row?.userId || "") === viewerId);
    const rowStatus = String(mine?.liveControlStatus || mine?.status || "Active").trim();
    return rowStatus === "Suspended" ? "Suspended" : "Active";
  } catch {
    return "Active";
  }
}

async function resolveChurchLiveControlShareRoom(): Promise<ShareToChatRoom | null> {
  const auth = getKristoAuth();
  const viewerId = String(auth?.userId || "").trim();
  const churchId = String(auth?.churchId || "").trim();
  if (!viewerId || !churchId) return null;

  const role = String(auth?.role || "Member");
  const isAuthority = isChurchAuthorityRole(role);

  const [liveStatus, subscriptionActive] = await Promise.all([
    fetchLiveControlSelfStatus(viewerId),
    fetchChurchSubscriptionActive(
      churchId,
      getKristoHeaders() as Record<string, string>,
      { isPastor: isAuthority }
    ).catch(() => null),
  ]);

  if (liveStatus === "Suspended") return null;
  if (isMinistryCreationBlocked(subscriptionActive)) return null;

  return {
    roomId: CHURCH_MEDIA_ROOM_ID,
    title: "Church Live Control",
    sub: "Whole church assignment room",
    kind: "church",
    roomKind: "church-live-control",
    isMember: true,
    canAccess: true,
    memberRole: isAuthority ? "Pastor" : "Member",
  };
}

async function fetchChurchMinistries(): Promise<MinistryRow[]> {
  const res = await apiGet<any>("/api/church/ministries", {
    headers: getKristoHeaders() as any,
  });
  if (!res?.ok) {
    throw new Error(String(res?.error || "Failed to load ministries"));
  }
  return Array.isArray(res?.data) ? res.data : [];
}

async function fetchMinistryMembers(ministryId: string): Promise<any[]> {
  const res = await apiGet<any>(
    `/api/church/ministry-members?ministryId=${encodeURIComponent(ministryId)}`,
    { headers: getKristoHeaders() as any }
  );
  if (!res?.ok) return [];
  return Array.isArray(res?.data) ? res.data : [];
}

async function resolveShareRoomsFromMinistries(
  ministries: MinistryRow[]
): Promise<ShareToChatRoom[]> {
  const auth = getKristoAuth();
  const viewerId = String(auth?.userId || "").trim();
  const isAuthority = isChurchAuthorityRole(String(auth?.role || ""));

  const resolved = await Promise.all(
    ministries.map(async (ministry) => {
      const ministryId = String(ministry?.id || "").trim();
      if (!ministryId || isDemoMinistryRoomId(ministryId)) return null;

      if (isAuthority) {
        return ministryToShareRoom(ministry, "Pastor");
      }

      const members = await fetchMinistryMembers(ministryId);
      const mine = members.find((row) => {
        const rowUserId = String(row?.userId || "").trim();
        const rowMinistryId = String(row?.ministryId || ministryId).trim();
        return rowUserId === viewerId && rowMinistryId === ministryId;
      });
      if (!mine) return null;

      const status = String(mine?.status || "Active").trim();
      if (status === "Suspended") return null;

      return ministryToShareRoom(ministry, String(mine?.role || "Member"));
    })
  );

  return resolved.filter(Boolean) as ShareToChatRoom[];
}

function combineShareRooms(
  churchRoom: ShareToChatRoom | null,
  ministryRooms: ShareToChatRoom[]
): ShareToChatRoom[] {
  const sortedMinistries = [...ministryRooms].sort((a, b) => a.title.localeCompare(b.title));
  return [...(churchRoom ? [churchRoom] : []), ...sortedMinistries];
}

function logShareToChatRealRooms(
  rooms: ShareToChatRoom[],
  source: string,
  churchRoom: ShareToChatRoom | null
) {
  const ministryRooms = rooms.filter((room) => room.kind === "ministry");
  console.log("KRISTO_SHARE_TO_CHAT_REAL_ROOMS", {
    churchRoomIncluded: Boolean(churchRoom),
    ministryCount: ministryRooms.length,
    total: rooms.length,
    rooms: rooms.map((room) => ({
      roomId: room.roomId,
      title: room.title,
      kind: room.kind,
      canAccess: room.canAccess,
      ministryId: room.ministryId || null,
    })),
    source,
  });
}

/** Church Live Control + real joined ministry rooms (same access rules as My Ministries). */
export async function loadShareToChatRooms(): Promise<ShareToChatRoom[]> {
  const auth = getKristoAuth();
  const viewerId = String(auth?.userId || "").trim();
  const churchId = String(auth?.churchId || "").trim();

  if (!viewerId || !churchId) {
    logShareToChatRealRooms([], "missing_auth", null);
    return [];
  }

  const churchRoom = await resolveChurchLiveControlShareRoom();

  let ministryRooms: ShareToChatRoom[] = [];
  let source = "api_filtered";

  const memoryCache = peekMinistriesCache(churchId, viewerId);
  if (memoryCache?.items?.length) {
    ministryRooms = ministriesCacheToShareRooms(memoryCache.items as MinistryRow[]);
    source = "ministries_cache_memory";
  } else {
    const diskCache = await getMinistriesCache(churchId, viewerId);
    if (diskCache?.items?.length) {
      ministryRooms = ministriesCacheToShareRooms(diskCache.items as MinistryRow[]);
      source = "ministries_cache_disk";
    } else {
      const ministries = await fetchChurchMinistries();
      ministryRooms = await resolveShareRoomsFromMinistries(ministries);
      source = "api_filtered";
    }
  }

  const rooms = combineShareRooms(churchRoom, ministryRooms);
  logShareToChatRealRooms(rooms, source, churchRoom);
  return rooms;
}

export async function sendSharedContentToRoom(
  room: ShareToChatRoom,
  feedPayload: HomeFeedSharePayload,
  sourceItem?: any
): Promise<{ ok: boolean; error?: string }> {
  const roomId = String(room.roomId || room.ministryId || "").trim();
  if (!roomId) return { ok: false, error: "Missing room" };
  if (!room.canAccess) {
    return { ok: false, error: "You do not have access to this chat room." };
  }

  const sharedContent = buildSharedContentPayload(feedPayload, sourceItem);
  const clientId = `share_${Date.now()}_${Math.random().toString(16).slice(2)}`;
  const text = String(feedPayload.title || "Shared post").trim() || "Shared post";
  const session = getSessionSync();
  const senderName = String(session?.displayName || session?.name || "Member").trim() || "Member";

  console.log("KRISTO_SHARED_CONTENT_SEND_START", {
    roomId,
    roomKind: room.roomKind,
    ministryId: room.ministryId || null,
    postId: feedPayload.postId,
    kind: "shared_content",
  });

  try {
    const postRes: any = await apiPost(
      "/api/church/room-messages",
      {
        roomId,
        roomKind: room.roomKind,
        senderName,
        text,
        kind: "shared_content",
        payload: sharedContent,
        sharedContent,
        clientId,
      },
      { headers: getKristoHeaders() as any }
    );

    if (!postRes?.ok) {
      console.log("KRISTO_SHARED_CONTENT_SEND_FAILED", {
        roomId,
        postId: feedPayload.postId,
        error: String(postRes?.error || "Failed to send"),
      });
      return { ok: false, error: String(postRes?.error || "Failed to send shared post") };
    }

    ensureThread(roomId, {
      title: room.title || "Chat",
      sub: room.sub || "",
    });
    sendMessage(
      roomId,
      {
        id: String(postRes?.data?.id || clientId),
        clientId,
        text,
        kind: "shared_content",
        sharedContent,
        senderUserId: String(session?.userId || ""),
        displayName: senderName,
        createdAt: Number(postRes?.data?.createdAt || Date.now()),
      },
      { disableAutoReply: true }
    );

    console.log("KRISTO_SHARED_CONTENT_SEND_SUCCESS", {
      roomId,
      postId: feedPayload.postId,
      messageId: String(postRes?.data?.id || ""),
    });
    return { ok: true };
  } catch (error) {
    const message = String((error as any)?.message || error || "Failed to send");
    console.log("KRISTO_SHARED_CONTENT_SEND_FAILED", {
      roomId,
      postId: feedPayload.postId,
      error: message,
    });
    return { ok: false, error: message };
  }
}

export function resolveSharedContentFromBackendRow(row: any): SharedContentPayload | undefined {
  if (row?.sharedContent && typeof row.sharedContent === "object") {
    return row.sharedContent as SharedContentPayload;
  }
  if (String(row?.kind || "") === "shared_content" && row?.payload && typeof row.payload === "object") {
    return row.payload as SharedContentPayload;
  }
  return undefined;
}
