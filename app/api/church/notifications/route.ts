import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

import { guard } from "@/app/api/_lib/rbac";
import {
  listNotifications,
  setRead,
  removeNotification,
  createNotification,
  toClientNotification,
  toClientNotifications,
  type NotificationType,
} from "@/app/api/_lib/notifications";
import { resolveActorFromViewer } from "@/app/api/_lib/notificationActor";

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

  const items = await listNotifications({
    churchId: ctxOrRes.churchId,
    userId: ctxOrRes.viewer.userId,
    unreadOnly,
    limit: Number.isFinite(limit) ? limit : 50,
    includeAllTargets: canSeeAllTargets,
  });

  const data = await toClientNotifications(items);

  return json({ ok: true, data });
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

  const actor = await resolveActorFromViewer(ctxOrRes.viewer, req);
  const actorName = String(body?.actorName || actor.actorName).trim();
  const actorUserId = String(body?.actorUserId || actor.actorUserId).trim();
  const actorAvatarUri = String(body?.actorAvatarUri || body?.avatarUri || actor.actorAvatarUri || "").trim();
  const actorRole = String(body?.actorRole || actor.actorRole).trim();

  if (!churchId) {
    return json({ ok: false, error: "Missing churchId" }, { status: 400 });
  }

  if (!title) {
    return json({ ok: false, error: "Missing title" }, { status: 400 });
  }

  const created = await createNotification({
    churchId,
    type,
    title,
    message,
    targetUserId,
    actorName,
    actorUserId,
    actorAvatarUri: actorAvatarUri || undefined,
    actorRole,
  });

  const data = await toClientNotification(created);

  return json({ ok: true, data });
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

  const visible = await listNotifications({
    churchId: ctxOrRes.churchId,
    userId: ctxOrRes.viewer.userId,
    unreadOnly: false,
    limit: 5000,
    includeAllTargets: canSeeAllTargets,
  });

  const found = visible.find((n) => String(n.id) === id) ?? null;
  if (!found) {
    return json({ ok: false, error: "Notification not found" }, { status: 404 });
  }

  const updated = await setRead(id, isRead);
  if (!updated) return json({ ok: false, error: "Notification not found" }, { status: 404 });

  const data = await toClientNotification(updated);

  return json({ ok: true, data });
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

  const visible = await listNotifications({
    churchId: ctxOrRes.churchId,
    userId: ctxOrRes.viewer.userId,
    unreadOnly: false,
    limit: 5000,
    includeAllTargets: canSeeAllTargets,
  });

  const found = visible.find((n) => String(n.id) === id) ?? null;
  if (!found) {
    return json({ ok: false, error: "Notification not found" }, { status: 404 });
  }

  const removed = await removeNotification(id);
  if (!removed) return json({ ok: false, error: "Notification not found" }, { status: 404 });

  return json({ ok: true, data: removed });
}
