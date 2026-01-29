import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

import { guard } from "@/app/api/_lib/rbac";
import { leaveActiveMembership } from "@/app/api/_lib/memberships";
import { createNotification } from "@/app/api/_lib/notifications";

function json(data: any, init?: ResponseInit) {
  return NextResponse.json(data, init);
}

export async function POST(req: NextRequest) {
  const ctxOrRes = await guard(req);
  if (ctxOrRes instanceof NextResponse) return ctxOrRes;

  const { viewer, churchId } = ctxOrRes;

  const r = await leaveActiveMembership(viewer.userId);
  if (!r.ok) return json({ ok: false, error: r.error }, { status: 400 });

  createNotification({
    churchId: r.membership?.churchId || churchId,
    type: "Generic",
    title: "You left the church",
    message: `You are no longer an Active member.`,
    targetUserId: viewer.userId,
  });

  return json({ ok: true, membership: r.membership });
}
