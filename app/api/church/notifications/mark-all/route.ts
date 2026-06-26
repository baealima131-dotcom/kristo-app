import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

import { guard } from "@/app/api/_lib/rbac";
import {
  canUseChurchAdminScope,
  resolveNotificationScope,
} from "@/app/api/_lib/notificationScope";
import { markAllRead } from "@/app/api/_lib/notifications";

export const runtime = "nodejs";

function json(data: any, init?: ResponseInit) {
  return NextResponse.json(data, init);
}

export async function POST(req: NextRequest) {
  const ctxOrRes = await guard(req);
  if (ctxOrRes instanceof NextResponse) return ctxOrRes;

  const url = new URL(req.url);
  const scopeParams = resolveNotificationScope(
    url.searchParams.get("scope"),
    ctxOrRes.viewer.role,
    { allParam: url.searchParams.get("all") }
  );

  if (
    scopeParams.scope === "churchAdmin" &&
    !canUseChurchAdminScope(ctxOrRes.viewer.role)
  ) {
    return json(
      {
        ok: false,
        error: "Forbidden (churchAdmin scope)",
        details: { hint: "Pastor or Church_Admin required." },
      },
      { status: 403 }
    );
  }

  const r = await markAllRead({
    churchId: ctxOrRes.churchId,
    userId: ctxOrRes.viewer.userId,
    storeScope: scopeParams.storeScope,
  });

  return json({ ok: true, ...r, scope: scopeParams.scope });
}
