import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

import { getSupervisorAgent, isAcceptedAgentStatus } from "@/app/api/_lib/offlineActivationAgentStore";
import { assignCodesToAgent } from "@/app/api/_lib/offlineActivationCodeStore";
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
  const quantity = Math.floor(Number(body?.quantity));

  if (!agentId) return json({ ok: false, error: "agentId is required." }, { status: 400 });
  if (!Number.isFinite(quantity) || quantity < 1) {
    return json({ ok: false, error: "Quantity must be at least 1." }, { status: 400 });
  }

  const agent = await getSupervisorAgent(ctxOrRes.viewer.userId, agentId);
  if (!agent) return json({ ok: false, error: "Agent not found." }, { status: 404 });
  if (!isAcceptedAgentStatus(agent.status)) {
    return json({ ok: false, error: "Cannot assign codes until the agent accepts the invitation." }, { status: 400 });
  }

  try {
    const result = await assignCodesToAgent({
      supervisorUserId: ctxOrRes.viewer.userId,
      agentId,
      quantity,
    });

    console.log("KRISTO_SUPERVISOR_ASSIGN_CODES_TO_AGENT", {
      supervisorUserId: ctxOrRes.viewer.userId,
      agentId,
      assignedCount: result.assignedCount,
    });

    return json({
      ok: true,
      assignedCount: result.assignedCount,
      agentId: result.agentId,
    });
  } catch (error: any) {
    return json({ ok: false, error: String(error?.message || "Failed to assign codes") }, { status: 400 });
  }
}
