import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

import { supervisorAgentDetail } from "@/app/api/_lib/offlineActivationProgram";
import { guardProgram, programErrorResponse } from "@/app/api/_lib/offlineActivationProgramGuard";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function json(data: unknown, status = 200) {
  return NextResponse.json(data, { status, headers: { "Cache-Control": "no-store" } });
}

/** Supervisor: one of their own agents (?userId=). Other teams' agents return 404. */
export async function GET(req: NextRequest) {
  const ctx = await guardProgram(req, ["Supervisor"]);
  if (ctx instanceof NextResponse) return ctx;
  const userId = String(req.nextUrl.searchParams.get("userId") || "").trim();
  if (!userId) return json({ ok: false, error: "userId is required" }, 400);
  try {
    return json({ ok: true, ...(await supervisorAgentDetail({ supervisorUserId: ctx.userId, agentUserId: userId })) });
  } catch (error) {
    return programErrorResponse(error);
  }
}
