import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

import { guardAuth } from "@/app/api/_lib/rbac";
import { requestMembership, getMembershipsForChurch } from "@/app/api/_lib/memberships";
import { createNotification } from "@/app/api/_lib/notifications";

function json(data: any, init?: ResponseInit) {
  return NextResponse.json(data, init);
}

export async function POST(req: NextRequest) {
  const a = await guardAuth(req);
  if (a instanceof NextResponse) return a;

  const body = await req.json().catch(() => ({} as any));
  const churchId = String(body?.churchId || "").trim();
  const name = typeof body?.name === "string" ? body.name : undefined;

  if (!churchId) return json({ ok: false, error: "Missing churchId" }, { status: 400 });

  const r = await requestMembership(a.viewer.userId, churchId, name);
  if (!r.ok) return json({ ok: false, error: r.error }, { status: 400 });

  // ✅ Notify requester
  await createNotification({
    churchId,
    type: "Generic",
    title: "Membership request sent",
    message: "Your membership request has been sent for review.",
    targetUserId: a.viewer.userId,
  });

  // ✅ Notify Pastor / Church_Admin(s) of that church
  const active = await getMembershipsForChurch(churchId, "Active");
  const approvers = active.filter(
    (m) => m.churchRole === "Pastor" || m.churchRole === "Church_Admin"
  );

  for (const p of approvers) {
    await createNotification({
      churchId,
      type: "Generic",
      title: "New membership request",
      message: `${name || "A new member"} requested to join your church.`,
      targetUserId: p.userId,
    });
  }

  return json({
    ok: true,
    membership: r.membership,
    notifiedApprovers: approvers.map((x) => x.userId),
  });
}
