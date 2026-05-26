import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

import { guard } from "@/app/api/_lib/rbac";
import { markAllRead } from "@/app/api/_lib/notifications";

export const runtime = "nodejs";

function json(data: any, init?: ResponseInit) {
  return NextResponse.json(data, init);
}

export async function POST(req: NextRequest) {
  const ctxOrRes = await guard(req, ["Pastor", "Church_Admin", "System_Admin"] as any);
  if (ctxOrRes instanceof NextResponse) return ctxOrRes;

  const url = new URL(req.url);
  const all = url.searchParams.get("all") === "1" || url.searchParams.get("all") === "true";

  if (all) {
    const role = ctxOrRes.viewer.role;
    const ok = role === "Pastor" || role === "Church_Admin" || role === "System_Admin";
    if (!ok) {
      return json(
        {
          ok: false,
          error: "Forbidden (all=1)",
          details: { hint: "Pastor or Church_Admin required." },
        },
        { status: 403 }
      );
    }
  }

  const out = markAllRead({
    churchId: ctxOrRes.churchId,
    userId: ctxOrRes.viewer.userId,
    includeAllTargets: all,
  });

  return json({ ok: true, changed: out.updated });
}
