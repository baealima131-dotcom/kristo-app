import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

import { guard } from "@/app/api/_lib/rbac";
import { listNotifications, setRead } from "@/app/api/_lib/notifications";

export const runtime = "nodejs";

function json(data: any, init?: ResponseInit) {
  return NextResponse.json(data, init);
}

export async function POST(req: NextRequest) {
  // Only Pastor / Church_Admin can mark-all (fits your UI "all=1 ON (Pastor)" idea)
  const ctxOrRes = await guard(req, ["Pastor", "Church_Admin", "System_Admin"] as any);
  if (ctxOrRes instanceof NextResponse) return ctxOrRes;

  const url = new URL(req.url);
  const all = url.searchParams.get("all") === "1" || url.searchParams.get("all") === "true";

  // If all=1, enforce Pastor/Church_Admin (same style as GET in notifications/route.ts)
  if (all) {
    const role = ctxOrRes.viewer.role;
    const ok = role === "Pastor" || role === "Church_Admin";
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

  // Pull unread notifications then mark them read
  const items = await listNotifications({
    churchId: ctxOrRes.churchId,
    userId: ctxOrRes.viewer.userId,
    unreadOnly: true,
    limit: 5000,
    includeAllTargets: all,
  });

  let changed = 0;
  for (const n of items as any[]) {
    const updated = await setRead(String(n.id), true);
    if (updated) changed++;
  }

  return json({ ok: true, changed });
}
