import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

import { guard } from "@/app/api/_lib/rbac";
import { markAllRead } from "@/app/api/_lib/notifications";

function json(data: any, init?: ResponseInit) {
  return NextResponse.json(data, init);
}

export async function POST(req: NextRequest) {
  const ctxOrRes = await guard(req);
  if (ctxOrRes instanceof NextResponse) return ctxOrRes;

  const r = await markAllRead({
    churchId: ctxOrRes.churchId,
    userId: ctxOrRes.viewer.userId,
    includeAllTargets: false,
  });
  return json({ ok: true, ...r, scope: "forMe" });
}
