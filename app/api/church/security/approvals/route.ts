import { NextRequest, NextResponse } from "next/server";
import { guard } from "@/app/api/_lib/rbac";
import { logAudit } from "@/app/api/_lib/audit";
import {
  getApprovalRequests,
  updateApprovalStatus,
  createApprovalRequest,
  type ApprovalStatus,
} from "@/app/api/_lib/securityStore";

type ApiErr = { ok: false; error: string; details?: unknown };

function json(data: unknown, init?: ResponseInit) {
  return NextResponse.json(data, init);
}

function isApprovalStatus(x: unknown): x is ApprovalStatus {
  return x === "pending" || x === "approved" || x === "denied";
}

export async function GET(req: NextRequest) {
  const ctxOrRes = await guard(req, ["Pastor", "Church_Admin", "Leader", "Ministry_Leader"]);
  if (ctxOrRes instanceof NextResponse) return ctxOrRes;

  const { churchId } = ctxOrRes;
  const data = await getApprovalRequests(churchId);
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

    if (!id) {
      return json({ ok: false, error: "id is required" } satisfies ApiErr, { status: 400 });
    }

    if (!isApprovalStatus(status)) {
      return json({ ok: false, error: "Invalid status" } satisfies ApiErr, { status: 400 });
    }

    const next = await updateApprovalStatus(churchId, id, status);

    await logAudit({
      req,
      viewer: { ...viewer, churchId } as any,
      churchId,
      action: "GENERIC",
      targetType: "security_approval",
      targetId: id,
      message: `${viewer.name || viewer.userId} changed approval ${id} to ${status}.`,
      meta: { id, status },
    });

    return json({ ok: true, data: next });
  } catch (error) {
    return json(
      {
        ok: false,
        error: "Failed to update approval status",
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

    const created = await createApprovalRequest({
      churchId,
      name: String(body?.name || viewer.name || viewer.userId || "Unknown User"),
      role: String(body?.role || "Church Member"),
      device: String(body?.device || "Unknown Device"),
      location: String(body?.location || "Unknown Location"),
      requestedAt: String(body?.requestedAt || "Just now"),
      status: "pending",
      trustedDevice: typeof body?.trustedDevice === "boolean" ? body.trustedDevice : false,
      knownLocation: typeof body?.knownLocation === "boolean" ? body.knownLocation : false,
      failedAttempts: typeof body?.failedAttempts === "number" ? body.failedAttempts : 0,
      requestedRoleLevel: typeof body?.requestedRoleLevel === "number" ? body.requestedRoleLevel : 1,
    });

    await logAudit({
      req,
      viewer: { ...viewer, churchId } as any,
      churchId,
      action: "GENERIC",
      targetType: "security_approval",
      targetId: created.id,
      message: `${viewer.name || viewer.userId} created approval request ${created.id}.`,
      meta: created,
    });

    return json({ ok: true, data: created }, { status: 201 });
  } catch (error) {
    return json(
      {
        ok: false,
        error: "Failed to create approval request",
        details: error instanceof Error ? error.message : String(error),
      } satisfies ApiErr,
      { status: 500 }
    );
  }
}
