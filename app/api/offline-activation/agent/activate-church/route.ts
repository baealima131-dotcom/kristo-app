import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

import { activateChurchWithAgentCode } from "@/app/api/_lib/offlineActivationCodeStore";
import { guardPlatformOfflineActivation } from "@/app/api/_lib/rbac";

export const runtime = "nodejs";

function json(data: unknown, init?: ResponseInit) {
  return NextResponse.json(data, init);
}

export async function POST(req: NextRequest) {
  const ctxOrRes = await guardPlatformOfflineActivation(req, ["Agent"]);
  if (ctxOrRes instanceof NextResponse) return ctxOrRes;

  try {
    const body = await req.json().catch(() => ({}));
    const churchId = String(body?.churchId || "").trim();
    const activationCode = String(body?.activationCode || "").trim();

    if (!churchId || !activationCode) {
      return json({ ok: false, error: "churchId and activationCode are required" }, { status: 400 });
    }

    const result = await activateChurchWithAgentCode({
      agentUserId: ctxOrRes.viewer.userId,
      churchId,
      activationCode,
    });

    return json({
      ok: true,
      code: result.code,
      church: result.church,
      redeemedByAgentId: result.redeemedByAgentId,
      redeemedByUserId: result.redeemedByUserId,
    });
  } catch (error: any) {
    return json(
      { ok: false, error: String(error?.message || "Failed to activate church") },
      { status: 400 }
    );
  }
}
