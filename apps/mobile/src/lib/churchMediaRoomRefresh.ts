import { apiGet } from "@/src/lib/kristoApi";
import {
  CHURCH_MEDIA_ROOM_REFRESH_MS,
  getLiveControlMembersCache,
  getMcHostsCache,
  getRoomMessagesCache,
  isChurchMediaRoomCacheFresh,
  liveControlMembersRawSignature,
  mcHostsSignature,
  peekLiveControlMembersCache,
  peekMcHostsCache,
  peekRoomMessagesCache,
  roomMessagesRawSignature,
  saveLiveControlMembersCache,
  saveMcHostsCache,
  saveRoomMessagesCache,
} from "@/src/lib/churchMediaRoomCache";
import { setCachedParticipant } from "@/src/lib/liveRealtime";

export { CHURCH_MEDIA_ROOM_REFRESH_MS };

export const CHURCH_MEDIA_ROOM_ID = "church-media-room";

type SkipReason = "inflight" | "recent" | "cache-hit" | "cache-fresh";

export type RoomMessagesRefreshResult = {
  skipped: boolean;
  reason?: SkipReason;
  rawRows: any[];
};

export type LiveControlMembersRefreshResult = {
  skipped: boolean;
  reason?: SkipReason;
  rawRows: any[];
};

export type McHostsRefreshResult = {
  skipped: boolean;
  reason?: SkipReason;
  hostUserIds: string[];
};

const roomMessagesInflight = new Map<string, Promise<RoomMessagesRefreshResult>>();
const roomMessagesLastAt = new Map<string, number>();

const liveControlInflight = new Map<string, Promise<LiveControlMembersRefreshResult>>();
const liveControlLastAt = new Map<string, number>();

const mcHostsInflight = new Map<string, Promise<McHostsRefreshResult>>();
const mcHostsLastAt = new Map<string, number>();

function inflightKey(kind: string, churchId: string, userId: string, scopeId: string) {
  return `${kind}:${String(churchId || "").trim().toUpperCase()}:${String(userId || "").trim()}:${String(scopeId || "").trim()}`;
}

export function logMediaRoomRefreshSkipped(
  endpoint: string,
  reason: SkipReason,
  extra?: Record<string, unknown>
) {
  console.log("KRISTO_MEDIA_ROOM_REFRESH_SKIPPED", { endpoint, reason, ...(extra || {}) });
}

export function logMediaRoomCacheHit(endpoint: string, extra?: Record<string, unknown>) {
  console.log("KRISTO_MEDIA_ROOM_CACHE_HIT", { endpoint, ...(extra || {}) });
}

function filterVisibleRoomMessageRows(rows: any[]) {
  return (Array.isArray(rows) ? rows : []).filter((x: any) => {
    const isDraftCard =
      String(x?.kind || "") === "assignment_card" &&
      String(x?.card?.visibility || "published") === "draft";
    return !isDraftCard;
  });
}

function normalizeMcHostIds(ids: any[]) {
  return (Array.isArray(ids) ? ids : [])
    .map((x: any) => String(x || "").trim())
    .filter((x: string) => x.startsWith("u_"))
    .filter((x: string, index: number, arr: string[]) => arr.indexOf(x) === index)
    .slice(0, 2);
}

