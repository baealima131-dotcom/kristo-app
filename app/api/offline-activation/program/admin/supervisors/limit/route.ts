import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

import { adminSetSupervisorLimit } from "@/app/api/_lib/offlineActivationProgram";
import { guardProgram, programErrorResponse } from "@/app/api/_lib/offlineActivationProgramGuard";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function json(data: unknown, status = 200) {
  return NextResponse.json(data, { status, headers: { "Cache-Control": "no-store" } });
}

export async function POST(req: NextRequest) {
  const ctx = await guardProgram(req, ["System_Admin"], { allowLabAdminPass: true });
  if (ctx instanceof NextResponse) return ctx;
  const body = await req.json().catch(() => ({}));
  try {
    const member = await adminSetSupervisorLimit({
      actorUserId: ctx.userId,
      supervisorUserId: String(body?.userId || ""),
      agentLimit: Number(body?.agentLimit),
    });
    return json({ ok: true, member });
  } catch (error) {
    return programErrorResponse(error);
  }
}
