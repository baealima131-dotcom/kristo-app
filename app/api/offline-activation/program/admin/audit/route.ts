import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

import { adminAuditView } from "@/app/api/_lib/offlineActivationProgram";
import { guardProgram, programErrorResponse } from "@/app/api/_lib/offlineActivationProgramGuard";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function json(data: unknown, status = 200) {
  return NextResponse.json(data, { status, headers: { "Cache-Control": "no-store" } });
}

export async function GET(req: NextRequest) {
  const ctx = await guardProgram(req, ["System_Admin"], { allowLabAdminPass: true });
  if (ctx instanceof NextResponse) return ctx;
  try {
    const limit = Number(req.nextUrl.searchParams.get("limit") || 200);
    const userId = req.nextUrl.searchParams.get("userId") || undefined;
    return json({ ok: true, events: await adminAuditView({ limit, userId }) });
  } catch (error) {
    return programErrorResponse(error);
  }
}
