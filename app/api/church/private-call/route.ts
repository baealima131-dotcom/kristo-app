import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

import { guard } from "@/app/api/_lib/rbac";
import { resolveChurchPastorUserId } from "@/app/api/_lib/churchPastor";
import { getProfile } from "@/app/api/auth/_lib/profile";
import { notifyPastorPrivateCallIncoming } from "@/app/api/_lib/privateCallNotifications";
import {
  createPrivateCallSession,
  getPrivateCallSession,
  listPrivateCallSessionsForUser,
  listRingingCallsForPastor,
  updatePrivateCallSession,
} from "@/app/api/_lib/privateCallSessions";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function json(data: unknown, init?: ResponseInit) {
  return NextResponse.json(data, init);
}

async function displayNameForUser(userId: string, fallback = "Kristo user") {
  const profile = await getProfile(String(userId || "")).catch(() => null);
  return String(
    profile?.fullName || profile?.displayName || profile?.email || fallback
  ).trim();
}

export async function GET(req: NextRequest) {
  const ctxOrRes = await guard(req);
  if (ctxOrRes instanceof NextResponse) return ctxOrRes;

  const url = new URL(req.url);
  const callId = String(url.searchParams.get("callId") || "").trim();
  const userId = String(ctxOrRes.viewer.userId || "").trim();

  if (callId) {
    const session = await getPrivateCallSession(callId);
    if (!session) {
      return json({ ok: false, error: "Call not found" }, { status: 404 });
    }
    if (session.callerUserId !== userId && session.pastorUserId !== userId) {
      return json({ ok: false, error: "Forbidden" }, { status: 403 });
    }
    return json({ ok: true, data: session });
  }

  const incomingOnly = url.searchParams.get("incoming") === "1";
  const sessions = incomingOnly
    ? await listRingingCallsForPastor(userId)
    : await listPrivateCallSessionsForUser(userId);

  if (incomingOnly) {
    console.log("KRISTO_PRIVATE_CALL_INCOMING_POLL", {
      receiverUserId: userId,
      count: sessions.length,
    });
    if (sessions.length > 0) {
      console.log("KRISTO_PRIVATE_CALL_INCOMING_FOUND", {
        receiverUserId: userId,
        calls: sessions.map((s) => ({
          callId: s.id,
          callerUserId: s.callerUserId,
          receiverUserId: s.pastorUserId,
          churchId: s.churchId,
          status: s.status,
        })),
      });
    }
  }

  return json({ ok: true, data: sessions });
}

export async function POST(req: NextRequest) {
  const ctxOrRes = await guard(req);
  if (ctxOrRes instanceof NextResponse) return ctxOrRes;

  const churchId = String(ctxOrRes.churchId || "").trim();
  const callerUserId = String(ctxOrRes.viewer.userId || "").trim();
  if (!churchId || !callerUserId) {
    return json({ ok: false, error: "Church membership required" }, { status: 400 });
  }

  const pastor = await resolveChurchPastorUserId(churchId);
  const pastorUserId = String(pastor.actualChurchPastorUserId || "").trim();
  if (!pastorUserId) {
    console.log("KRISTO_MY_WAY_PASTOR_RESOLVE_FAILED", {
      churchId,
      callerUserId,
      reason: "no-pastor",
    });
    return json(
      {
        ok: false,
        error: "pastor_unavailable",
        message: "Your church pastor is not available for calling right now.",
      },
      { status: 404 }
    );
  }

  if (pastorUserId === callerUserId) {
    return json(
      {
        ok: false,
        error: "self_call_blocked",
        message: "You are the church pastor. Use MY WAY to reach members another way.",
      },
      { status: 400 }
    );
  }

  const [callerName, pastorName, pastorProfile, callerProfile] = await Promise.all([
    displayNameForUser(callerUserId, "Church member"),
    displayNameForUser(pastorUserId, "Pastor"),
    getProfile(pastorUserId).catch(() => null),
    getProfile(callerUserId).catch(() => null),
  ]);

  console.log("KRISTO_MY_WAY_PASTOR_RESOLVED", {
    churchId,
    callerUserId,
    pastorUserId,
    sourceField: pastor.sourceField,
  });

  const session = await createPrivateCallSession({
    churchId,
    callerUserId,
    callerName,
    callerAvatarUrl: String(callerProfile?.avatarUrl || "").trim() || undefined,
    pastorUserId,
    pastorName,
    pastorAvatarUrl: String(pastorProfile?.avatarUrl || "").trim() || undefined,
    pastorSourceField: pastor.sourceField,
  });

  console.log("KRISTO_PRIVATE_CALL_SESSION_CREATED", {
    callId: session.id,
    callerUserId,
    receiverUserId: pastorUserId,
    churchId,
    status: session.status,
    roomName: session.roomName,
  });

  try {
    await notifyPastorPrivateCallIncoming(session);
  } catch (error) {
    console.log("KRISTO_PRIVATE_CALL_NOTIFICATION_FAILED", {
      callId: session.id,
      callerUserId,
      receiverUserId: pastorUserId,
      churchId,
      error: String((error as Error)?.message || error),
    });
  }

  console.log("KRISTO_PRIVATE_CALL_CREATE", {
    callId: session.id,
    churchId,
    roomName: session.roomName,
    callerUserId,
    pastorUserId,
    status: session.status,
  });

  console.log("KRISTO_PRIVATE_CALL_RINGING", {
    callId: session.id,
    pastorUserId,
    callerUserId,
    ringExpiresAt: session.ringExpiresAt,
  });

  return json({ ok: true, data: session });
}

