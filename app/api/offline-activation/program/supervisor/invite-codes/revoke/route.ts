import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

import { revokeAgentInviteCode } from "@/app/api/_lib/offlineActivationProgram";
import { guardProgram, programErrorResponse } from "@/app/api/_lib/offlineActivationProgramGuard";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function json(data: unknown, status = 200) {
  return NextResponse.json(data, { status, headers: { "Cache-Control": "no-store" } });
}

export async function POST(req: NextRequest) {
  const ctx = await guardProgram(req, ["Supervisor"]);
  if (ctx instanceof NextResponse) return ctx;
  const body = await req.json().catch(() => ({}));
  try {
    const invite = await revokeAgentInviteCode({
      actorUserId: ctx.userId,
      actorRole: "Supervisor",
      codeId: String(body?.codeId || ""),
    });
    return json({ ok: true, invite });
  } catch (error) {
    return programErrorResponse(error);
  }
}
