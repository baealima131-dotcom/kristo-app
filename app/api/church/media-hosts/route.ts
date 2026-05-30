import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

import { getChurchMediaRecord } from "@/app/api/_lib/churchSubscription";
import { guard } from "@/app/api/_lib/rbac";

export const runtime = "nodejs";

export async function GET(req: NextRequest) {
  const ctxOrRes = await guard(req);
  if (ctxOrRes instanceof NextResponse) return ctxOrRes;

  const churchId = String(ctxOrRes.churchId || "").trim();
  const media = await getChurchMediaRecord(churchId);
  const hosts = Array.isArray(media?.hosts) ? media!.hosts : [];

  return NextResponse.json({ ok: true, hosts });
}
