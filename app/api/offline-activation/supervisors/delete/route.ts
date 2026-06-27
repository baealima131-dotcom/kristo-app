import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

import { removeSupervisor } from "@/app/api/_lib/offlineActivationCodeStore";
import { guardPlatformOfflineActivation } from "@/app/api/_lib/rbac";

export const runtime = "nodejs";

function json(data: unknown, init?: ResponseInit) {
  return NextResponse.json(data, init);
}

export async function POST(req: NextRequest) {
  const ctxOrRes = await guardPlatformOfflineActivation(req, ["System_Admin"]);
  if (ctxOrRes instanceof NextResponse) return ctxOrRes;

  const body = await req.json().catch(() => ({}));
  const userId = String(body?.userId || "").trim();
  const invitationId = String(body?.invitationId || "").trim() || undefined;

  if (!userId) {
    return json({ ok: false, error: "userId is required." }, { status: 400 });
  }

  console.log("KRISTO_SUPERVISOR_DELETE_START", {
    byUserId: ctxOrRes.viewer.userId,
    targetUserId: userId,
    invitationId: invitationId || null,
  });

  try {
    const result = await removeSupervisor({
      userId,
      invitationId,
      removedByUserId: ctxOrRes.viewer.userId,
    });

    console.log("KRISTO_SUPERVISOR_DELETE_SUCCESS", {
      byUserId: ctxOrRes.viewer.userId,
      targetUserId: userId,
      outcome: result.outcome,
      releasedCodes: result.releasedCodes,
    });

    return json({
      ok: true,
      outcome: result.outcome,
      releasedCodes: result.releasedCodes,
      userId: result.userId,
    });
  } catch (error: any) {
    const message = String(error?.message || "Failed to delete supervisor");
    console.warn("KRISTO_SUPERVISOR_DELETE_FAILED", {
      byUserId: ctxOrRes.viewer.userId,
      targetUserId: userId,
      error: message,
    });
    return json({ ok: false, error: message }, { status: 400 });
  }
}
