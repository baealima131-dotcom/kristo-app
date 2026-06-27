import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

import { getOfflineActivationChurchActivity } from "@/app/api/_lib/offlineActivationCodeStore";
import { guardPlatformOfflineActivation } from "@/app/api/_lib/rbac";

export const runtime = "nodejs";

function json(data: unknown, init?: ResponseInit) {
  return NextResponse.json(data, init);
}

export async function GET(req: NextRequest) {
  const ctxOrRes = await guardPlatformOfflineActivation(req, ["System_Admin"]);
  if (ctxOrRes instanceof NextResponse) return ctxOrRes;

  const month = String(req.nextUrl.searchParams.get("month") || "").trim();

  const result = await getOfflineActivationChurchActivity(month || undefined);

  console.log("[KRISTO] offline activation church activity", {
    userId: ctxOrRes.viewer.userId,
    month: result.month,
    churchCount: result.churches.length,
  });

  return json({
    ok: true,
    month: result.month,
    churches: result.churches,
  });
}
