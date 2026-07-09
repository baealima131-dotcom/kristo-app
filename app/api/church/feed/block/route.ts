import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

import { guard, guardAuth } from "@/app/api/_lib/rbac";
import {
  isFeedBlockDatabaseError,
  listBlockedUserIds,
  upsertFeedBlock,
} from "@/app/api/_lib/store/feedBlockDb";
import { createModerationEvent } from "@/app/api/_lib/store/moderationEventsDb";

function json(data: any, init?: ResponseInit) {
  return NextResponse.json(data, init);
}

export async function GET(req: NextRequest) {
  const ctxOrRes = await guardAuth(req);
  if (ctxOrRes instanceof NextResponse) return ctxOrRes;

  try {
    const blockedUserIds = await listBlockedUserIds(ctxOrRes.viewer.userId);
    return json({
      ok: true,
      data: { blockedUserIds },
    });
  } catch (error) {
    if (isFeedBlockDatabaseError(error)) {
      return json({ ok: false, error: "Block store unavailable" }, { status: 503 });
    }
    console.error("[church/feed/block] GET failed", error);
    return json({ ok: false, error: "Failed to load blocked users" }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  const ctxOrRes = await guard(req);
  if (ctxOrRes instanceof NextResponse) return ctxOrRes;

  let body: any = {};
  try {
    body = await req.json();
  } catch {
    body = {};
  }

  const blockedUserId = String(body?.blockedUserId || "").trim();
  const reason = String(body?.reason || "").trim();

  if (!blockedUserId) {
    return json({ ok: false, error: "blockedUserId required" }, { status: 400 });
  }
  if (blockedUserId === ctxOrRes.viewer.userId) {
    return json({ ok: false, error: "Cannot block yourself" }, { status: 400 });
  }

  try {
    await upsertFeedBlock({
      blockerUserId: ctxOrRes.viewer.userId,
      blockerChurchId: ctxOrRes.churchId || "",
      blockedUserId,
      reason,
    });

    await createModerationEvent({
      eventType: "block_user",
      actorUserId: ctxOrRes.viewer.userId,
      actorChurchId: ctxOrRes.churchId || "",
      targetUserId: blockedUserId,
      reason: reason || "Blocked from feed",
      details: "",
    }).catch(() => {});

    return json({ ok: true });
  } catch (error) {
    if (isFeedBlockDatabaseError(error)) {
      return json({ ok: false, error: "Block store unavailable" }, { status: 503 });
    }
    console.error("[church/feed/block] POST failed", error);
    return json({ ok: false, error: "Failed to block user" }, { status: 500 });
  }
}
