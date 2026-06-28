import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

import {
  assignCodesToSupervisor,
  readActivationCodeStoreForDebug,
} from "@/app/api/_lib/offlineActivationCodeStore";
import {
  buildActivationStoreRouteDebug,
  logActivationRouteDiagnostics,
} from "@/app/api/_lib/offlineActivationStoreDiagnostics";
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

  const beforeStore = await readActivationCodeStoreForDebug();
  const beforeDebug = buildActivationStoreRouteDebug("assign-codes-before", beforeStore, {
    supervisorUserId,
    requestedQuantity: Math.floor(quantity),
  });
  logActivationRouteDiagnostics(beforeDebug);

  try {
    const result = await assignCodesToSupervisor({
      supervisorUserId,
      quantity: Math.floor(quantity),
      assignedBySystemAdminUserId: ctxOrRes.viewer.userId,
    });

    const afterStore = await readActivationCodeStoreForDebug();
    const afterDebug = buildActivationStoreRouteDebug("assign-codes-after", afterStore, {
      supervisorUserId,
      assignedCount: result.assignedCount,
    });
    logActivationRouteDiagnostics(afterDebug);

    return json({
      ok: true,
      supervisorUserId: result.supervisorUserId,
      assignedCount: result.assignedCount,
      codes: result.codes,
      _storeDebug: { before: beforeDebug, after: afterDebug },
    });
  } catch (error: any) {
    const message = String(error?.message || "Failed to assign codes");
    console.warn("[KRISTO] activation route assign-codes-after", {
      ok: false,
      error: message,
      before: beforeDebug,
    });
    return json({ ok: false, error: message, _storeDebug: { before: beforeDebug } }, { status: 400 });
  }
}
