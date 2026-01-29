import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

import { guardAuth } from "@/app/api/_lib/rbac";
import { approveMembership, getMembershipById, isApproverForChurch } from "@/app/api/_lib/memberships";
import { createNotification } from "@/app/api/_lib/notifications";

function json(data: any, init?: ResponseInit) {
  return NextResponse.json(data, init);
}

function isDev() {
  return process.env.NODE_ENV !== "production";
}

function devDefaultChurchId() {
  return "church_dev_default";
}

export async function POST(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const a = await guardAuth(req);
  if (a instanceof NextResponse) return a;

  const { id } = await ctx.params;

  const m = await getMembershipById(String(id));
  if (!m) return json({ ok: false, error: "Membership not found" }, { status: 404 });

  const churchId = m.churchId;

  // ✅ DEV bootstrap: allow requester to self-approve for default dev church
  let allowed = false;
  if (isDev() && churchId === devDefaultChurchId() && m.userId === a.viewer.userId) {
    allowed = true;
  }

  // ✅ Normal rule: only Pastor / Church_Admin of that church can approve
  if (!allowed) {
    const ok = await isApproverForChurch(a.viewer.userId, churchId);
    if (!ok) {
      return json(
        { ok: false, error: "Forbidden (role)", details: { hint: "Pastor/Church_Admin required for this church." } },
        { status: 403 }
      );
    }
  }

  const r = await approveMembership(String(id), a.viewer.userId);
  if (!r.ok) return json({ ok: false, error: r.error }, { status: 400 });

  createNotification({
    churchId: r.membership.churchId,
    type: "Generic",
    title: "Membership approved ✅",
    message: `You are now an Active member of churchId=${r.membership.churchId}.`,
    targetUserId: r.membership.userId,
  });

  return json({ ok: true, membership: r.membership });
}
