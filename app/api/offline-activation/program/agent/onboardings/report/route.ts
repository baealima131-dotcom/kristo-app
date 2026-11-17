import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

import { submitTrainingReport } from "@/app/api/_lib/offlineActivationProgram";
import { guardProgram, programErrorResponse } from "@/app/api/_lib/offlineActivationProgramGuard";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function json(data: unknown, status = 200) {
  return NextResponse.json(data, { status, headers: { "Cache-Control": "no-store" } });
}

/** Agent: training given + follow-up. A completed training asks the leader to confirm in-app. */
export async function POST(req: NextRequest) {
  const ctx = await guardProgram(req, ["Agent"]);
  if (ctx instanceof NextResponse) return ctx;
  const body = await req.json().catch(() => ({}));
  try {
    const result = await submitTrainingReport({
      agentUserId: ctx.userId,
      onboardingId: String(body?.onboardingId || ""),
      churchId: body?.churchId ? String(body.churchId) : undefined,
      trainingTopics: body?.trainingTopics,
      trainingNotes: body?.trainingNotes,
      trainingCompleted: body?.trainingCompleted,
      followUpStatus: body?.followUpStatus,
      followUpNote: body?.followUpNote,
    });
    return json({ ok: true, ...result });
  } catch (error) {
    return programErrorResponse(error);
  }
}
