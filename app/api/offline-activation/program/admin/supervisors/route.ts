import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

import {
  adminInviteSupervisor,
  supervisorTeamView,
} from "@/app/api/_lib/offlineActivationProgram";
import { guardProgram, programErrorResponse } from "@/app/api/_lib/offlineActivationProgramGuard";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function json(data: unknown, status = 200) {
  return NextResponse.json(data, { status, headers: { "Cache-Control": "no-store" } });
}

/** System Admin: one supervisor's team (?userId=). */
export async function GET(req: NextRequest) {
  const ctx = await guardProgram(req, ["System_Admin"], { allowLabAdminPass: true });
  if (ctx instanceof NextResponse) return ctx;
  const userId = String(req.nextUrl.searchParams.get("userId") || "").trim();
  if (!userId) return json({ ok: false, error: "userId is required" }, 400);
  try {
    const from = req.nextUrl.searchParams.get("from") || undefined;
    const to = req.nextUrl.searchParams.get("to") || undefined;
    return json({ ok: true, team: await supervisorTeamView(userId, { from, to }) });
  } catch (error) {
    return programErrorResponse(error);
  }
}

/** System Admin: invite a supervisor by KRISTO ID + Church ID, optionally with an agent limit. */
export async function POST(req: NextRequest) {
  const ctx = await guardProgram(req, ["System_Admin"], { allowLabAdminPass: true });
  if (ctx instanceof NextResponse) return ctx;
  const body = await req.json().catch(() => ({}));
  try {
    const result = await adminInviteSupervisor({
      actorUserId: ctx.userId,
      kristoId: String(body?.kristoId || ""),
      churchId: String(body?.churchId || ""),
      agentLimit: body?.agentLimit,
    });
    return json({ ok: true, outcome: result.outcome, user: result.user, invitation: result.invitation || null });
  } catch (error) {
    return programErrorResponse(error);
  }
}