export async function refreshRoomMessagesIfNeeded(args: {
  churchId: string;
  userId: string;
  roomId: string;
  headers: Record<string, string>;
  force?: boolean;
  cacheFresh?: boolean;
  source?: string;
}): Promise<RoomMessagesRefreshResult> {
  const churchId = String(args.churchId || "").trim();
  const userId = String(args.userId || "").trim();
  const roomId = String(args.roomId || "").trim();
  const key = inflightKey("room-messages", churchId, userId, roomId);

  if (!churchId || !userId || !roomId) {
    return { skipped: true, reason: "cache-hit", rawRows: [] };
  }

  if (!args.force && args.cacheFresh) {
    const peek = peekRoomMessagesCache(churchId, userId, roomId);
    if (peek) {
      logMediaRoomCacheHit("/api/church/room-messages", { roomId, source: args.source });
      logMediaRoomRefreshSkipped("/api/church/room-messages", "cache-fresh", {
        roomId,
        source: args.source,
      });
      return { skipped: true, reason: "cache-fresh", rawRows: peek.rawRows as any[] };
    }
  }

  const inflight = roomMessagesInflight.get(key);
  if (inflight) {
    logMediaRoomRefreshSkipped("/api/church/room-messages", "inflight", { roomId, source: args.source });
    return inflight;
  }

  const cached = peekRoomMessagesCache(churchId, userId, roomId);
  const since = Date.now() - Number(roomMessagesLastAt.get(key) || cached?.updatedAt || 0);
  if (!args.force && cached && (since < CHURCH_MEDIA_ROOM_REFRESH_MS || args.cacheFresh)) {
    logMediaRoomCacheHit("/api/church/room-messages", { roomId, sinceLastMs: since, source: args.source });
    logMediaRoomRefreshSkipped("/api/church/room-messages", "recent", { roomId, sinceLastMs: since, source: args.source });
    return { skipped: true, reason: "recent", rawRows: cached.rawRows as any[] };
  }

  const job = (async (): Promise<RoomMessagesRefreshResult> => {
    const res: any = await apiGet(
      `/api/church/room-messages?roomId=${encodeURIComponent(roomId)}&limit=120`,
      { headers: args.headers },
      {
        screen: "ChurchMediaRoomRefresh",
        throttleMs: args.force ? 0 : CHURCH_MEDIA_ROOM_REFRESH_MS,
      }
    );

    const rows = filterVisibleRoomMessageRows(Array.isArray(res?.data) ? res.data : []);
    const sig = roomMessagesRawSignature(rows);
    const prevSig = cached ? roomMessagesRawSignature(cached.rawRows as any[]) : "";

    await saveRoomMessagesCache({
      churchId,
      userId,
      roomId,
      rawRows: rows,
      updatedAt: Date.now(),
    });
    roomMessagesLastAt.set(key, Date.now());

    return {
      skipped: Boolean(cached) && sig === prevSig && !args.force,
      reason: cached && sig === prevSig ? "cache-hit" : undefined,
      rawRows: rows,
    };
  })();

  roomMessagesInflight.set(key, job);
  try {
    return await job;
  } finally {
    roomMessagesInflight.delete(key);
  }
}

export async function refreshLiveControlMembersIfNeeded(args: {
  churchId: string;
  userId: string;
  roomId: string;
  headers: Record<string, string>;
  force?: boolean;
  cacheFresh?: boolean;
  source?: string;
}): Promise<LiveControlMembersRefreshResult> {
  const churchId = String(args.churchId || "").trim();
  const userId = String(args.userId || "").trim();
  const roomId = String(args.roomId || CHURCH_MEDIA_ROOM_ID).trim();
  const key = inflightKey("live-control-members", churchId, userId, roomId);

  if (!churchId || !userId || !roomId) {
    return { skipped: true, reason: "cache-hit", rawRows: [] };
  }

  if (!args.force && args.cacheFresh) {
    const peek = peekLiveControlMembersCache(churchId, userId, roomId);
    if (peek) {
      logMediaRoomCacheHit("/api/church/live-control-members", { roomId, source: args.source });
      logMediaRoomRefreshSkipped("/api/church/live-control-members", "cache-fresh", {
        roomId,
        source: args.source,
      });
      return { skipped: true, reason: "cache-fresh", rawRows: peek.rawRows as any[] };
    }
  }

  const inflight = liveControlInflight.get(key);
  if (inflight) {
    logMediaRoomRefreshSkipped("/api/church/live-control-members", "inflight", { roomId, source: args.source });
    return inflight;
  }

  const cached = peekLiveControlMembersCache(churchId, userId, roomId);
  const since = Date.now() - Number(liveControlLastAt.get(key) || cached?.updatedAt || 0);
  if (!args.force && cached && (since < CHURCH_MEDIA_ROOM_REFRESH_MS || args.cacheFresh)) {
    logMediaRoomCacheHit("/api/church/live-control-members", { roomId, sinceLastMs: since, source: args.source });
    logMediaRoomRefreshSkipped("/api/church/live-control-members", "recent", {
      roomId,
      sinceLastMs: since,
      source: args.source,
    });
    return { skipped: true, reason: "recent", rawRows: cached.rawRows as any[] };
  }

  const job = (async (): Promise<LiveControlMembersRefreshResult> => {
    const res: any = await apiGet(
      `/api/church/live-control-members?roomId=${encodeURIComponent(roomId)}`,
      {
        headers: {
          ...args.headers,
          "x-kristo-role": "Pastor",
        },
      },
      {
        screen: "ChurchMediaRoomRefresh",
        throttleMs: args.force ? 0 : CHURCH_MEDIA_ROOM_REFRESH_MS,
      }
    );

    const rows = Array.isArray(res?.data)
      ? res.data
      : Array.isArray(res?.members)
        ? res.members
        : Array.isArray(res)
          ? res
          : [];

    const sig = liveControlMembersRawSignature(rows);
    const prevSig = cached ? liveControlMembersRawSignature(cached.rawRows as any[]) : "";

    await saveLiveControlMembersCache({
      churchId,
      userId,
      roomId,
      rawRows: rows,
      updatedAt: Date.now(),
    });
    liveControlLastAt.set(key, Date.now());

    return {
      skipped: Boolean(cached) && sig === prevSig && !args.force,
      reason: cached && sig === prevSig ? "cache-hit" : undefined,
      rawRows: rows,
    };
  })();

  liveControlInflight.set(key, job);
  try {
    return await job;
  } finally {
    liveControlInflight.delete(key);
  }
}

