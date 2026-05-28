import { NextResponse } from "next/server";
import { readJsonFile, writeJsonFile } from "@/app/api/_lib/store/fs";
import { getMembershipsForChurch } from "@/app/api/_lib/memberships";
import {
  logChurchPastorResolution,
  resolveChurchPastorUserId,
} from "@/app/api/_lib/churchPastor";
import { createNotification } from "@/app/api/_lib/notifications";

import { evaluateLiveMediaAuthority } from "@/lib/liveMediaAuthority";

export const runtime = "nodejs";

const STORE_FILE = "church-live.json";
const LIVE_STALE_MS = 20000;

function auth(req: Request) {
  return {
    userId: String(req.headers.get("x-kristo-user-id") || "").trim(),
    role: String(req.headers.get("x-kristo-role") || "").trim(),
    churchId: String(req.headers.get("x-kristo-church-id") || "").trim(),
  };
}

function isPastor(role: string) {
  return String(role || "").toLowerCase().includes("pastor");
}

function isCoHostRole(role: string) {
  const r = String(role || "").toLowerCase();
  return r.includes("co-host") || r.includes("cohost");
}

function canModerateLive(
  auth: { userId: string; role: string },
  live: {
    pastorUserId?: string;
    actualChurchPastorUserId?: string;
    scheduleCreatedByUserId?: string;
    mediaHostIds?: string | string[];
  }
) {
  if (isCoHostRole(auth.role)) return false;

  const authority = evaluateLiveMediaAuthority({
    currentUserId: auth.userId,
    actualChurchPastorUserId: live.actualChurchPastorUserId,
    scheduleCreatedByUserId: live.scheduleCreatedByUserId,
    mediaHostIds: live.mediaHostIds,
  });

  return authority.isMediaOwnerHost;
}

function liveStoreKey(churchId: string, liveId: string) {
  const cid = String(churchId || "").trim();
  const lid = String(liveId || "").trim() || "scheduled-live-default";
  return `${cid}|${lid}`;
}

function defaultLiveRecord(churchId: string, liveId: string, now: number) {
  const lid = String(liveId || "").trim() || `church-live-${now}`;
  return {
    isLive: true,
    liveId: lid,
    churchId,
    pastorUserId: "",
    mediaName: "Church Live",
    title: "Pastor is LIVE",
    startedAt: now,
    updatedAt: now,
    requests: {} as Record<string, any>,
    comments: [] as any[],
    viewerCount: 0,
    blockedUsers: {} as Record<string, any>,
    viewerPresence: {} as Record<string, any>,
    requestPolicy: "locked",
  };
}

function normalizeLiveRecord(live: any, churchId: string, liveId: string) {
  const lid = String(liveId || live?.liveId || "").trim() || "scheduled-live-default";
  return {
    ...live,
    liveId: lid,
    churchId: String(live?.churchId || churchId || "").trim(),
    requests: live?.requests && typeof live.requests === "object" ? live.requests : {},
    blockedUsers: live?.blockedUsers && typeof live.blockedUsers === "object" ? live.blockedUsers : {},
    comments: Array.isArray(live?.comments) ? live.comments : [],
    viewerPresence:
      live?.viewerPresence && typeof live.viewerPresence === "object" ? live.viewerPresence : {},
    requestPolicy: String(live?.requestPolicy || "locked"),
  };
}

function readLiveSession(store: Record<string, any>, churchId: string, liveId: string) {
  const key = liveStoreKey(churchId, liveId);
  const direct = store[key];
  if (direct) {
    return { key, live: normalizeLiveRecord(direct, churchId, liveId), migrated: false };
  }

  const legacy = store[churchId];
  const legacyLiveId = String(legacy?.liveId || "").trim();
  const targetLiveId = String(liveId || "").trim();
  if (legacy && (!targetLiveId || !legacyLiveId || legacyLiveId === targetLiveId)) {
    return {
      key,
      live: normalizeLiveRecord({ ...legacy, liveId: targetLiveId || legacyLiveId }, churchId, liveId),
      migrated: true,
      legacyKey: churchId,
    };
  }

  return { key, live: null as any, migrated: false };
}

