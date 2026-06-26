import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

import { guard } from "@/app/api/_lib/rbac";
import {
  canViewerMarkNotification,
  resolveNotificationScope,
} from "@/app/api/_lib/notificationScope";
import {
  countNotifications,
  getNotificationById,
  listNotifications,
  setRead,
  toClientNotifications,
  type AppNotification,
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
  const scopeParams = resolveNotificationScope(url.searchParams.get("scope"), ctxOrRes.viewer.role);

  const items = await listNotifications({
    churchId: ctxOrRes.churchId,
    userId: ctxOrRes.viewer.userId,
    unreadOnly,
    limit: Number.isFinite(limit) ? limit : 50,
    storeScope: scopeParams.storeScope,
  });

  const clientItems = await toClientNotifications(items);
  const unreadCount = await countNotifications({
    churchId: ctxOrRes.churchId,
    userId: ctxOrRes.viewer.userId,
    unreadOnly: true,
    storeScope: scopeParams.storeScope,
  });

  return json({
    ok: true,
    data: clientItems,
    notifications: clientItems,
    meta: {
      unreadCount,
      scope: scopeParams.scope,
    },
  });
}

export async function PATCH(req: NextRequest) {
  const ctxOrRes = await guard(req);
  if (ctxOrRes instanceof NextResponse) return ctxOrRes;

  const url = new URL(req.url);
  const id = String(url.searchParams.get("id") || "").trim();
  if (!id) return json({ ok: false, error: "Missing id" }, { status: 400 });

  const body = await req.json().catch(() => ({} as any));
  const isRead = !!body?.isRead;

  const existing = await getNotificationById(id);
  if (!existing || existing.churchId !== ctxOrRes.churchId) {
    return json({ ok: false, error: "Notification not found" }, { status: 404 });
  }

  if (
    !canViewerMarkNotification(existing, ctxOrRes.viewer.userId, ctxOrRes.viewer.role)
  ) {
    return json({ ok: false, error: "Forbidden" }, { status: 403 });
  }

  const updated = await setRead(id, isRead);
  if (!updated) return json({ ok: false, error: "Notification not found" }, { status: 404 });

  const clientItem = (await toClientNotifications([updated]))[0];
  return json({ ok: true, data: clientItem ?? (updated as AppNotification) });
}