export async function refreshMcHostsIfNeeded(args: {
  churchId: string;
  userId: string;
  assignmentId: string;
  headers: Record<string, string>;
  force?: boolean;
  cacheFresh?: boolean;
  source?: string;
  cacheKey?: string;
}): Promise<McHostsRefreshResult> {
  const churchId = String(args.churchId || "").trim();
  const userId = String(args.userId || "").trim();
  const assignmentId = String(args.assignmentId || CHURCH_MEDIA_ROOM_ID).trim();
  const key = inflightKey("mc-hosts", churchId, userId, assignmentId);
  const participantCacheKey = String(args.cacheKey || `mc-hosts:${assignmentId}`).trim();

  if (!churchId || !userId || !assignmentId) {
    return { skipped: true, reason: "cache-hit", hostUserIds: [] };
  }

  if (!args.force && args.cacheFresh) {
    const peek = peekMcHostsCache(churchId, userId, assignmentId);
    if (peek) {
      setCachedParticipant(participantCacheKey, peek.hostUserIds);
      logMediaRoomCacheHit("/api/church/mc-hosts", { assignmentId, source: args.source });
      logMediaRoomRefreshSkipped("/api/church/mc-hosts", "cache-fresh", {
        assignmentId,
        source: args.source,
      });
      return { skipped: true, reason: "cache-fresh", hostUserIds: peek.hostUserIds };
    }
  }

  const inflight = mcHostsInflight.get(key);
  if (inflight) {
    logMediaRoomRefreshSkipped("/api/church/mc-hosts", "inflight", { assignmentId, source: args.source });
    return inflight;
  }

  const cached = peekMcHostsCache(churchId, userId, assignmentId);
  const since = Date.now() - Number(mcHostsLastAt.get(key) || cached?.updatedAt || 0);
  if (!args.force && cached && (since < CHURCH_MEDIA_ROOM_REFRESH_MS || args.cacheFresh)) {
    setCachedParticipant(participantCacheKey, cached.hostUserIds);
    logMediaRoomCacheHit("/api/church/mc-hosts", { assignmentId, sinceLastMs: since, source: args.source });
    logMediaRoomRefreshSkipped("/api/church/mc-hosts", "recent", {
      assignmentId,
      sinceLastMs: since,
      source: args.source,
    });
    return { skipped: true, reason: "recent", hostUserIds: cached.hostUserIds };
  }

  const job = (async (): Promise<McHostsRefreshResult> => {
    const res: any = await apiGet(
      `/api/church/mc-hosts?assignmentId=${encodeURIComponent(assignmentId)}`,
      { headers: { ...args.headers, "x-kristo-role": "Member" } },
      {
        screen: "ChurchMediaRoomRefresh",
        throttleMs: args.force ? 0 : CHURCH_MEDIA_ROOM_REFRESH_MS,
      }
    );

    const hostUserIds = normalizeMcHostIds(
      Array.isArray(res?.data?.hostUserIds) ? res.data.hostUserIds : []
    );

    const sig = mcHostsSignature(hostUserIds);
    const prevSig = cached ? mcHostsSignature(cached.hostUserIds) : "";

    await saveMcHostsCache({
      churchId,
      userId,
      assignmentId,
      hostUserIds,
      updatedAt: Date.now(),
    });
    mcHostsLastAt.set(key, Date.now());
    setCachedParticipant(participantCacheKey, hostUserIds);

    return {
      skipped: Boolean(cached) && sig === prevSig && !args.force,
      reason: cached && sig === prevSig ? "cache-hit" : undefined,
      hostUserIds,
    };
  })();

  mcHostsInflight.set(key, job);
  try {
    return await job;
  } finally {
    mcHostsInflight.delete(key);
  }
}