export async function PATCH(req: NextRequest) {
  const ctxOrRes = await guard(req);
  if (ctxOrRes instanceof NextResponse) return ctxOrRes;

  const body = await req.json().catch(() => ({} as Record<string, unknown>));
  const callId = String(body?.callId || "").trim();
  const action = String(body?.action || "").trim().toLowerCase();
  const userId = String(ctxOrRes.viewer.userId || "").trim();

  if (!callId || !action) {
    return json({ ok: false, error: "Missing callId or action" }, { status: 400 });
  }

  const existing = await getPrivateCallSession(callId);
  if (!existing) {
    return json({ ok: false, error: "Call not found" }, { status: 404 });
  }

  const isCaller = existing.callerUserId === userId;
  const isPastor = existing.pastorUserId === userId;
  if (!isCaller && !isPastor) {
    return json({ ok: false, error: "Forbidden" }, { status: 403 });
  }

  if (action === "accept") {
    if (!isPastor) {
      return json({ ok: false, error: "Only the pastor can accept" }, { status: 403 });
    }
    if (existing.status !== "ringing") {
      return json({ ok: false, error: `Call is ${existing.status}` }, { status: 409 });
    }

    const updated = await updatePrivateCallSession(callId, (session) => ({
      ...session,
      status: "accepted",
      acceptedAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    }));

    console.log("KRISTO_PRIVATE_CALL_ACCEPTED", {
      callId,
      pastorUserId: userId,
      callerUserId: existing.callerUserId,
    });

    return json({ ok: true, data: updated });
  }

  if (action === "decline") {
    if (!isPastor) {
      return json({ ok: false, error: "Only the pastor can decline" }, { status: 403 });
    }
    if (existing.status !== "ringing") {
      return json({ ok: false, error: `Call is ${existing.status}` }, { status: 409 });
    }

    const updated = await updatePrivateCallSession(callId, (session) => ({
      ...session,
      status: "declined",
      endedAt: new Date().toISOString(),
      endedReason: "declined",
      updatedAt: new Date().toISOString(),
    }));

    console.log("KRISTO_PRIVATE_CALL_DECLINED", {
      callId,
      pastorUserId: userId,
      callerUserId: existing.callerUserId,
    });

    return json({ ok: true, data: updated });
  }

  if (action === "end") {
    if (existing.status !== "accepted" && existing.status !== "ringing") {
      console.log("KRISTO_PRIVATE_CALL_SESSION_ENDED", {
        callId,
        endedBy: userId,
        status: existing.status,
        idempotent: true,
      });
      return json({ ok: true, data: existing });
    }

    const updated = await updatePrivateCallSession(callId, (session) => ({
      ...session,
      status: "ended",
      endedAt: new Date().toISOString(),
      endedReason: isCaller ? "caller-ended" : "pastor-ended",
      updatedAt: new Date().toISOString(),
    }));

    console.log("KRISTO_PRIVATE_CALL_ENDED", {
      callId,
      endedBy: userId,
      reason: updated?.endedReason,
    });

    console.log("KRISTO_PRIVATE_CALL_SESSION_ENDED", {
      callId,
      callerUserId: existing.callerUserId,
      receiverUserId: existing.pastorUserId,
      endedBy: userId,
      status: updated?.status,
      churchId: existing.churchId,
    });

    return json({ ok: true, data: updated });
  }

  return json({ ok: false, error: "Unsupported action" }, { status: 400 });
}
