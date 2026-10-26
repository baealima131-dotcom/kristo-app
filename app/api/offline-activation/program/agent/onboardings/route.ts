import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

import { upsertChurchOnboarding } from "@/app/api/_lib/offlineActivationProgram";
import { guardProgram, programErrorResponse } from "@/app/api/_lib/offlineActivationProgramGuard";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function json(data: unknown, status = 200) {
  return NextResponse.json(data, { status, headers: { "Cache-Control": "no-store" } });
}

/**
 * Agent: invite/register a church by the leader's KRISTO ID (+ Church ID once the
 * leader has registered it through the normal Kristo flow). Repeating the same
 * request returns the existing record. Grants the agent no church authority.
 */
export async function POST(req: NextRequest) {
  const ctx = await guardProgram(req, ["Agent"]);
  if (ctx instanceof NextResponse) return ctx;
  const body = await req.json().catch(() => ({}));
  try {
    const result = await upsertChurchOnboarding({
      agentUserId: ctx.userId,
      supervisorUserId: ctx.supervisorUserId!,
      leaderKristoId: String(body?.leaderKristoId || ""),
      churchId: body?.churchId ? String(body.churchId) : undefined,
    });
    return json({ ok: true, created: result.created, onboarding: result.onboarding }, result.created ? 201 : 200);
  } catch (error) {
    return programErrorResponse(error);
  }
}
