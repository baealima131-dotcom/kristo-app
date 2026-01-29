import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

import { guard } from "@/app/api/_lib/rbac";
import { getMembershipsForChurch, type MembershipStatus } from "@/app/api/_lib/memberships";

function json(data: any, init?: ResponseInit) {
  return NextResponse.json(data, init);
}

export async function GET(req: NextRequest) {
  const ctxOrRes = await guard(req, ["Pastor", "Church_Admin", "System_Admin"]);
  if (ctxOrRes instanceof NextResponse) return ctxOrRes;

  const url = new URL(req.url);
  const status = (url.searchParams.get("status") || "").trim() as MembershipStatus | "";

  const items = await getMembershipsForChurch(ctxOrRes.churchId, status ? status : undefined);

  return json({ ok: true, churchId: ctxOrRes.churchId, items });
}
