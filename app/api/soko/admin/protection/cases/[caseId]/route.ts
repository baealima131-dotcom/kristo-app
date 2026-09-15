import { NextRequest, NextResponse } from "next/server";

import { guardPlatformOfflineActivation } from "@/app/api/_lib/rbac";
import { dbGetAdminSokoProtectionCase } from "@/app/api/_lib/store/sokoProtectionDb";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

function reply(body: unknown, status = 200) {
  return NextResponse.json(body, {
    status,
    headers: { "Cache-Control": "private, no-store, no-cache, must-revalidate" },
  });
}

function errorStatus(error: unknown) {
  const status = Number((error as { status?: number })?.status || 0);
  return status >= 400 && status < 600 ? status : 404;
}

function errorCode(error: unknown) {
  return String((error as { code?: string })?.code || "") || undefined;
}

export async function GET(
  req: NextRequest,
  context: { params: Promise<{ caseId: string }> }
) {
  const auth = await guardPlatformOfflineActivation(req, ["System_Admin"]);
  if (auth instanceof NextResponse) return auth;

  try {
    const { caseId } = await context.params;
    const detail = await dbGetAdminSokoProtectionCase(caseId);
    return reply({ ok: true, case: detail });
  } catch (error) {
    return reply(
      {
        ok: false,
        error:
          error instanceof Error
            ? error.message
            : "Could not load protection case.",
        code: errorCode(error),
      },
      errorStatus(error)
    );
  }
}
