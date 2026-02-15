import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

import { guard } from "@/app/api/_lib/rbac";
import { createNotification, type NotificationType } from "@/app/api/_lib/notifications";

function json(data: any, init?: ResponseInit) {
  return NextResponse.json(data, init);
}

export const runtime = "nodejs";

export async function POST(req: NextRequest) {
  // DEV ONLY safeguard (optional but recommended)
  if (process.env.NODE_ENV === "production") {
    return json({ ok: false, error: "Not available in production" }, { status: 404 });
  }

  const ctxOrRes = await guard(req);
  if (ctxOrRes instanceof NextResponse) return ctxOrRes;

  const role = ctxOrRes.viewer.role;
  const ok = role === "Pastor" || role === "Church_Admin" || role === "System_Admin";
  if (!ok) return json({ ok: false, error: "Forbidden" }, { status: 403 });

  const body = await req.json().catch(() => ({} as any));

  const churchId = String(body?.churchId || ctxOrRes.churchId).trim();
  const type = String(body?.type || "Generic").trim() as NotificationType;
  const title = String(body?.title || "").trim();
  const message = body?.message != null ? String(body.message) : undefined;
  const targetUserId = body?.targetUserId != null ? String(body.targetUserId).trim() : undefined;

  if (!churchId) return json({ ok: false, error: "Missing churchId" }, { status: 400 });
  if (!title) return json({ ok: false, error: "Missing title" }, { status: 400 });

  const n = await createNotification({
    churchId,
    type,
    title,
    message,
    targetUserId,
  });

  return json({ ok: true, data: n });
}
