import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

import { respondLeaderConfirmation } from "@/app/api/_lib/offlineActivationProgram";
import { guardProgramUser, programErrorResponse } from "@/app/api/_lib/offlineActivationProgramGuard";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function json(data: unknown, status = 200) {
  return NextResponse.json(data, { status, headers: { "Cache-Control": "no-store" } });
}

/** Church leader: confirm, reject, or ask for more help. Only the named leader can answer. */
export async function POST(req: NextRequest) {
  const user = await guardProgramUser(req);
  if (user instanceof NextResponse) return user;
  const body = await req.json().catch(() => ({}));
  try {
    const result = await respondLeaderConfirmation({
      leaderUserId: user.userId,
      requestId: String(body?.requestId || ""),
      response: String(body?.response || ""),
      note: body?.note,
    });
    return json({ ok: true, status: result.onboarding.status, duplicate: result.duplicate });
  } catch (error) {
    return programErrorResponse(error);
  }
}
