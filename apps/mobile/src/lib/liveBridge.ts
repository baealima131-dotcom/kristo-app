import { apiPatch } from "@/src/lib/kristoApi";

export type LiveRequestPolicy = "auto" | "approval" | "invite" | "members" | "locked";

export type LiveJoinRequest = {
  name: string;
  avatar: string;
  approved: boolean;
  onStage?: boolean;
  waiting?: boolean;
  joinedAt?: string;
  userId?: string;
  role?: string;
  claimNumber?: number;
  seatType?: "viewer" | "moderator" | "mic-only" | "camera-mic" | "big-screen";
};

type LiveSeatType = LiveJoinRequest["seatType"];

function resolveSeatType(slot: number): Exclude<LiveSeatType, undefined> {
  if (slot === 1) return "big-screen";
  if (slot >= 2 && slot <= 5) return "camera-mic";
  if (slot >= 6 && slot <= 9) return "mic-only";
  return "viewer";
}

export function getLiveJoinBridge() {
  const g = globalThis as any;
  if (!g.__kristoLiveJoinBridge) {
    g.__kristoLiveJoinBridge = {
      requestsByLiveId: {} as Record<string, Record<number, LiveJoinRequest>>,
      policiesByLiveId: {} as Record<string, LiveRequestPolicy>,
      endedByLiveId: {} as Record<string, boolean>,
      listeners: new Set<() => void>(),
    };
  }
  return g.__kristoLiveJoinBridge as {
    requestsByLiveId: Record<string, Record<number, LiveJoinRequest>>;
    policiesByLiveId: Record<string, LiveRequestPolicy>;
    endedByLiveId: Record<string, boolean>;
    listeners: Set<() => void>;
  };
}

export function publishLiveEnded(liveId: string) {
  const bridge = getLiveJoinBridge();
  bridge.endedByLiveId[liveId] = true;
  bridge.requestsByLiveId[liveId] = {};
  bridge.listeners.forEach((fn) => {
    try {
      fn();
    } catch {}
  });
}

export function publishLivePolicy(liveId: string, policy: LiveRequestPolicy) {
  const bridge = getLiveJoinBridge();
  bridge.policiesByLiveId[liveId] = policy;
  bridge.listeners.forEach((fn) => {
    try {
      fn();
    } catch {}
  });
}

export function publishLiveJoin(liveId: string, slot: number, req: LiveJoinRequest) {
  const bridge = getLiveJoinBridge();
  const seatType = resolveSeatType(slot);

  bridge.requestsByLiveId[liveId] = {
    ...(bridge.requestsByLiveId[liveId] || {}),
    [slot]: {
      ...req,
      claimNumber: slot,
      seatType,
    },
  };

  bridge.listeners.forEach((fn) => {
    try {
      fn();
    } catch {}
  });
}

export function subscribeLiveJoin(fn: () => void) {
  const bridge = getLiveJoinBridge();
  bridge.listeners.add(fn);
  return () => {
    bridge.listeners.delete(fn);
  };
}

export async function persistClaimToLiveRequest(opts: {
  liveId: string;
  slotId: string;
  slot?: number;
  userId: string;
  name: string;
  avatar: string;
  headers: Record<string, string>;
}) {
  console.log("KRISTO_CLAIM_TO_LIVE_REQUEST", {
    liveId: opts.liveId,
    slotId: opts.slotId,
    slot: opts.slot ?? null,
    userId: opts.userId,
    name: opts.name,
  });

  try {
    const res: any = await apiPatch(
      "/api/church/live",
      {
        action: "claim-schedule-request",
        liveId: opts.liveId,
        slotId: opts.slotId,
        slot: opts.slot,
        userId: opts.userId,
        name: opts.name,
        avatar: opts.avatar,
        status: "waiting",
      },
      { headers: opts.headers as any }
    );

    console.log("KRISTO_LIVE_REQUEST_PERSISTED", {
      liveId: opts.liveId,
      slotId: opts.slotId,
      userId: opts.userId,
      ok: res?.ok !== false,
      requestKeys: res?.live?.requests ? Object.keys(res.live.requests) : [],
    });

    return res;
  } catch (error) {
    console.log("KRISTO_LIVE_REQUEST_PERSISTED", {
      liveId: opts.liveId,
      slotId: opts.slotId,
      userId: opts.userId,
      ok: false,
      error: String((error as any)?.message || error),
    });
    throw error;
  }
}

