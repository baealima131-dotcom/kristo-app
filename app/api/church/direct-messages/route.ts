import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

import { guard } from "@/app/api/_lib/rbac";
import {
  ensureDirectMessageThreadFromRoomId,
  listDirectMessageInbox,
  markDirectMessageThreadRead,
  openDirectMessageThread,
  resolveDirectMessagePeerPreview,
} from "@/app/api/_lib/directMessages";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function json(data: unknown, init?: ResponseInit) {
  return NextResponse.json(data, init);
}

export async function GET(req: NextRequest) {
  const ctxOrRes = await guard(req);
  if (ctxOrRes instanceof NextResponse) return ctxOrRes;

  const url = new URL(req.url);
  const action = String(url.searchParams.get("action") || "").trim().toLowerCase();
  const viewerUserId = String(ctxOrRes.viewer.userId || "").trim();
  const churchId = String(ctxOrRes.churchId || "").trim();

  if (action === "resolve") {
    const kristoId = String(url.searchParams.get("kristoId") || url.searchParams.get("kristoID") || "").trim();
    const lookupChurchId = String(url.searchParams.get("churchId") || url.searchParams.get("churchID") || "").trim();
    if (!kristoId || !lookupChurchId) {
      return json({ ok: false, error: "Kristo ID and Church ID are required." }, { status: 400 });
    }

    const peer = await resolveDirectMessagePeerPreview({
      kristoId,
      churchId: lookupChurchId,
    });

    if (!peer) {
      return json(
        { ok: false, error: "We could not find an active member with that Kristo ID in that church." },
        { status: 404 }
      );
    }

    if (peer.userId === viewerUserId) {
      return json({ ok: false, error: "You cannot start a chat with yourself." }, { status: 400 });
    }

    return json({ ok: true, data: peer });
  }

  if (!churchId) {
    return json({ ok: true, data: [] });
  }

  const inbox = await listDirectMessageInbox({
    churchId,
    viewerUserId,
  });

  return json({ ok: true, data: inbox });
}

export async function POST(req: NextRequest) {
  const ctxOrRes = await guard(req);
  if (ctxOrRes instanceof NextResponse) return ctxOrRes;

  const body = (await req.json().catch(() => null)) as {
    targetUserId?: string;
    roomId?: string;
    churchId?: string;
    action?: string;
  } | null;

  const viewerUserId = String(ctxOrRes.viewer.userId || "").trim();
  const targetUserId = String(body?.targetUserId || "").trim();
  const roomId = String(body?.roomId || "").trim();
  const churchId = String(body?.churchId || ctxOrRes.churchId || "").trim();
  const action = String(body?.action || "").trim().toLowerCase();

  if (action === "ensure" || roomId) {
    if (!roomId) {
      return json({ ok: false, error: "roomId is required." }, { status: 400 });
    }
    if (!churchId) {
      return json({ ok: false, error: "churchId is required." }, { status: 400 });
    }

    const thread = await ensureDirectMessageThreadFromRoomId({
      viewerUserId,
      churchId,
      roomId,
      intent: "repair",
    });

    if (!thread) {
      return json({ ok: false, error: "Could not open this conversation." }, { status: 400 });
    }

    return json({ ok: true, data: thread });
  }

  if (!targetUserId) {
    return json({ ok: false, error: "targetUserId is required." }, { status: 400 });
  }
  if (!churchId) {
    return json({ ok: false, error: "churchId is required." }, { status: 400 });
  }

  try {
    const thread = await openDirectMessageThread({
      viewerUserId,
      targetUserId,
      churchId,
    });
    return json({ ok: true, data: thread }, { status: 201 });
  } catch (error) {
    const message = String((error as Error)?.message || error || "Could not start chat.");
    const status = message.includes("yourself") ? 400 : message.includes("member") ? 403 : 400;
    return json({ ok: false, error: message }, { status });
  }
}

export async function PATCH(req: NextRequest) {
  const ctxOrRes = await guard(req);
  if (ctxOrRes instanceof NextResponse) return ctxOrRes;

  const body = (await req.json().catch(() => null)) as {
    roomId?: string;
    churchId?: string;
    action?: string;
  } | null;

  const action = String(body?.action || "read").trim().toLowerCase();
  if (action !== "read") {
    return json({ ok: false, error: "Unsupported action." }, { status: 400 });
  }

  const roomId = String(body?.roomId || "").trim();
  const churchId = String(body?.churchId || ctxOrRes.churchId || "").trim();
  const viewerUserId = String(ctxOrRes.viewer.userId || "").trim();

  if (!roomId || !churchId) {
    return json({ ok: false, error: "roomId and churchId are required." }, { status: 400 });
  }

  const updated = await markDirectMessageThreadRead({
    churchId,
    roomId,
    userId: viewerUserId,
  });

  if (!updated) {
    console.log("KRISTO_DM_READ_MARK_SKIPPED_NO_THREAD", {
      reason: "mark_read_failed",
      roomId,
      churchId,
      viewerUserId,
    });
    return json({ ok: false, error: "Could not mark conversation read." }, { status: 400 });
  }

  return json({ ok: true });
}
