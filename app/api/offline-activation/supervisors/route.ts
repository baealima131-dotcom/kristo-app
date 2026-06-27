import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

import { listSupervisorSummaries } from "@/app/api/_lib/offlineActivationCodeStore";
import { guardPlatformOfflineActivation } from "@/app/api/_lib/rbac";

export const runtime = "nodejs";

function json(data: unknown, init?: ResponseInit) {
  return NextResponse.json(data, init);
}

export async function GET(req: NextRequest) {
  const ctxOrRes = await guardPlatformOfflineActivation(req, ["System_Admin"]);
  if (ctxOrRes instanceof NextResponse) return ctxOrRes;

  const supervisors = await listSupervisorSummaries();

  console.log("[KRISTO] supervisors list", {
    userId: ctxOrRes.viewer.userId,
    count: supervisors.length,
  });

  return json({
    ok: true,
    supervisors,
    count: supervisors.length,
  });
}
