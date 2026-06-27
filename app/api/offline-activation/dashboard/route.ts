import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

import { getActivationDashboard } from "@/app/api/_lib/offlineActivationCodeStore";
import { guardPlatformOfflineActivation } from "@/app/api/_lib/rbac";

export const runtime = "nodejs";

function json(data: unknown, init?: ResponseInit) {
  return NextResponse.json(data, init);
}

export async function GET(req: NextRequest) {
  const ctxOrRes = await guardPlatformOfflineActivation(req, ["System_Admin"]);
  if (ctxOrRes instanceof NextResponse) return ctxOrRes;

  const result = await getActivationDashboard();

  console.log("[KRISTO] activation dashboard", {
    userId: ctxOrRes.viewer.userId,
    stats: result.stats,
  });

  return json({
    ok: true,
    stats: result.stats,
  });
}
