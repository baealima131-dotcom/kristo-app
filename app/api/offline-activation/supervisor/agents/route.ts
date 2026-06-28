import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

import {
  createSupervisorAgent,
  listSupervisorAgents,
} from "@/app/api/_lib/offlineActivationAgentStore";
import { resolveAgentRegistrationByKristoAndChurch } from "@/app/api/_lib/offlineActivationAdmin";
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
  const statusRaw = String(body?.status || "active").trim();
  const status = statusRaw === "inactive" ? "inactive" : "active";

  if (!kristoId) return json({ ok: false, error: "KRISTO ID is required." }, { status: 400 });
  if (!churchId) return json({ ok: false, error: "Church ID is required." }, { status: 400 });

  try {
    const resolved = await resolveAgentRegistrationByKristoAndChurch(kristoId, churchId);

    const agent = await createSupervisorAgent({
      supervisorUserId: ctxOrRes.viewer.userId,
      kristoId: resolved.kristoId,
      churchId: resolved.churchId,
      fullName: resolved.fullName || resolved.kristoId,
      phone: resolved.phone,
      avatarUrl: resolved.avatarUrl,
      linkedUserId: resolved.userId,
      status,
    });

    console.log("KRISTO_SUPERVISOR_AGENT_CREATED", {
      supervisorUserId: ctxOrRes.viewer.userId,
      agentId: agent.id,
      kristoId: agent.kristoId,
      churchId: agent.churchId,
    });

    return json({ ok: true, agent });
  } catch (error: any) {
    return json({ ok: false, error: String(error?.message || "Failed to add agent") }, { status: 400 });
  }
}
