import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

import { inviteAgentByKristoAndChurch } from "@/app/api/_lib/offlineActivationAdmin";
import { listSupervisorAgents } from "@/app/api/_lib/offlineActivationAgentStore";
import { computeAgentCodeStats, getSupervisorWorkspace } from "@/app/api/_lib/offlineActivationCodeStore";
import { guardPlatformOfflineActivation } from "@/app/api/_lib/rbac";

export const runtime = "nodejs";

function json(data: unknown, init?: ResponseInit) {
  return NextResponse.json(data, init);
}

export async function GET(req: NextRequest) {
  const ctxOrRes = await guardPlatformOfflineActivation(req, ["Supervisor"]);
  if (ctxOrRes instanceof NextResponse) return ctxOrRes;

  const agents = await listSupervisorAgents(ctxOrRes.viewer.userId);
  const workspace = await getSupervisorWorkspace(ctxOrRes.viewer.userId);

  return json({
    ok: true,
    agents: agents.map((agent) => ({
      ...agent,
      stats: computeAgentCodeStats(workspace.codes, agent.id),
    })),
  });
}

export async function POST(req: NextRequest) {
  const ctxOrRes = await guardPlatformOfflineActivation(req, ["Supervisor"]);
  if (ctxOrRes instanceof NextResponse) return ctxOrRes;

  const body = await req.json().catch(() => ({}));
  const kristoId = String(body?.kristoId || body?.kristoID || "").trim();
  const churchId = String(body?.churchId || body?.churchID || "").trim();

  if (!kristoId) return json({ ok: false, error: "KRISTO ID is required." }, { status: 400 });
  if (!churchId) return json({ ok: false, error: "Church ID is required." }, { status: 400 });

  try {
    const result = await inviteAgentByKristoAndChurch(
      kristoId,
      churchId,
      ctxOrRes.viewer.userId
    );

    console.log("KRISTO_SUPERVISOR_AGENT_INVITED", {
      supervisorUserId: ctxOrRes.viewer.userId,
      outcome: result.outcome,
      kristoId: result.user.kristoId,
      churchId: result.user.churchId,
      agentId: result.agent?.id || null,
      invitationId: result.invitation?.id || null,
    });

    return json({
      ok: true,
      outcome: result.outcome,
      user: result.user,
      agent: result.agent,
      invitation: result.invitation,
    });
  } catch (error: any) {
    return json({ ok: false, error: String(error?.message || "Failed to invite agent") }, { status: 400 });
  }
}
