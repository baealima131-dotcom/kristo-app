import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

import {
  createSupervisorAgent,
  listSupervisorAgents,
} from "@/app/api/_lib/offlineActivationAgentStore";
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
  const fullName = String(body?.fullName || body?.name || "").trim();
  const phone = String(body?.phone || body?.phoneNumber || "").trim();
  const statusRaw = String(body?.status || "active").trim();
  const status = statusRaw === "inactive" ? "inactive" : "active";

  if (!fullName) return json({ ok: false, error: "Agent name is required." }, { status: 400 });
  if (!phone) return json({ ok: false, error: "Phone number is required." }, { status: 400 });

  try {
    const agent = await createSupervisorAgent({
      supervisorUserId: ctxOrRes.viewer.userId,
      fullName,
      phone,
      status,
    });

    console.log("KRISTO_SUPERVISOR_AGENT_CREATED", {
      supervisorUserId: ctxOrRes.viewer.userId,
      agentId: agent.id,
    });

    return json({ ok: true, agent });
  } catch (error: any) {
    return json({ ok: false, error: String(error?.message || "Failed to add agent") }, { status: 400 });
  }
}
