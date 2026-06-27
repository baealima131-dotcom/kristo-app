import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

import { listActivationCodes } from "@/app/api/_lib/offlineActivationCodeStore";
import { guardPlatformOfflineActivation } from "@/app/api/_lib/rbac";

export const runtime = "nodejs";

function json(data: unknown, init?: ResponseInit) {
  return NextResponse.json(data, init);
}

export async function GET(req: NextRequest) {
  const ctxOrRes = await guardPlatformOfflineActivation(req, ["System_Admin"]);
  if (ctxOrRes instanceof NextResponse) return ctxOrRes;

  const limitRaw = Number(req.nextUrl.searchParams.get("limit") || "200");
  const limit = Number.isFinite(limitRaw) ? Math.max(1, Math.min(limitRaw, 1000)) : 200;

  const result = await listActivationCodes(limit);

  console.log("[KRISTO] activation codes list", {
    userId: ctxOrRes.viewer.userId,
    batches: result.totals.batches,
    codes: result.totals.codes,
  });

  return json({
    ok: true,
    batches: result.batches,
    codes: result.codes,
    totals: result.totals,
  });
}
