import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

import { getSupervisorDetail } from "@/app/api/_lib/offlineActivationCodeStore";
import { guardPlatformOfflineActivation } from "@/app/api/_lib/rbac";

export const runtime = "nodejs";

function json(data: unknown, init?: ResponseInit) {
  return NextResponse.json(data, init);
}

export async function GET(req: NextRequest) {
  const ctxOrRes = await guardPlatformOfflineActivation(req, ["System_Admin"]);
  if (ctxOrRes instanceof NextResponse) return ctxOrRes;

  const supervisorUserId = String(req.nextUrl.searchParams.get("supervisorUserId") || "").trim();
  if (!supervisorUserId) {
    return json({ ok: false, error: "supervisorUserId is required." }, { status: 400 });
  }

  try {
    const result = await getSupervisorDetail(supervisorUserId);
    return json({
      ok: true,
      supervisor: result.supervisor,
      codes: result.codes,
    });
  } catch (error: any) {
    return json({ ok: false, error: String(error?.message || "Supervisor not found") }, { status: 404 });
  }
}
