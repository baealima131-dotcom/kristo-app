import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

import { guardAuth } from "@/app/api/_lib/rbac";
import { createModerationEvent } from "@/app/api/_lib/store/moderationEventsDb";

function json(data: any, init?: ResponseInit) {
  return NextResponse.json(data, init);
}

function cleanChurchId(raw: unknown) {
  return String(raw || "").trim().toUpperCase();
}

export async function POST(req: NextRequest) {
  const ctxOrRes = await guardAuth(req);
  if (ctxOrRes instanceof NextResponse) return ctxOrRes;

  let body: any = {};
  try {
    body = await req.json();
  } catch {
    body = {};
  }

  const churchId = cleanChurchId(body?.churchId);
  const reason = String(body?.reason || "").trim();
  const details = String(body?.details || "").trim();
  const reporterUserId = String(body?.reporterUserId || "").trim();

  if (!churchId) {
    return json({ ok: false, error: "churchId required" }, { status: 400 });
  }
  if (!reason) {
    return json({ ok: false, error: "reason required" }, { status: 400 });
  }
  if (reporterUserId && reporterUserId !== ctxOrRes.viewer.userId) {
    return json({ ok: false, error: "reporterUserId mismatch" }, { status: 403 });
  }

  try {
    const eventId = await createModerationEvent({
      eventType: "report_church",
      actorUserId: ctxOrRes.viewer.userId,
      actorChurchId: ctxOrRes.churchId || "",
      targetChurchId: churchId,
      reason,
      details,
    });

    return json({ ok: true, eventId });
  } catch (error) {
    console.error("[church/feed/report-church] POST failed", error);
    return json({ ok: false, error: "Failed to submit church report" }, { status: 500 });
  }
}
