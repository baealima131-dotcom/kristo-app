import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

import { listLeaderConfirmations } from "@/app/api/_lib/offlineActivationProgram";
import { guardProgramUser, programErrorResponse } from "@/app/api/_lib/offlineActivationProgramGuard";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function json(data: unknown, status = 200) {
  return NextResponse.json(data, { status, headers: { "Cache-Control": "no-store" } });
}

/** Church leader: pending "did this agent help and train you?" requests addressed to them. */
export async function GET(req: NextRequest) {
  const user = await guardProgramUser(req);
  if (user instanceof NextResponse) return user;
  try {
    return json({ ok: true, requests: await listLeaderConfirmations(user.userId) });
  } catch (error) {
    return programErrorResponse(error);
  }
}
