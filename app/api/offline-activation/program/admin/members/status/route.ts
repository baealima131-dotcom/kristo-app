import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

import { adminSetMemberStatus, type ProgramMemberStatus } from "@/app/api/_lib/offlineActivationProgram";
import { guardProgram, programErrorResponse } from "@/app/api/_lib/offlineActivationProgramGuard";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function json(data: unknown, status = 200) {
  return NextResponse.json(data, { status, headers: { "Cache-Control": "no-store" } });
}

/** System Admin: suspend, revoke or reactivate a supervisor/agent. History is kept. */
export async function POST(req: NextRequest) {
  const ctx = await guardProgram(req, ["System_Admin"], { allowLabAdminPass: true });
  if (ctx instanceof NextResponse) return ctx;
  const body = await req.json().catch(() => ({}));
  try {
    const member = await adminSetMemberStatus({
      actorUserId: ctx.userId,
      userId: String(body?.userId || ""),
      status: String(body?.status || "") as ProgramMemberStatus,
      reason: body?.reason,
    });
    return json({ ok: true, member });
  } catch (error) {
    return programErrorResponse(error);
  }
}
