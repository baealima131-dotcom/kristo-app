import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

import { addSupervisorByKristoAndChurch } from "@/app/api/_lib/offlineActivationAdmin";
import { guardPlatformOfflineActivation } from "@/app/api/_lib/rbac";

export const runtime = "nodejs";

function json(data: unknown, init?: ResponseInit) {
  return NextResponse.json(data, init);
}

export async function POST(req: NextRequest) {
  const ctxOrRes = await guardPlatformOfflineActivation(req, ["System_Admin"]);
  if (ctxOrRes instanceof NextResponse) return ctxOrRes;

  const body = await req.json().catch(() => ({}));
  const kristoId = String(body?.kristoId || body?.userCode || "").trim();
  const churchId = String(body?.churchId || "").trim();

  if (!kristoId) {
    return json({ ok: false, error: "KRISTO ID is required." }, { status: 400 });
  }
  if (!churchId) {
    return json({ ok: false, error: "Church ID is required." }, { status: 400 });
  }

  console.log("[KRISTO] supervisor add start", {
    byUserId: ctxOrRes.viewer.userId,
    kristoId: kristoId.toUpperCase(),
    churchId,
  });

  try {
    const result = await addSupervisorByKristoAndChurch(
      kristoId,
      churchId,
      ctxOrRes.viewer.userId
    );

    console.log("[KRISTO] supervisor add success", {
      byUserId: ctxOrRes.viewer.userId,
      supervisorUserId: result.user.userId,
      kristoId: result.user.kristoId,
      churchId: result.user.churchId,
    });

    return json({
      ok: true,
      supervisor: {
        userId: result.user.userId,
        kristoId: result.user.kristoId,
        churchId: result.user.churchId,
        fullName: result.user.fullName,
        platformRole: result.platformRole,
      },
    });
  } catch (error: any) {
    const message = String(error?.message || "Failed to add supervisor");
    console.warn("[KRISTO] supervisor add failed", {
      byUserId: ctxOrRes.viewer.userId,
      kristoId: kristoId.toUpperCase(),
      churchId,
      error: message,
    });
    return json({ ok: false, error: message }, { status: 400 });
  }
}
