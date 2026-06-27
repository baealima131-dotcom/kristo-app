import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

import { listSupervisorAgents } from "@/app/api/_lib/offlineActivationAgentStore";
import {
  buildSupervisorCodeActivity,
  computeAgentCodeStats,
  getSupervisorWorkspace,
} from "@/app/api/_lib/offlineActivationCodeStore";
import { guardPlatformOfflineActivation } from "@/app/api/_lib/rbac";

export const runtime = "nodejs";

function json(data: unknown, init?: ResponseInit) {
  return NextResponse.json(data, init);
}

export async function GET(req: NextRequest) {
  const ctxOrRes = await guardPlatformOfflineActivation(req, ["Supervisor"]);
  if (ctxOrRes instanceof NextResponse) return ctxOrRes;

  try {
    const workspace = await getSupervisorWorkspace(ctxOrRes.viewer.userId);
    const agents = await listSupervisorAgents(ctxOrRes.viewer.userId);
    const agentNameById = Object.fromEntries(agents.map((agent) => [agent.id, agent.fullName]));

    const agentsWithStats = agents.map((agent) => ({
      ...agent,
      stats: computeAgentCodeStats(workspace.codes, agent.id),
    }));

    const activity = await buildSupervisorCodeActivity(workspace.codes, ctxOrRes.viewer.userId, agentNameById);

    console.log("KRISTO_SUPERVISOR_DASHBOARD_LOAD", {
      userId: ctxOrRes.viewer.userId,
      stats: workspace.stats,
      agentCount: agents.length,
    });

    return json({
      ok: true,
      profile: workspace.profile,
      stats: workspace.stats,
      batches: workspace.batches,
      codes: workspace.codes,
      agents: agentsWithStats,
      activity,
    });
  } catch (error: any) {
    return json({ ok: false, error: String(error?.message || "Failed to load supervisor dashboard") }, { status: 400 });
  }
}
