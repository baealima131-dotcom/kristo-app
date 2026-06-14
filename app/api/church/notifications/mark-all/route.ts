import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

import { guard } from "@/app/api/_lib/rbac";
import { markAllRead } from "@/app/api/_lib/notifications";
import {
  parseNotificationListScope,
  scopeToIncludeAllTargets,
} from "@/app/api/_lib/notificationScope";

export const runtime = "nodejs";

function json(data: any, init?: ResponseInit) {
  return NextResponse.json(data, init);
}

export async function POST(req: NextRequest) {
  const ctxOrRes = await guard(req);
  if (ctxOrRes instanceof NextResponse) return ctxOrRes;

  const url = new URL(req.url);
  const legacyAll =
    url.searchParams.get("all") === "1" || url.searchParams.get("all") === "true";
  const role = String(ctxOrRes.viewer.role || "");
  const scope = parseNotificationListScope(
    url.searchParams.get("scope") || (legacyAll ? "churchAdmin" : "forMe"),
    role
  );
  const includeAllTargets = scopeToIncludeAllTargets(scope);

  const out = await markAllRead({
    churchId: ctxOrRes.churchId,
    userId: ctxOrRes.viewer.userId,
    includeAllTargets,
  });

  return json({ ok: true, changed: out.updated, scope });
}
