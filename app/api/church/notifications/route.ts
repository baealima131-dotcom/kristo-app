import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

import { guard } from "@/app/api/_lib/rbac";
import {
  listNotifications,
  setRead,
  removeNotification,
  createNotification,
  type AppNotification,
  type NotificationType,
} from "@/app/api/_lib/notifications";

function json(data: any, init?: ResponseInit) {
  return NextResponse.json(data, init);
}

export async function GET(req: NextRequest) {
  const ctxOrRes = await guard(req);
  if (ctxOrRes instanceof NextResponse) return ctxOrRes;

  const url = new URL(req.url);
  const unreadOnly = url.searchParams.get("unread") === "1" || url.searchParams.get("unread") === "true";
  const limit = Number(url.searchParams.get("limit") || "50");

  const role = String(ctxOrRes.viewer.role || "");
  const canSeeAllTargets =
    role === "Pastor" || role === "Church_Admin" || role === "System_Admin";

  const items = listNotifications({
    churchId: ctxOrRes.churchId,
    userId: ctxOrRes.viewer.userId,
    unreadOnly,
    limit: Number.isFinite(limit) ? limit : 50,
    includeAllTargets: canSeeAllTargets,
  });

  return json({ ok: true, data: items });
}

export async function POST(req: NextRequest) {
  const ctxOrRes = await guard(req);
  if (ctxOrRes instanceof NextResponse) return ctxOrRes;

  const role = String(ctxOrRes.viewer.role || "");
  const ok =
    role === "Pastor" || role === "Church_Admin" || role === "System_Admin";

  if (!ok) {
    return json({ ok: false, error: "Forbidden" }, { status: 403 });
  }

  const body = await req.json().catch(() => ({} as any));

  const churchId = String(body?.churchId || ctxOrRes.churchId || "").trim();
  const type = String(body?.type || "Generic").trim() as NotificationType;
  const title = String(body?.title || "").trim();
  const message =
    body?.message != null
      ? String(body.message)
      : body?.body != null
      ? String(body.body)
      : undefined;
  const targetUserId =
    body?.targetUserId != null ? String(body.targetUserId).trim() : undefined;

  if (!churchId) {
    return json({ ok: false, error: "Missing churchId" }, { status: 400 });
  }

  if (!title) {
    return json({ ok: false, error: "Missing title" }, { status: 400 });
  }

  const created = createNotification({
    churchId,
    type,
    title,
    message,
    targetUserId,
  });

  return json({ ok: true, data: created as AppNotification });
}

export async function PATCH(req: NextRequest) {
  const ctxOrRes = await guard(req);
  if (ctxOrRes instanceof NextResponse) return ctxOrRes;

  const url = new URL(req.url);
  const body = await req.json().catch(() => ({} as any));

  const id = String(url.searchParams.get("id") || body?.id || "").trim();
  if (!id) return json({ ok: false, error: "Missing id" }, { status: 400 });

  const isRead =
    body?.isRead === undefined
      ? true
      : !!body.isRead;

  const role = String(ctxOrRes.viewer.role || "");
  const canSeeAllTargets =
    role === "Pastor" || role === "Church_Admin" || role === "System_Admin";

  const visible = listNotifications({
    churchId: ctxOrRes.churchId,
    userId: ctxOrRes.viewer.userId,
    unreadOnly: false,
    limit: 5000,
    includeAllTargets: canSeeAllTargets,
  }) as AppNotification[];

  const found = Array.isArray(visible) ? visible.find((n) => String(n.id) === id) : null;
  if (!found) {
    return json({ ok: false, error: "Notification not found" }, { status: 404 });
  }

  const updated = setRead(id, isRead);
  if (!updated) return json({ ok: false, error: "Notification not found" }, { status: 404 });

  return json({ ok: true, data: updated as AppNotification });
}

export async function DELETE(req: NextRequest) {
  const ctxOrRes = await guard(req);
  if (ctxOrRes instanceof NextResponse) return ctxOrRes;

  const url = new URL(req.url);
  const body = await req.json().catch(() => ({} as any));

  const id = String(url.searchParams.get("id") || body?.id || "").trim();
  if (!id) return json({ ok: false, error: "Missing id" }, { status: 400 });

  const role = String(ctxOrRes.viewer.role || "");
  const canSeeAllTargets =
    role === "Pastor" || role === "Church_Admin" || role === "System_Admin";

  const visible = listNotifications({
    churchId: ctxOrRes.churchId,
    userId: ctxOrRes.viewer.userId,
    unreadOnly: false,
    limit: 5000,
    includeAllTargets: canSeeAllTargets,
  }) as AppNotification[];

  const found = Array.isArray(visible) ? visible.find((n) => String(n.id) === id) : null;
  if (!found) {
    return json({ ok: false, error: "Notification not found" }, { status: 404 });
  }

  const removed = removeNotification(id);
  if (!removed) return json({ ok: false, error: "Notification not found" }, { status: 404 });

  return json({ ok: true, data: removed as AppNotification });
}
