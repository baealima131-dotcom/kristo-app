import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

import { redeemAgentInviteCode } from "@/app/api/_lib/offlineActivationProgram";
import { guardProgramUser, programErrorResponse } from "@/app/api/_lib/offlineActivationProgramGuard";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function json(data: unknown, status = 200) {
  return NextResponse.json(data, { status, headers: { "Cache-Control": "no-store" } });
}

/** Any signed-in member: become an agent with a supervisor's invite code. */
export async function POST(req: NextRequest) {
  const user = await guardProgramUser(req);
  if (user instanceof NextResponse) return user;
  const body = await req.json().catch(() => ({}));
  try {
    const result = await redeemAgentInviteCode({ userId: user.userId, code: String(body?.code || "") });
    return json({
      ok: true,
      platformRole: "Agent",
      supervisorUserId: result.supervisorUserId,
      agentRegistrationId: result.agent.id,
    });
  } catch (error) {
    return programErrorResponse(error);
  }
}