export function mapLiveControlBoardPeople(
  rows: any[],
  targetMinistryId: string,
  threadId: string,
  assignmentId: string
) {
  const apiBase = String(process.env.EXPO_PUBLIC_API_BASE || "http://localhost:3000").replace(/\/$/, "");

  return (Array.isArray(rows) ? rows : []).map((x: any, index: number) => {
    const rawAvatar = String(x.avatarUrl || x.avatarUri || x.profileImage || "").trim();
    const avatarUri =
      rawAvatar.startsWith("/") ? `${apiBase}${rawAvatar}` : rawAvatar;

    const roleRaw = String(x.role || "Member");
    const role =
      /pastor/i.test(roleRaw)
        ? "Pastor"
        : /^leader$/i.test(roleRaw) || /assistant/i.test(roleRaw)
          ? "Leader"
          : /host/i.test(roleRaw)
            ? "Host"
            : /admin/i.test(roleRaw)
              ? "Leader"
              : "Member";

    const ministryMemberId = String(x.id || "").trim();
    const userId = String(x.userId || "").trim();

    return {
      id: ministryMemberId.startsWith("mm_") ? ministryMemberId : userId || `real_${index}`,
      ministryMemberId: ministryMemberId.startsWith("mm_") ? ministryMemberId : "",
      ministryId: String(x.ministryId || targetMinistryId || assignmentId || threadId || ""),
      userId,
      name: String(x.displayName || x.fullName || x.name || x.userId || "Member"),
      role,
      status: /paused|suspended/i.test(String(x.status || "")) ? "Suspended" : "Active",
      note:
        role === "Leader"
          ? "Ministry leader"
          : role === "Host"
            ? "Ministry host"
            : "Ministry member",
      avatarUri,
    };
  });
}

export async function preloadChurchMediaRoom(args: {
  churchId: string;
  userId: string;
  headers: Record<string, string>;
}) {
  const churchId = String(args.churchId || "").trim();
  const userId = String(args.userId || "").trim();
  if (!churchId || !userId) return;

  console.log("KRISTO_MEDIA_ROOM_PRELOAD_START", { churchId, userId });

  const roomId = CHURCH_MEDIA_ROOM_ID;
  const assignmentId = CHURCH_MEDIA_ROOM_ID;

  const msgsPeek = peekRoomMessagesCache(churchId, userId, roomId);
  const livePeek = peekLiveControlMembersCache(churchId, userId, roomId);
  const hostsPeek = peekMcHostsCache(churchId, userId, assignmentId);

  const msgsFresh = Boolean(msgsPeek && isChurchMediaRoomCacheFresh(msgsPeek.updatedAt));
  const liveFresh = Boolean(livePeek && isChurchMediaRoomCacheFresh(livePeek.updatedAt));
  const hostsFresh = Boolean(hostsPeek && isChurchMediaRoomCacheFresh(hostsPeek.updatedAt));

  await Promise.all([
    refreshRoomMessagesIfNeeded({
      churchId,
      userId,
      roomId,
      headers: args.headers,
      cacheFresh: msgsFresh,
      source: "tab-preload",
    }),
    refreshLiveControlMembersIfNeeded({
      churchId,
      userId,
      roomId,
      headers: args.headers,
      cacheFresh: liveFresh,
      source: "tab-preload",
    }),
    refreshMcHostsIfNeeded({
      churchId,
      userId,
      assignmentId,
      headers: args.headers,
      cacheFresh: hostsFresh,
      source: "tab-preload",
      cacheKey: `mc-hosts:${assignmentId}`,
    }),
  ]);

  console.log("KRISTO_MEDIA_ROOM_PRELOAD_DONE", {
    churchId,
    userId,
    roomId,
    msgsFresh,
    liveFresh,
    hostsFresh,
  });
}
