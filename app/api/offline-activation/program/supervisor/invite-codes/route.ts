import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

import { createAgentInviteCode } from "@/app/api/_lib/offlineActivationProgram";
import { guardProgram, programErrorResponse } from "@/app/api/_lib/offlineActivationProgramGuard";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function json(data: unknown, status = 200) {
  return NextResponse.json(data, { status, headers: { "Cache-Control": "no-store" } });
}

/** Supervisor: create an expiring, limited-use agent invite code within the agent limit. */
export async function POST(req: NextRequest) {
  const ctx = await guardProgram(req, ["Supervisor"]);
  if (ctx instanceof NextResponse) return ctx;
  const body = await req.json().catch(() => ({}));
  try {
    const result = await createAgentInviteCode({
      supervisorUserId: ctx.userId,
      maxUses: body?.maxUses,
      expiresInHours: body?.expiresInHours,
    });
    // The plain code is returned once and never stored.
    return json({ ok: true, code: result.code, invite: result.invite }, 201);
  } catch (error) {
    return programErrorResponse(error);
  }
}
