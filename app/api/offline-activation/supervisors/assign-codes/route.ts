import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

import { assignCodesToSupervisor } from "@/app/api/_lib/offlineActivationCodeStore";
import { guardPlatformOfflineActivation } from "@/app/api/_lib/rbac";

export const runtime = "nodejs";

function json(data: unknown, init?: ResponseInit) {
  return NextResponse.json(data, init);
}

export async function POST(req: NextRequest) {
  const ctxOrRes = await guardPlatformOfflineActivation(req, ["System_Admin"]);
  if (ctxOrRes instanceof NextResponse) return ctxOrRes;

  const body = await req.json().catch(() => ({}));
  const supervisorUserId = String(body?.supervisorUserId || "").trim();
  const quantity = Number(body?.quantity);

  if (!supervisorUserId) {
    return json({ ok: false, error: "supervisorUserId is required." }, { status: 400 });
  }
  if (!Number.isFinite(quantity) || quantity < 1) {
    return json({ ok: false, error: "Quantity must be at least 1." }, { status: 400 });
  }

  console.log("[KRISTO] supervisor assign codes start", {
    byUserId: ctxOrRes.viewer.userId,
    supervisorUserId,
    quantity: Math.floor(quantity),
  });

  try {
    const result = await assignCodesToSupervisor({
      supervisorUserId,
      quantity: Math.floor(quantity),
      assignedBySystemAdminUserId: ctxOrRes.viewer.userId,
    });

    console.log("[KRISTO] supervisor assign codes success", {
      byUserId: ctxOrRes.viewer.userId,
      supervisorUserId,
      assignedCount: result.assignedCount,
    });

    return json({
      ok: true,
      supervisorUserId: result.supervisorUserId,
      assignedCount: result.assignedCount,
      codes: result.codes,
    });
  } catch (error: any) {
    const message = String(error?.message || "Failed to assign codes");
    console.warn("[KRISTO] supervisor assign codes failed", {
      byUserId: ctxOrRes.viewer.userId,
      supervisorUserId,
      error: message,
    });
    return json({ ok: false, error: message }, { status: 400 });
  }
}
