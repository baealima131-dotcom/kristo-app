import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

import { updateSupervisorAgent } from "@/app/api/_lib/offlineActivationAgentStore";
import { guardPlatformOfflineActivation } from "@/app/api/_lib/rbac";

export const runtime = "nodejs";

function json(data: unknown, init?: ResponseInit) {
  return NextResponse.json(data, init);
}

export async function POST(req: NextRequest) {
  const ctxOrRes = await guardPlatformOfflineActivation(req, ["Supervisor"]);
  if (ctxOrRes instanceof NextResponse) return ctxOrRes;

  const body = await req.json().catch(() => ({}));
  const agentId = String(body?.agentId || "").trim();
  if (!agentId) return json({ ok: false, error: "agentId is required." }, { status: 400 });

  const statusRaw = body?.status !== undefined ? String(body.status).trim() : undefined;

  try {
    const agent = await updateSupervisorAgent({
      supervisorUserId: ctxOrRes.viewer.userId,
      agentId,
      ...(body?.fullName !== undefined ? { fullName: String(body.fullName || "").trim() } : {}),
      ...(body?.phone !== undefined ? { phone: String(body.phone || "").trim() } : {}),
      ...(statusRaw !== undefined
        ? { status: statusRaw === "inactive" ? "inactive" : "active" }
        : {}),
    });

    return json({ ok: true, agent });
  } catch (error: any) {
    return json({ ok: false, error: String(error?.message || "Failed to update agent") }, { status: 400 });
  }
}
