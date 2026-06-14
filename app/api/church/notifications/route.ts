import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

import { guard } from "@/app/api/_lib/rbac";
import {
  listNotifications,
  countNotifications,
  setRead,
  removeNotification,
  createNotification,
  toClientNotification,
  toClientNotifications,
  type NotificationType,
} from "@/app/api/_lib/notifications";
import { resolveActorFromViewer } from "@/app/api/_lib/notificationActor";
import {
  parseNotificationListScope,
  scopeToIncludeAllTargets,
  type NotificationListScope,
} from "@/app/api/_lib/notificationScope";

function json(data: any, init?: ResponseInit) {
  return NextResponse.json(data, init);
}

function resolveScopeFromRequest(req: NextRequest, role: string): NotificationListScope {
  const url = new URL(req.url);
  const legacyAll =
    url.searchParams.get("all") === "1" || url.searchParams.get("all") === "true";
  const rawScope = url.searchParams.get("scope") || (legacyAll ? "churchAdmin" : "forMe");
  return parseNotificationListScope(rawScope, role);
}

async function assertNotificationVisible(args: {
  churchId: string;
  userId: string;
  role: string;
  id: string;
  scope: NotificationListScope;
}) {
  const includeAllTargets = scopeToIncludeAllTargets(args.scope);
  const visible = await listNotifications({
    churchId: args.churchId,
    userId: args.userId,
    unreadOnly: false,
    limit: 5000,
    includeAllTargets,
  });
  return visible.find((n) => String(n.id) === args.id) ?? null;
}

export async function GET(req: NextRequest) {
  const ctxOrRes = await guard(req);
  if (ctxOrRes instanceof NextResponse) return ctxOrRes;

  const url = new URL(req.url);
  const unreadOnly = url.searchParams.get("unread") === "1" || url.searchParams.get("unread") === "true";
  const limit = Number(url.searchParams.get("limit") || "100");
  const role = String(ctxOrRes.viewer.role || "");
  const scope = resolveScopeFromRequest(req, role);
  const includeAllTargets = scopeToIncludeAllTargets(scope);

  const listArgs = {
    churchId: ctxOrRes.churchId,
    userId: ctxOrRes.viewer.userId,
    unreadOnly,
    limit: Number.isFinite(limit) ? Math.min(Math.max(1, limit), 500) : 100,
    includeAllTargets,
  };

  const items = await listNotifications(listArgs);
  const data = await toClientNotifications(items);
  const unreadCount = await countNotifications({
    churchId: ctxOrRes.churchId,
    userId: ctxOrRes.viewer.userId,
    unreadOnly: true,
    includeAllTargets,
  });

  return json({
    ok: true,
    data,
    meta: {
      scope,
      unreadCount,
      limit: listArgs.limit,
      canUseChurchAdminScope:
        role === "Pastor" || role === "Church_Admin" || role === "System_Admin",
    },
  });
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
  const scope = resolveScopeFromRequest(req, role);

  const found = await assertNotificationVisible({
    churchId: ctxOrRes.churchId,
    userId: ctxOrRes.viewer.userId,
    role,
    id,
    scope,
  });
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
  const scope = resolveScopeFromRequest(req, role);

  const found = await assertNotificationVisible({
    churchId: ctxOrRes.churchId,
    userId: ctxOrRes.viewer.userId,
    role,
    id,
    scope,
  });
  if (!found) {
    return json({ ok: false, error: "Notification not found" }, { status: 404 });
  }

  const removed = await removeNotification(id);
  if (!removed) return json({ ok: false, error: "Notification not found" }, { status: 404 });

  return json({ ok: true, data: removed });
}
