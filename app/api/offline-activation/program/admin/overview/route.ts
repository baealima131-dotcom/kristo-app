import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

import { adminOverview } from "@/app/api/_lib/offlineActivationProgram";
import { guardProgram, programErrorResponse } from "@/app/api/_lib/offlineActivationProgramGuard";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function json(data: unknown, status = 200) {
  return NextResponse.json(data, { status, headers: { "Cache-Control": "no-store" } });
}

/** System Admin: totals, supervisors, their agents and church progress (optional ?from=&to= dates). */
export async function GET(req: NextRequest) {
  const ctx = await guardProgram(req, ["System_Admin"], { allowLabAdminPass: true });
  if (ctx instanceof NextResponse) return ctx;
  try {
    const from = req.nextUrl.searchParams.get("from") || undefined;
    const to = req.nextUrl.searchParams.get("to") || undefined;
    return json({ ok: true, overview: await adminOverview({ from, to }) });
  } catch (error) {
    return programErrorResponse(error);
  }
}
