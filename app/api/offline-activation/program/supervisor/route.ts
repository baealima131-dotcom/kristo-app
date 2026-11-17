import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

import { supervisorTeamView } from "@/app/api/_lib/offlineActivationProgram";
import { guardProgram, programErrorResponse } from "@/app/api/_lib/offlineActivationProgramGuard";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function json(data: unknown, status = 200) {
  return NextResponse.json(data, { status, headers: { "Cache-Control": "no-store" } });
}

/** Supervisor: own limit, agents, invite codes and church progress. Never another team. */
export async function GET(req: NextRequest) {
  const ctx = await guardProgram(req, ["Supervisor"]);
  if (ctx instanceof NextResponse) return ctx;
  try {
    return json({ ok: true, team: await supervisorTeamView(ctx.userId) });
  } catch (error) {
    return programErrorResponse(error);
  }
}
