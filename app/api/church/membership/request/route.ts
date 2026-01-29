import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

import { guard } from "@/app/api/_lib/rbac";
import { requestMembership } from "@/app/api/_lib/memberships";
import { createNotification } from "@/app/api/_lib/notifications";

function json(data: any, init?: ResponseInit) {
  return NextResponse.json(data, init);
}

export async function POST(req: NextRequest) {
  const ctxOrRes = await guard(req);
  if (ctxOrRes instanceof NextResponse) return ctxOrRes;

  const { viewer, churchId } = ctxOrRes;

  const body = await req.json().catch(() => ({} as any));
  const requestedChurchId = String(body?.churchId || churchId || "").trim();

  if (!requestedChurchId) return json({ ok: false, error: "Missing churchId" }, { status: 400 });

  const r = await requestMembership(viewer.userId, requestedChurchId, viewer.name);

  if (!r.ok) return json({ ok: false, error: r.error }, { status: 400 });

  createNotification({
    churchId: r.membership.churchId,
    type: "Generic",
    title: "Membership request sent",
    message: `Your request to join churchId=${r.membership.churchId} is Pending approval.`,
    targetUserId: r.membership.userId,
  });

  return json({ ok: true, membership: r.membership });
}
