import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

import { agentWorkView } from "@/app/api/_lib/offlineActivationProgram";
import { guardProgram, programErrorResponse } from "@/app/api/_lib/offlineActivationProgramGuard";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function json(data: unknown, status = 200) {
  return NextResponse.json(data, { status, headers: { "Cache-Control": "no-store" } });
}

/** Agent: own churches and their status; the supervisor comes from server records. */
export async function GET(req: NextRequest) {
  const ctx = await guardProgram(req, ["Agent"]);
  if (ctx instanceof NextResponse) return ctx;
  try {
    return json({ ok: true, work: await agentWorkView(ctx.userId, ctx.supervisorUserId!) });
  } catch (error) {
    return programErrorResponse(error);
  }
}