function resolveLiveForGet(store: Record<string, any>, churchId: string, liveId?: string) {
  if (liveId) {
    return readLiveSession(store, churchId, liveId);
  }

  const legacy = store[churchId];
  if (legacy) {
    return {
      key: churchId,
      live: normalizeLiveRecord(legacy, churchId, String(legacy.liveId || "")),
      migrated: false,
    };
  }

  const prefix = `${String(churchId || "").trim()}|`;
  let newest: { key: string; live: any; updatedAt: number } | null = null;

  for (const [key, value] of Object.entries(store)) {
    if (!key.startsWith(prefix)) continue;
    const updatedAt = Number((value as any)?.updatedAt || (value as any)?.startedAt || 0);
    if (!newest || updatedAt >= newest.updatedAt) {
      newest = { key, live: value, updatedAt };
    }
  }

  if (!newest) return { key: "", live: null as any, migrated: false };

  const lid = String(newest.live?.liveId || newest.key.split("|")[1] || "").trim();
  return {
    key: newest.key,
    live: normalizeLiveRecord(newest.live, churchId, lid),
    migrated: false,
  };
}

function ensureLiveSession(
  store: Record<string, any>,
  churchId: string,
  liveId: string,
  now: number
) {
  const resolved = readLiveSession(store, churchId, liveId);
  if (resolved.live) {
    if (resolved.migrated && resolved.legacyKey && resolved.legacyKey !== resolved.key) {
      store[resolved.key] = resolved.live;
      delete store[resolved.legacyKey];
    }
    return resolved;
  }

  const live = defaultLiveRecord(churchId, liveId, now);
  store[resolved.key] = live;
  return { ...resolved, live };
}

function liteLivePayload(live: any) {
  if (!live) return null;
  return {
    isLive: live.isLive === true && !live.endedAt,
    liveId: live.liveId,
    churchId: live.churchId,
    requestPolicy: live.requestPolicy,
    requests: live.requests,
    viewerPresence: live.viewerPresence,
    viewerCount: live.viewerCount,
    lastPresenceAt: live.lastPresenceAt,
    actualChurchPastorUserId: live.actualChurchPastorUserId,
    scheduleCreatedByUserId: live.scheduleCreatedByUserId,
    mediaHostIds: live.mediaHostIds,
    updatedAt: live.updatedAt,
  };
}

function upsertWaitingRequest(
  live: any,
  opts: {
    liveId: string;
    slotId?: string;
    slot?: number;
    userId: string;
    name: string;
    avatar: string;
    status?: string;
    now: number;
  }
) {
  live.requests = live.requests || {};

  for (const [key, req] of Object.entries(live.requests) as any) {
    if (String(req?.userId || "").trim() === opts.userId) {
      delete live.requests[key];
    }
  }

  const usedSlots = new Set(
    Object.keys(live.requests || {})
      .map((x) => Number(x))
      .filter(Boolean)
  );

  let slot = Number(opts.slot || 0);
  if (!slot && opts.slotId) {
    const match = Object.entries(live.requests).find(
      ([, req]: any) => String(req?.slotId || "") === String(opts.slotId)
    );
    if (match) slot = Number(match[0]);
  }
  if (!slot) slot = 1;
  while (usedSlots.has(slot) && slot < 9) slot += 1;

  live.requests[slot] = {
    liveId: String(opts.liveId || live.liveId || "").trim(),
    slotId: String(opts.slotId || "").trim(),
    userId: opts.userId,
    name: opts.name,
    avatar: opts.avatar,
    status: String(opts.status || "waiting"),
    approved: false,
    onStage: false,
    waiting: true,
    seatType: "waiting",
    joinedAt: new Date(opts.now).toISOString(),
    claimedAt: new Date(opts.now).toISOString(),
  };

  return { slot, request: live.requests[slot] };
}

export async function GET(req: Request) {
  const a = auth(req);
  if (!a.userId || !a.churchId) {
    return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  }

  const url = new URL(req.url);
  const lite = url.searchParams.get("lite") === "1";
  const queryLiveId = String(url.searchParams.get("liveId") || "").trim();

  const store = await readJsonFile<Record<string, any>>(STORE_FILE, {});
  const resolved = resolveLiveForGet(store, a.churchId, queryLiveId || undefined);
  let rawLive = resolved.live;

  if (rawLive?.isLive === true && !rawLive?.endedAt) {
    const lastBeat = Number(rawLive.lastPresenceAt || rawLive.updatedAt || rawLive.startedAt || 0);
    if (!lastBeat || Date.now() - lastBeat > LIVE_STALE_MS) {
      rawLive.isLive = false;
      rawLive.endedAt = new Date().toISOString();
      rawLive.endedReason = "heartbeat-timeout";
      rawLive.updatedAt = Date.now();
      if (resolved.key) store[resolved.key] = rawLive;
      await writeJsonFile(STORE_FILE, store);
    }
  }

  const live = rawLive?.isLive === true && !rawLive?.endedAt ? rawLive : null;

  if (live?.blockedUsers?.[a.userId]) {
    return NextResponse.json({
      ok: true,
      live: null,
      removedFromLive: true,
      message: "You were removed from this live.",
    });
  }

  if (lite) {
    return NextResponse.json({ ok: true, live: liteLivePayload(live), lite: true });
  }

  return NextResponse.json({ ok: true, live });
}

