import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

import { addSupervisorByIdentifier } from "@/app/api/_lib/offlineActivationAdmin";
import { guardPlatformOfflineActivation } from "@/app/api/_lib/rbac";

export const runtime = "nodejs";

function json(data: unknown, init?: ResponseInit) {
  return NextResponse.json(data, init);
}

export async function POST(req: NextRequest) {
  const ctxOrRes = await guardPlatformOfflineActivation(req, ["System_Admin"]);
  if (ctxOrRes instanceof NextResponse) return ctxOrRes;

  const body = await req.json().catch(() => ({}));
  const identifier = String(body?.identifier || body?.email || body?.userId || "").trim();

  if (!identifier) {
    return json({ ok: false, error: "Email or userId is required." }, { status: 400 });
  }

  console.log("[KRISTO] supervisor add start", {
    byUserId: ctxOrRes.viewer.userId,
    identifier,
  });

  try {
    const result = await addSupervisorByIdentifier(identifier, ctxOrRes.viewer.userId);

    console.log("[KRISTO] supervisor add success", {
      byUserId: ctxOrRes.viewer.userId,
      supervisorUserId: result.user.userId,
    });

    return json({
      ok: true,
      supervisor: {
        userId: result.user.userId,
        email: result.user.email,
        fullName: result.user.fullName,
        platformRole: result.platformRole,
      },
    });
  } catch (error: any) {
    const message = String(error?.message || "Failed to add supervisor");
    console.warn("[KRISTO] supervisor add failed", {
      byUserId: ctxOrRes.viewer.userId,
      identifier,
      error: message,
    });
    return json({ ok: false, error: message }, { status: 400 });
  }
}
