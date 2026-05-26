import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

import { guardAuth } from "@/app/api/_lib/rbac";
import { rejectMembership, getMembershipById, isApproverForChurch } from "@/app/api/_lib/memberships";
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

  const body = await req.json().catch(() => ({} as any));
  const note = typeof body?.note === "string" ? body.note : undefined;

  const { id } = await ctx.params;

  const m = await getMembershipById(String(id));
  if (!m) return json({ ok: false, error: "Membership not found" }, { status: 404 });

  const churchId = m.churchId;

  // ✅ DEV bootstrap: allow requester to self-reject for default dev church (optional convenience)
  let allowed = false;
  if (isDev() && churchId === devDefaultChurchId() && m.userId === a.viewer.userId) {
    allowed = true;
  }

  // ✅ Normal rule: only Pastor / Church_Admin of that church can reject
  if (!allowed) {
    const ok = await isApproverForChurch(a.viewer.userId, churchId);
    if (!ok) {
      return json(
        { ok: false, error: "Forbidden (role)", details: { hint: "Pastor/Church_Admin required for this church." } },
        { status: 403 }
      );
    }
  }

  const r = await rejectMembership(String(id), a.viewer.userId, note);
  if (!r.ok) return json({ ok: false, error: r.error }, { status: 400 });

  createNotification({
    churchId: r.membership.churchId,
    targetUserId: r.membership.userId,
    type: "MembershipRejected",
    title: "Membership rejected",
    message: note ? `Reason: ${note}` : "Your membership request was not approved.",
  });

  return json({ ok: true, membership: r.membership });
}
