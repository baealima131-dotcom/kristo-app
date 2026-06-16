import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

import { guard } from "@/app/api/_lib/rbac";
import {
  getChurchFollowerCount,
  listChurchFollowers,
  normalizeChurchId,
} from "@/app/api/_lib/churchFollows";

export const runtime = "nodejs";

function json(data: unknown, init?: ResponseInit) {
  return NextResponse.json(data, init);
}

export async function GET(req: NextRequest) {
  const ctxOrRes = await guard(req, ["Pastor", "Church_Admin", "Leader", "Ministry_Leader", "Member", "System_Admin"]);
  if (ctxOrRes instanceof NextResponse) return ctxOrRes;

  const requestedChurchId = normalizeChurchId(new URL(req.url).searchParams.get("churchId"));
  const churchId = requestedChurchId || normalizeChurchId(ctxOrRes.churchId);
  if (!churchId) return json({ ok: false, error: "churchId missing" }, { status: 400 });

  if (requestedChurchId && requestedChurchId !== normalizeChurchId(ctxOrRes.churchId)) {
    return json({ ok: false, error: "Forbidden" }, { status: 403 });
  }

  const [followers, followerCount] = await Promise.all([
    listChurchFollowers(churchId),
    getChurchFollowerCount(churchId),
  ]);

  return json({
    ok: true,
    data: {
      churchId,
      followerCount,
      followers,
    },
  });
}
