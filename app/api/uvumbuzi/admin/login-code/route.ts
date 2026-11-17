import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

import { createAdminLoginCode } from "@/app/api/_lib/offlineActivationProgram";
import { guardProgram, programErrorResponse } from "@/app/api/_lib/offlineActivationProgramGuard";
import { labAdminPageUrl } from "@/app/api/_lib/uvumbuziLabProxy";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function json(data: unknown, status = 200) {
  return NextResponse.json(data, { status, headers: { "Cache-Control": "no-store" } });
}

/**
 * System Admin (signed Kristo session only): a one-time, 2-minute code to sign
 * in to the UVUMBUZI Lab admin page. A lab-admin pass cannot mint new codes.
 */
export async function POST(req: NextRequest) {
  const ctx = await guardProgram(req, ["System_Admin"]);
  if (ctx instanceof NextResponse) return ctx;
  try {
    return json({ ok: true, ...(await createAdminLoginCode(ctx.userId)), labAdminUrl: labAdminPageUrl() }, 201);
  } catch (error) {
    return programErrorResponse(error);
  }
}
