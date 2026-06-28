import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

import { getAgentWorkspace } from "@/app/api/_lib/offlineActivationCodeStore";
import { guardPlatformOfflineActivation } from "@/app/api/_lib/rbac";

export const runtime = "nodejs";

function json(data: unknown, init?: ResponseInit) {
  return NextResponse.json(data, init);
}

export async function GET(req: NextRequest) {
  const ctxOrRes = await guardPlatformOfflineActivation(req, ["Agent"]);
  if (ctxOrRes instanceof NextResponse) return ctxOrRes;

  try {
    const workspace = await getAgentWorkspace(ctxOrRes.viewer.userId);

    console.log("KRISTO_AGENT_DASHBOARD_LOAD", {
      userId: ctxOrRes.viewer.userId,
      stats: workspace.stats,
      churchCount: workspace.churches.length,
    });

    return json({
      ok: true,
      profile: workspace.profile,
      stats: workspace.stats,
      churches: workspace.churches,
      batches: workspace.batches,
      codes: workspace.codes,
      activity: workspace.activity,
    });
  } catch (error: any) {
    return json({ ok: false, error: String(error?.message || "Failed to load agent dashboard") }, { status: 400 });
  }
}
