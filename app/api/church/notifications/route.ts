import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

import { guard } from "@/app/api/_lib/rbac";
import { listNotifications, setRead, type AppNotification } from "@/app/api/_lib/notifications";

function json(data: any, init?: ResponseInit) {
  return NextResponse.json(data, init);
}

export async function GET(req: NextRequest) {
  const ctxOrRes = await guard(req);
  if (ctxOrRes instanceof NextResponse) return ctxOrRes;

  const url = new URL(req.url);
  const unreadOnly = url.searchParams.get("unread") === "1" || url.searchParams.get("unread") === "true";
  const limit = Number(url.searchParams.get("limit") || "50");

  const items = listNotifications({
    churchId: ctxOrRes.churchId,
    userId: ctxOrRes.viewer.userId,
    unreadOnly,
    limit: Number.isFinite(limit) ? limit : 50,
  });

  return json({ ok: true, data: items });
}

export async function PATCH(req: NextRequest) {
  const ctxOrRes = await guard(req);
  if (ctxOrRes instanceof NextResponse) return ctxOrRes;

  const url = new URL(req.url);
  const id = String(url.searchParams.get("id") || "").trim();
  if (!id) return json({ ok: false, error: "Missing id" }, { status: 400 });

  const body = await req.json().catch(() => ({} as any));
  const isRead = !!body?.isRead;

  const updated = setRead(id, isRead);
  if (!updated) return json({ ok: false, error: "Notification not found" }, { status: 404 });

  return json({ ok: true, data: updated as AppNotification });
}
