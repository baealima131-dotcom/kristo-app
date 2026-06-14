import { NextRequest, NextResponse } from "next/server";
import { guard } from "@/app/api/_lib/rbac";
import { logAudit } from "@/app/api/_lib/audit";
import { createNotification } from "@/app/api/_lib/notifications";
import {
  getRoleReviewRequests,
  updateRoleReviewStatus,
  createRoleReviewRequest,
  type RoleReviewStatus,
} from "@/app/api/_lib/securityStore";

type ApiErr = { ok: false; error: string; details?: unknown };

function json(data: unknown, init?: ResponseInit) {
  return NextResponse.json(data, init);
}

function isRoleReviewStatus(x: unknown): x is RoleReviewStatus {
  return x === "pending" || x === "approved" || x === "denied";
}

export async function GET(req: NextRequest) {
  const ctxOrRes = await guard(req, ["Pastor", "Church_Admin", "Leader", "Ministry_Leader"]);
  if (ctxOrRes instanceof NextResponse) return ctxOrRes;

  const { churchId } = ctxOrRes;
  const data = await getRoleReviewRequests(churchId);
  return json({ ok: true, data });
}

export async function PATCH(req: NextRequest) {
  const ctxOrRes = await guard(req, ["Pastor", "Church_Admin", "System_Admin"]);
  if (ctxOrRes instanceof NextResponse) return ctxOrRes;

  const { churchId, viewer } = ctxOrRes;

  try {
    const body = await req.json().catch(() => null);
    const id = String(body?.id || "").trim();
    const status = body?.status;
    const userId = String(body?.userId || "").trim();

    if (!id) {
      return json({ ok: false, error: "id is required" } satisfies ApiErr, { status: 400 });
    }

    if (!isRoleReviewStatus(status)) {
      return json({ ok: false, error: "Invalid status" } satisfies ApiErr, { status: 400 });
    }

    const next = await updateRoleReviewStatus(churchId, id, status);

    let notification = null;
    if (userId) {
      notification = await createNotification({
        churchId,
        type: "Generic",
        title: status === "approved" ? "Role request approved" : "Role request denied",
        message: `Your role review request is now ${status}.`,
        targetUserId: userId,
      });
    }

    await logAudit({
      req,
      viewer: { ...viewer, churchId } as any,
      churchId,
      action: "GENERIC",
      targetType: "security_role_review",
      targetId: id,
      message: `${viewer.name || viewer.userId} changed role review ${id} to ${status}.`,
      meta: { id, status, userId },
    });

    return json({ ok: true, data: next, notification });
  } catch (error) {
    return json(
      {
        ok: false,
        error: "Failed to update role review status",
        details: error instanceof Error ? error.message : String(error),
      } satisfies ApiErr,
      { status: 500 }
    );
  }
}

export async function POST(req: NextRequest) {
  const ctxOrRes = await guard(req, ["Pastor", "Church_Admin", "Leader", "Ministry_Leader", "Member"]);
  if (ctxOrRes instanceof NextResponse) return ctxOrRes;

  const { churchId, viewer } = ctxOrRes;

  try {
    const body = await req.json().catch(() => null);

    const created = await createRoleReviewRequest({
      churchId,
      userId: String(body?.userId || viewer.userId || "").trim() || undefined,
      name: String(body?.name || viewer.name || viewer.userId || "Unknown User"),
      currentRole: String(body?.currentRole || "Member"),
      requestedRole: String(body?.requestedRole || "Leader"),
      reason: String(body?.reason || "No reason provided."),
      requestedAt: String(body?.requestedAt || "Just now"),
      status: "pending",
    });

    await logAudit({
      req,
      viewer: { ...viewer, churchId } as any,
      churchId,
      action: "GENERIC",
      targetType: "security_role_review",
      targetId: created.id,
      message: `${viewer.name || viewer.userId} created role review request ${created.id}.`,
      meta: created,
    });

    return json({ ok: true, data: created }, { status: 201 });
  } catch (error) {
    return json(
      {
        ok: false,
        error: "Failed to create role review request",
        details: error instanceof Error ? error.message : String(error),
      } satisfies ApiErr,
      { status: 500 }
    );
  }
}
