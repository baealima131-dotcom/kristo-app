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

export async function GET(req: Request) {
  const a = auth(req);
  if (!a.userId || !a.churchId) {
    return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  }

  const url = new URL(req.url);
  const lite = url.searchParams.get("lite") === "1";

  const store = await readJsonFile<Record<string, any>>(STORE_FILE, {});
  const rawLive = store[a.churchId] || null;

  if (rawLive?.isLive === true && !rawLive?.endedAt) {
    const lastBeat = Number(rawLive.lastPresenceAt || rawLive.updatedAt || rawLive.startedAt || 0);
    if (!lastBeat || Date.now() - lastBeat > LIVE_STALE_MS) {
      rawLive.isLive = false;
      rawLive.endedAt = new Date().toISOString();
      rawLive.endedReason = "heartbeat-timeout";
      rawLive.updatedAt = Date.now();
      store[a.churchId] = rawLive;
      await writeJsonFile(STORE_FILE, store);
    }
  }

  const live =
    rawLive?.isLive === true && !rawLive?.endedAt
      ? rawLive
      : null;

  // User aliyekuwa removed/closed kwenye live hii asiione tena mpaka live mpya ianze.
  // Kwa viewer huyu, app itaona kama hakuna live.
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
  const previousLive = store[a.churchId] || null;
  const now = Date.now();

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
    liveId: String(body.liveId || `church-live-${now}`),
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
    requestPolicy: String(body.requestPolicy || previousLive?.requestPolicy || "locked"),
  };

  store[a.churchId] = live;
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

  const store = await readJsonFile<Record<string, any>>(STORE_FILE, {});
  const now = Date.now();

  const live = store[a.churchId] || {
    isLive: true,
    liveId: String(body.liveId || `church-live-${now}`),
    churchId: a.churchId,
    pastorUserId: "",
    mediaName: "Church Live",
    title: "Pastor is LIVE",
    startedAt: now,
    updatedAt: now,
    requests: {},
    comments: [],
    viewerCount: 0,
    blockedUsers: {},
    requestPolicy: "locked",
  };

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
    store[a.churchId] = live;
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

  if (action === "request-join") {
    const requestUserId = String(body.userId || a.userId || "").trim();
    const rawSlot = Number(body.slot || 0);

    for (const [key, req] of Object.entries(live.requests || {}) as any) {
      if (requestUserId && String(req?.userId || "") === requestUserId) {
        delete live.requests[key];
      }
    }

    const usedSlots = new Set(Object.keys(live.requests || {}).map((x) => Number(x)).filter(Boolean));
    let slot = rawSlot > 0 ? rawSlot : 1;
    while (usedSlots.has(slot) && slot < 9) slot += 1;

    const policy = String(live.requestPolicy || "locked");
    const autoApproved = policy === "auto" || policy === "members";

    live.requests[slot] = {
      name: String(body.name || "Guest"),
      avatar: String(body.avatar || "G"),
      approved: autoApproved,
      onStage: autoApproved,
      seatType: autoApproved ? "camera-mic" : "waiting",
      joinedAt: String(body.joinedAt || new Date(now).toISOString()),
      userId: requestUserId,
      waiting: !autoApproved,
      approvedAt: autoApproved ? new Date(now).toISOString() : undefined,
    };
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
  store[a.churchId] = live;
  await writeJsonFile(STORE_FILE, store);

  return NextResponse.json({ ok: true, live });
}

