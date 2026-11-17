import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

import { supervisorAgentDetail } from "@/app/api/_lib/offlineActivationProgram";
import { guardProgram, programErrorResponse } from "@/app/api/_lib/offlineActivationProgramGuard";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function json(data: unknown, status = 200) {
  return NextResponse.json(data, { status, headers: { "Cache-Control": "no-store" } });
}

/** System Admin: one agent and the churches they supported (?userId=). */
export async function GET(req: NextRequest) {
  const ctx = await guardProgram(req, ["System_Admin"], { allowLabAdminPass: true });
  if (ctx instanceof NextResponse) return ctx;
  const userId = String(req.nextUrl.searchParams.get("userId") || "").trim();
  if (!userId) return json({ ok: false, error: "userId is required" }, 400);
  try {
    return json({ ok: true, ...(await supervisorAgentDetail({ supervisorUserId: null, agentUserId: userId })) });
  } catch (error) {
    return programErrorResponse(error);
  }
}
