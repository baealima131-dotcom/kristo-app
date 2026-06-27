import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

import { deleteSupervisorAgent } from "@/app/api/_lib/offlineActivationAgentStore";
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

  try {
    const removed = await deleteSupervisorAgent(ctxOrRes.viewer.userId, agentId);
    if (!removed) return json({ ok: false, error: "Agent not found." }, { status: 404 });

    console.log("KRISTO_SUPERVISOR_AGENT_DELETED", {
      supervisorUserId: ctxOrRes.viewer.userId,
      agentId,
    });

    return json({ ok: true, agentId });
  } catch (error: any) {
    return json({ ok: false, error: String(error?.message || "Failed to delete agent") }, { status: 400 });
  }
}