export async function POST(req: Request) {
  const a = auth(req);
  if (!a.userId || !a.churchId) {
    return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  }

  if (!isPastor(a.role)) {
    return NextResponse.json({ ok: false, error: "Pastor only" }, { status: 403 });
  }

  const body = await req.json().catch(() => ({}));
  const store = await readJsonFile<Record<string, any>>(STORE_FILE, {});
  const now = Date.now();
  const liveId = String(body.liveId || `church-live-${now}`).trim();
  const storeKey = liveStoreKey(a.churchId, liveId);
  const previousLive = store[storeKey] || store[a.churchId] || null;

  const pastorResolution = await resolveChurchPastorUserId(a.churchId);
  const actualChurchPastorUserId =
    pastorResolution.actualChurchPastorUserId || a.userId;

  logChurchPastorResolution({
    churchId: a.churchId,
    actualChurchPastorUserId,
    sourceField: pastorResolution.sourceField || "live.poster.userId",
    scheduleCreatedByUserId: String(body.scheduleCreatedByUserId || ""),
    currentUserId: a.userId,
  });

  const live = {
    isLive: body.isLive !== false,
    liveId,
    churchId: a.churchId,
    pastorUserId: actualChurchPastorUserId,
    actualChurchPastorUserId,
    scheduleCreatedByUserId: String(body.scheduleCreatedByUserId || "").trim() || undefined,
    mediaHostIds: String(body.mediaHostIds || "").trim() || undefined,
    mediaName: String(body.mediaName || "Church Live"),
    title: String(body.title || "Pastor is LIVE"),
    startedAt: now,
    updatedAt: now,
    lastPresenceAt: now,
    requests: previousLive?.requests && typeof previousLive.requests === "object" ? previousLive.requests : {},
    requestPolicy: String(body.requestPolicy || previousLive?.requestPolicy || "locked"),
    blockedUsers:
      previousLive?.blockedUsers && typeof previousLive.blockedUsers === "object"
        ? previousLive.blockedUsers
        : {},
    viewerPresence:
      previousLive?.viewerPresence && typeof previousLive.viewerPresence === "object"
        ? previousLive.viewerPresence
        : {},
    comments: Array.isArray(previousLive?.comments) ? previousLive.comments : [],
    viewerCount: Number(previousLive?.viewerCount || 0),
  };

  if (store[a.churchId] && store[a.churchId] !== store[storeKey]) {
    delete store[a.churchId];
  }

  store[storeKey] = live;
  await writeJsonFile(STORE_FILE, store);

  const shouldNotifyMembers =
    live.isLive && (!previousLive?.isLive || previousLive?.liveId !== live.liveId);

  let notifiedMembers = 0;

  if (shouldNotifyMembers) {
    const members = await getMembershipsForChurch(a.churchId, "Active");

    for (const member of members) {
      if (!member.userId || member.userId === a.userId) continue;

      createNotification({
        churchId: a.churchId,
        targetUserId: member.userId,
        type: "Generic",
        title: "Pastor is LIVE",
        message: `${live.mediaName || "Church Media"} is live now. Tap the Church tab to join.`,
      });

      notifiedMembers += 1;
    }
  }

  return NextResponse.json({ ok: true, live, notifiedMembers });
}