export function clearLiveBridgeClaim(liveId: string, opts?: { slot?: number; slotId?: string; userId?: string }) {
  const bridge = getLiveJoinBridge();
  const requests = bridge.requestsByLiveId[liveId] as Record<string, LiveJoinRequest> | undefined;
  if (!requests) return;

  const slotId = String(opts?.slotId || "").trim();
  const userId = String(opts?.userId || "").trim();
  const slotNum = Number(opts?.slot || 0);

  for (const [key, req] of Object.entries(requests)) {
    const matchesUser = !userId || String(req?.userId || "").trim() === userId;
    const matchesSlot = !slotNum || Number(key) === slotNum;
    const matchesSlotId = !slotId || String((req as any)?.slotId || "").trim() === slotId;
    if (matchesUser && matchesSlot && matchesSlotId) {
      delete requests[key];
    }
  }
}

export async function persistClaimDeleteToBackend(opts: {
  feedId: string;
  slotId: string;
  userId: string;
  liveId: string;
  headers: Record<string, string>;
}) {
  const feedId = String(opts.feedId || "").trim();
  const slotId = String(opts.slotId || "").trim();
  const userId = String(opts.userId || "").trim();
  const liveId = String(opts.liveId || "").trim();

  clearLiveBridgeClaim(liveId, { slotId, userId });

  try {
    await apiPatch(
      "/api/church/feed",
      {
        action: "unclaim_schedule_slot",
        postId: feedId,
        feedId,
        slotId,
        userId,
      },
      { headers: opts.headers as any }
    );
  } catch (error) {
    console.log("KRISTO_CLAIM_DELETE_FEED_UNCLAIM_ERROR", {
      feedId,
      slotId,
      userId,
      error: String((error as any)?.message || error),
    });
  }

  try {
    const res: any = await apiPatch(
      "/api/church/live",
      {
        action: "clear-claim-request",
        liveId,
        slotId,
        userId,
      },
      { headers: opts.headers as any }
    );

    console.log("KRISTO_CLAIM_DELETE_LIVE_REQUEST_CLEARED", {
      liveId,
      slotId,
      userId,
      ok: res?.ok !== false,
      requestKeys: res?.live?.requests ? Object.keys(res.live.requests) : [],
    });

    return res;
  } catch (error) {
    console.log("KRISTO_CLAIM_DELETE_LIVE_REQUEST_CLEARED", {
      liveId,
      slotId,
      userId,
      ok: false,
      error: String((error as any)?.message || error),
    });
    throw error;
  }
}

export async function syncClaimedMemberToLiveRoom(opts: {
  liveId: string;
  slot: number;
  slotId?: string;
  userId: string;
  name: string;
  avatar: string;
  role?: string;
  pushLiveAction: (action: string, body: Record<string, any>) => Promise<any>;
}) {
  const joinedAt = new Date().toISOString();

  console.log("KRISTO_CLAIM_ROOM_SYNC_START", {
    liveId: opts.liveId,
    slot: opts.slot,
    userId: opts.userId,
    name: opts.name,
  });

  publishLiveJoin(opts.liveId, opts.slot, {
    name: opts.name,
    avatar: opts.avatar,
    approved: false,
    onStage: false,
    waiting: true,
    userId: opts.userId,
    role: opts.role || "Member",
    joinedAt,
  });

  try {
    const res = await opts.pushLiveAction("claim-schedule-request", {
      liveId: opts.liveId,
      slotId: String(opts.slotId || ""),
      slot: opts.slot,
      userId: opts.userId,
      name: opts.name,
      avatar: opts.avatar,
      status: "waiting",
    });

    console.log("KRISTO_CLAIM_ROOM_SYNC_SUCCESS", {
      liveId: opts.liveId,
      slot: opts.slot,
      userId: opts.userId,
      ok: res?.ok !== false,
      requestKeys: res?.live?.requests ? Object.keys(res.live.requests) : [],
    });

    return res;
  } catch (error) {
    console.log("KRISTO_CLAIM_ROOM_SYNC_SUCCESS", {
      liveId: opts.liveId,
      slot: opts.slot,
      userId: opts.userId,
      ok: false,
      error: String((error as any)?.message || error),
    });
    throw error;
  }
}
