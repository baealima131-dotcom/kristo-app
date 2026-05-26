import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

import { guardAuth } from "@/app/api/_lib/rbac";
import { approveMembership, rejectMembership, getMembershipsForUser } from "@/app/api/_lib/memberships";
import { createNotification } from "@/app/api/_lib/notifications";

function json(data: any, init?: ResponseInit) {
  return NextResponse.json(data, init);
}


export async function GET(req: NextRequest) {
  const a = await guardAuth(req);
  if (a instanceof NextResponse) return a;

  const all = await getMembershipsForUser(a.viewer.userId);
  const invites = all.filter((m: any) => String(m?.status || "") === "Requested");

  return json({ ok: true, data: invites });
}

export async function PATCH(req: NextRequest) {
  const a = await guardAuth(req);
  if (a instanceof NextResponse) return a;

  const body = await req.json().catch(() => ({} as any));
  const membershipId = String(body?.membershipId || "").trim();
  const action = String(body?.action || "").trim(); // accept | reject

  if (!membershipId) {
    return json({ ok: false, error: "Missing membershipId" }, { status: 400 });
  }

  if (action === "accept") {
    const r = await approveMembership(membershipId, a.viewer.userId);
    if (!r.ok) return json({ ok: false, error: r.error }, { status: 400 });

    createNotification({
      churchId: r.membership.churchId,
      type: "Generic",
      title: "You joined a church",
      message: "Welcome! You are now a member.",
      targetUserId: r.membership.userId,
    });

    return json({ ok: true, data: r.membership });
  }

  if (action === "reject") {
    const r = await rejectMembership(membershipId, a.viewer.userId);
    if (!r.ok) return json({ ok: false, error: r.error }, { status: 400 });

    return json({ ok: true, data: r.membership });
  }

  return json({ ok: false, error: "Invalid action" }, { status: 400 });
}