export async function PATCH(req: Request) {
  const a = auth(req);
  if (!a.userId || !a.churchId) {
    return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  }

  const body = await req.json().catch(() => ({}));
  const action = String(body.action || "").trim();
  const liveId = String(body.liveId || "").trim();

  const store = await readJsonFile<Record<string, any>>(STORE_FILE, {});
  const now = Date.now();

  const session = ensureLiveSession(store, a.churchId, liveId || `church-live-${now}`, now);
  const live = session.live;

  live.requests = live.requests || {};
  live.blockedUsers = live.blockedUsers || {};
  live.comments = Array.isArray(live.comments) ? live.comments : [];
  live.requestPolicy = String(live.requestPolicy || "locked");

  if (action === "end-live") {
    if (!canModerateLive(a, live)) {
      return NextResponse.json({ ok: false, error: "Pastor/live owner only" }, { status: 403 });
    }

    live.isLive = false;
    live.endedAt = new Date(now).toISOString();
    live.updatedAt = now;
    store[session.key] = live;
    await writeJsonFile(STORE_FILE, store);

    return NextResponse.json({ ok: true, live });
  }

  if (action === "set-policy") {
    if (!canModerateLive(a, live)) {
      return NextResponse.json({ ok: false, error: "Pastor/live owner only" }, { status: 403 });
    }

    const nextPolicy = String(body.requestPolicy || body.policy || "").trim();
    const allowed = ["auto", "approval", "invite", "members", "locked"];

    if (!allowed.includes(nextPolicy)) {
      return NextResponse.json({ ok: false, error: "Invalid policy", live }, { status: 400 });
    }

    live.requestPolicy = nextPolicy;
  }

  if (action === "claim-schedule-request") {
    const requestLiveId = String(body.liveId || liveId || live.liveId || "").trim();
    if (!requestLiveId) {
      return NextResponse.json({ ok: false, error: "liveId is required" }, { status: 400 });
    }

    live.liveId = requestLiveId;

    const requestUserId = String(body.userId || a.userId || "").trim();
    const slotId = String(body.slotId || "").trim();
    const name = String(body.name || "Member").trim() || "Member";
    const avatar = String(body.avatar || body.avatarUri || "M").trim() || "M";

    const { slot, request } = upsertWaitingRequest(live, {
      liveId: requestLiveId,
      slotId,
      slot: Number(body.slot || body.slotNumber || 0),
      userId: requestUserId,
      name,
      avatar,
      status: String(body.status || "waiting"),
      now,
    });

    console.log("KRISTO_LIVE_REQUEST_PERSISTED", {
      churchId: a.churchId,
      liveId: requestLiveId,
      storeKey: session.key,
      slot,
      slotId,
      userId: requestUserId,
      status: request?.status || "waiting",
    });
  }

  if (action === "clear-claim-request") {
    const requestLiveId = String(body.liveId || liveId || live.liveId || "").trim();
    if (requestLiveId) live.liveId = requestLiveId;

    const slotId = String(body.slotId || "").trim();
    const requestUserId = String(body.userId || a.userId || "").trim();
    const clearedKeys: string[] = [];

    live.requests = live.requests || {};
    for (const [key, req] of Object.entries(live.requests) as any) {
      const matchesUser = !requestUserId || String(req?.userId || "").trim() === requestUserId;
      const matchesSlotId = !slotId || String(req?.slotId || "").trim() === slotId;
      if (matchesUser && matchesSlotId) {
        delete live.requests[key];
        clearedKeys.push(String(key));
      }
    }

    console.log("KRISTO_CLAIM_DELETE_LIVE_REQUEST_CLEARED", {
      churchId: a.churchId,
      liveId: requestLiveId || live.liveId,
      storeKey: session.key,
      slotId,
      userId: requestUserId,
      clearedKeys,
    });
  }

  if (action === "request-join") {
    const requestUserId = String(body.userId || a.userId || "").trim();
    const requestLiveId = String(body.liveId || liveId || live.liveId || "").trim();
    if (requestLiveId) live.liveId = requestLiveId;

    upsertWaitingRequest(live, {
      liveId: requestLiveId || String(live.liveId || ""),
      slotId: String(body.slotId || "").trim(),
      slot: Number(body.slot || 0),
      userId: requestUserId,
      name: String(body.name || "Guest"),
      avatar: String(body.avatar || body.avatarUri || "G"),
      status: "waiting",
      now,
    });

    const policy = String(live.requestPolicy || "locked");
    const autoApproved = policy === "auto" || policy === "members";
    const slotKey = Object.keys(live.requests).find((key) => {
      const req = live.requests[key];
      return String(req?.userId || "") === requestUserId;
    });

    if (slotKey && autoApproved) {
      live.requests[slotKey] = {
        ...live.requests[slotKey],
        approved: true,
        onStage: true,
        waiting: false,
        status: "approved",
        seatType: "camera-mic",
        approvedAt: new Date(now).toISOString(),
      };
    }
  }

  if (action === "approve-request") {
    if (!canModerateLive(a, live)) {
      return NextResponse.json({ ok: false, error: "Pastor/live owner only" }, { status: 403 });
    }
    const rawSlot = Number(body.slot || 0);
    const slot = rawSlot > 0 ? rawSlot : 1;
    const existingRequest = live.requests[slot] || live.requests[0] || {};

    if (live.requests[0] && slot !== 0) {
      delete live.requests[0];
    }

    live.requests[slot] = {
      ...existingRequest,
      name: String(body.name || existingRequest.name || "Guest"),
      avatar: String(body.avatar || existingRequest.avatar || "G"),
      userId: String(body.userId || existingRequest.userId || ""),
      approved: true,
      onStage: body.onStage === false ? false : true,
      seatType: "camera-mic",
      waiting: false,
      status: "approved",
      approvedAt: new Date(now).toISOString(),
      joinedAt: String(existingRequest.joinedAt || body.joinedAt || new Date(now).toISOString()),
    };
  }

  if (action === "move-upper") {
    if (!canModerateLive(a, live)) {
      return NextResponse.json({ ok: false, error: "Pastor/live owner only" }, { status: 403 });
    }

    const rawSlot = Number(body.slot || 0);
    const slot = rawSlot > 0 ? rawSlot : 1;
    const existingRequest = live.requests[slot] || live.requests[0] || null;

    if (existingRequest) {
      if (live.requests[0]) delete live.requests[0];

      live.requests[slot] = {
        ...existingRequest,
        approved: true,
        onStage: true,
        waiting: false,
        status: "approved",
        seatType: "camera-mic",
        approvedAt: new Date(now).toISOString(),
      };
    }
  }

  if (action === "reject-request" || action === "drop-guest") {
    if (!canModerateLive(a, live)) {
      return NextResponse.json({ ok: false, error: "Pastor/live owner only" }, { status: 403 });
    }

    const slot = Number(body.slot || 0);
    const removedReq = live.requests[slot] || null;

    if (action === "drop-guest" && removedReq?.userId) {
      live.blockedUsers[String(removedReq.userId)] = {
        userId: String(removedReq.userId),
        name: String(removedReq.name || "Guest"),
        slot,
        blockedAt: new Date(now).toISOString(),
        reason: "removed-from-live",
      };
    }

    delete live.requests[slot];
  }

  if (action === "comment") {
    const text = String(body.text || "").trim();
    if (text) {
      live.comments.unshift({
        id: `c_${now}_${Math.random().toString(16).slice(2)}`,
        name: String(body.name || "Viewer"),
        text,
        userId: a.userId,
        createdAt: now,
      });
      live.comments = live.comments.slice(0, 80);
    }
  }

  if (action === "presence") {
    live.viewerPresence = live.viewerPresence || {};

    const isLiveOwner = evaluateLiveMediaAuthority({
      currentUserId: a.userId,
      actualChurchPastorUserId: live.actualChurchPastorUserId,
      pastorUserId: live.pastorUserId,
      scheduleCreatedByUserId: live.scheduleCreatedByUserId,
      mediaHostIds: live.mediaHostIds,
    }).isMediaOwnerHost;
    const role = String(body.role || "").toLowerCase();

    if (isLiveOwner || isPastor(a.role) || role === "stage") {
      live.isLive = true;
      delete live.endedAt;
      delete live.endedReason;
    }
    const shouldCountViewer =
      Number(body.viewerCount || 0) > 0 &&
      !isLiveOwner &&
      !isPastor(a.role) &&
      role !== "stage";

    live.viewerPresence[a.userId] = {
      userId: a.userId,
      role,
      lastSeenAt: now,
    };

    if (shouldCountViewer) {
      delete live.viewerPresence[a.userId];
    }

    for (const [userId, presence] of Object.entries(live.viewerPresence || {}) as any) {
      if (!presence?.lastSeenAt || now - Number(presence.lastSeenAt) > 15000) {
        delete live.viewerPresence[userId];
      }
    }

    live.viewerCount = Object.keys(live.viewerPresence || {}).length;

    if (isLiveOwner || isPastor(a.role)) {
      live.lastPresenceAt = now;
    }
  }

  live.updatedAt = now;
  store[session.key] = live;
  await writeJsonFile(STORE_FILE, store);

  return NextResponse.json({ ok: true, live });
}
